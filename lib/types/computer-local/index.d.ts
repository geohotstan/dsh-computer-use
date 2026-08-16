/**
 * Local Service Provider for the computer-use seam over the resident macOS
 * helper daemon (`dsh-computer-daemon`, sources in the repo's `native/`
 * directory). The engine owns one long-lived daemon per service instance:
 * the daemon keeps the capture session — the per-app accessibility tree that
 * makes later captures diffs instead of full trees — so daemon lifetime is
 * engine lifetime, started at load so its TCC preflight runs during startup
 * (a missing grant fails the load and unloads the seam), restarted after a
 * crash, and terminated at engine disposal through the subprocess seam's
 * tree-scoped termination. Requests ride newline-delimited JSON-RPC 2.0 over the spawned
 * pipes; the daemon's stderr tail feeds crash diagnostics.
 *
 * Deployment policy (which apps may be driven, which actions need approval)
 * belongs in `tools/pre-execute` or a policy service; this engine performs
 * the mechanism its caller already authorized.
 * @module @zibokapi/dsh-codex-computer-use/computer-local
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { ComputerEngine } from '../computer/index.ts';
import type { ClickRequest, ComputerApp, ComputerAppState, ComputerExecSpec, ComputerPermissionStatus, ComputerRecordStatus, ComputerRequestBase, ComputerScreenshot, DragRequest, GetAppStateRequest, ListAppsRequest, PerformSecondaryActionRequest, PressKeyRequest, ScrollRequest, SelectTextRequest, SetValueRequest, TypeTextRequest } from '../computer/index.ts';
import { DAEMON_METHODS } from './protocol.ts';
/** Environment override for the daemon path when the composition config leaves it unset. */
export declare const HELPER_PATH_ENV = "DSH_COMPUTER_HELPER_PATH";
/** Environment name carrying the comma-separated foreground-only app list to the daemon. */
export declare const FOREGROUND_APPS_ENV = "DSH_COMPUTER_FOREGROUND_APPS";
/** Environment name carrying the browser-isolation switch to the daemon. */
export declare const BROWSER_ISOLATION_ENV = "DSH_COMPUTER_BROWSER_ISOLATION";
/** Environment name carrying the comma-separated allowed browser-URL prefixes to the daemon. */
export declare const URL_ALLOW_ENV = "DSH_COMPUTER_URL_ALLOW";
/** Environment name carrying the comma-separated denied browser-URL prefixes to the daemon. */
export declare const URL_DENY_ENV = "DSH_COMPUTER_URL_DENY";
/** Environment name carrying the comma-separated organization-policy denied app ids to the daemon. */
export declare const DENIED_APPS_ENV = "DSH_COMPUTER_DENIED_APPS";
/**
 * Build the spawn-time environment override for {@link Config.foregroundApps}.
 * The subprocess seam scrubs `DSH_*` names from the ambient environment, so
 * this is the only path the daemon's foreground pinning travels.
 * @param apps - the configured canonical app ids.
 * @returns the explicit environment entry, or undefined when no app is pinned.
 */
export declare function foregroundAppsEnv(apps: readonly string[]): Record<string, string> | undefined;
/**
 * Build the spawn-time environment override for {@link Config.browserIsolation}.
 * Only the enabled value travels; absence leaves the daemon default (off).
 * @param enabled - the configured isolation switch.
 * @returns the explicit environment entry, or undefined when isolation is off.
 */
export declare function browserIsolationEnv(enabled: boolean): Record<string, string> | undefined;
/**
 * Build the spawn-time environment entry for one comma-separated string-list
 * config (URL prefixes, denied app ids). Like {@link foregroundAppsEnv}, this
 * is the only path those deployment policies travel to the daemon.
 * @param name - the environment variable name.
 * @param values - the configured entries; blank entries are dropped.
 * @returns the environment entry, or undefined when nothing is configured.
 */
export declare function csvEnv(name: string, values: readonly string[]): Record<string, string> | undefined;
/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
    /**
     * Absolute path to the `dsh-computer-daemon` executable. Unset here and in
     * {@link HELPER_PATH_ENV}, the engine uses the setup CLI's install location
     * (`<dsh home>/computer-use`, built by `npx @zibokapi/dsh-codex-computer-use`);
     * when that is absent too, the engine fails at load.
     */
    helperPath?: string;
    /** Extra argv entries appended after the daemon path. */
    helperArgs?: string[];
    /** Default per-request timeout in milliseconds. */
    timeoutMs?: number;
    /** Upper bound for per-request timeout overrides. */
    maxTimeoutMs?: number;
    /** Byte bound applied to every captured accessibility-tree text. */
    maxTreeBytes?: number;
    /** Byte bound applied to every captured screenshot; a larger capture fails the request. */
    maxScreenshotBytes?: number;
    /** Grace period for daemon termination escalation; at most `MAX_TIMER_DELAY_MS`. */
    graceMs?: number;
    /**
     * Canonical app ids that must receive input through the foreground path
     * (raised window, global event tap) because they reject background
     * delivery. Unlisted apps get background delivery through the SkyLight
     * private path with the public per-process fallback; the foreground path
     * is never entered automatically.
     */
    foregroundApps?: string[];
    /**
     * Isolate browser targets from the user's browser: when true, the daemon
     * launches Chromium-family browsers in a fresh instance with its own
     * temporary user-data directory instead of driving the user's logged-in
     * profile. Safari cannot be isolated and keeps the user's instance.
     */
    browserIsolation?: boolean;
    /**
     * URL prefixes (scheme, optionally with host and port) the browser may be
     * driven on. Absent, every URL is allowed except {@link browserUrlDeny};
     * present, a URL must start with one of the prefixes.
     */
    browserUrlAllow?: string[];
    /** URL prefixes always refused, even when {@link browserUrlAllow} matches. */
    browserUrlDeny?: string[];
    /**
     * Canonical app ids blocked outright with the organization-policy denial.
     * The deployment expresses an organization policy this way; the daemon
     * refuses captures and actions against these apps.
     */
    deniedApps?: string[];
}
/** The shape after schemastery applied the defaults (helperPath/helperArgs have none). */
type ResolvedConfig = Required<Omit<Config, 'helperPath' | 'helperArgs'>> & Pick<Config, 'helperPath' | 'helperArgs'>;
/**
 * Reject a resolved section this engine could not run with. The schema
 * expresses neither "positive and finite" nor the timer bound `graceMs` has
 * to fit, so a stored value is refused where it is written instead of failing
 * at the next request.
 * @param config - the resolved section, schema-valid by construction.
 * @throws Error naming the field that cannot be used.
 */
export declare function assertServiceableComputerConfig(config: Config): void;
/**
 * Decode the daemon's `list_apps` result into seam apps, validating the wire
 * boundary field by field.
 * @param value - the daemon result for `list_apps`.
 * @returns the canonical app entries.
 * @throws Error when the wire value violates the result shape.
 */
export declare function decodeApps(value: unknown): ComputerApp[];
/** The decoded get_app_state payload: seam state plus the raw decoded screenshot bytes before the bound check. */
interface RawAppState {
    app: string;
    text: string;
    screenshot: ComputerScreenshot | null;
}
/**
 * Decode the daemon's `get_app_state` result into seam state, validating the
 * wire boundary and enforcing the screenshot byte bound.
 * @param value - the daemon result for `get_app_state`.
 * @param maxScreenshotBytes - the deployment's screenshot byte bound.
 * @returns the canonical capture.
 * @throws Error when the wire value violates the result shape or exceeds the bound.
 */
export declare function decodeAppState(value: unknown, maxScreenshotBytes: number): RawAppState;
/**
 * Decode the daemon's `permission_status` result into the seam grant state.
 * @param value - the daemon result for `permission_status`.
 * @returns the canonical grant state.
 * @throws Error when the wire value violates the result shape.
 */
export declare function decodeRecordStatus(value: unknown): ComputerRecordStatus;
export declare function decodePermissionStatus(value: unknown): ComputerPermissionStatus;
/**
 * Local computer-use engine over the resident macOS helper daemon. The daemon
 * starts at load so its TCC preflight runs during startup — a missing grant
 * fails the load and unregisters the `ctx.computer` service. Once loaded it
 * survives across calls (its capture session owns per-app tree diffs), restarts
 * after a crash, and dies with the engine. Requests time out per call; aborts
 * from the caller's signal stop in-flight work without killing the daemon.
 */
export declare class LocalComputerEngine extends ComputerEngine {
    static inject: string[];
    static Config: z<Config>;
    /** The currently authoritative config: the settings section, or the composition entry. */
    private source;
    /** The resident connection, present once the daemon has been started. */
    private connection;
    /** Monotonic request-id counter, shared across daemon restarts. */
    private nextId;
    /** Validated config (schemastery applied the defaults before construction). */
    get config(): ResolvedConfig;
    constructor(ctx: Context, config: Config);
    /**
     * Load-time TCC preflight: spawn the daemon (whose startup `requestPermissions()`
     * prompts for each missing grant) and refuse to activate until both grants
     * are present. Rejection fails this fiber, which unregisters `ctx.computer`
     * and leaves the `@zibokapi/dsh-codex-computer-use/computer-tools` consumer (which injects `computer`)
     * unloaded as well — a missing permission means computer use is simply not
     * loaded, matching Codex's prompt-at-enable behavior.
     */
    [Service.init](): Promise<void>;
    /** Resolve the daemon path per spawn: settings/config, then the environment override, then the setup CLI's install location. */
    private resolveHelperPath;
    /** The current daemon argv from the resolved path and extra args. */
    private daemonArgv;
    /** Process id of the resident daemon (spawned during the load-time preflight). */
    get pid(): number | undefined;
    /**
     * The live connection, starting the daemon when none is running. Starting
     * is synchronous until the spawn returns, so concurrent callers share one
     * connection and one daemon.
     * @returns the resident connection.
     */
    private currentConnection;
    /**
     * Invoke one daemon method with the fused per-request deadline. The deadline
     * is the single timeout-and-abort owner: the connection's abort message is
     * classified here into the exact cause the caller reads.
     * @param method - the daemon method.
     * @param params - method parameters.
     * @param timeoutMs - the resolved per-request bound.
     * @param signal - the caller's abort signal, when supplied.
     * @returns the daemon result for the caller's operation decoder.
     */
    private call;
    resolve<T extends ComputerRequestBase>(request: T): ComputerExecSpec<T>;
    listApps(spec: ComputerExecSpec<ListAppsRequest>): Promise<ComputerApp[]>;
    /**
     * Read the daemon's macOS TCC grant state (Accessibility and Screen Recording).
     * @param timeoutMs - per-request timeout; `0` waits without a timeout (the
     *   load-time preflight passes `0` because the TCC dialog is user-paced).
     */
    permissionStatus(timeoutMs?: number): Promise<ComputerPermissionStatus>;
    /**
     * Request the daemon's macOS TCC grants — this prompts the user through the
     * macOS dialogs (or opens System Settings on a remembered denial) — and
     * report the resulting grant state. Waits without a timeout: answering the
     * dialog is user-paced.
     */
    requestPermissions(): Promise<ComputerPermissionStatus>;
    recordStart(): Promise<ComputerRecordStatus>;
    recordStatus(): Promise<ComputerRecordStatus>;
    recordStop(): Promise<ComputerRecordStatus>;
    getAppState(spec: ComputerExecSpec<GetAppStateRequest>): Promise<ComputerAppState>;
    click(spec: ComputerExecSpec<ClickRequest>): Promise<void>;
    typeText(spec: ComputerExecSpec<TypeTextRequest>): Promise<void>;
    pressKey(spec: ComputerExecSpec<PressKeyRequest>): Promise<string>;
    scroll(spec: ComputerExecSpec<ScrollRequest>): Promise<void>;
    setValue(spec: ComputerExecSpec<SetValueRequest>): Promise<void>;
    selectText(spec: ComputerExecSpec<SelectTextRequest>): Promise<void>;
    drag(spec: ComputerExecSpec<DragRequest>): Promise<void>;
    performSecondaryAction(spec: ComputerExecSpec<PerformSecondaryActionRequest>): Promise<void>;
}
export { DAEMON_METHODS };
export type { DaemonMethod } from './protocol.ts';
export { LineDecoder, buildRequest, parseResponse } from './protocol.ts';
export default LocalComputerEngine;
//# sourceMappingURL=index.d.ts.map