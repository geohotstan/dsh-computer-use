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

import { existsSync } from 'node:fs'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { COMPUTER_SETTINGS_NAMESPACE, ComputerEngine, normalizeDirection, normalizeMouseButton, truncateTreeChars, truncateTreeText } from '../computer/index.ts'
import type {
  ClickRequest,
  ComputerApp,
  ComputerAppState,
  ComputerExecSpec,
  ComputerPermissionStatus,
  ComputerRecordStatus,
  ComputerRequestBase,
  ComputerScreenshot,
  DragRequest,
  GetAppStateRequest,
  ListAppsRequest,
  PerformSecondaryActionRequest,
  PressKeyRequest,
  ScrollRequest,
  SelectTextRequest,
  SetValueRequest,
  TypeTextRequest,
} from '../computer/index.ts'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import type { SubprocessHandle, SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'
import { clampTimeout, deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { DAEMON_METHODS, LineDecoder, buildRequest, parseResponse } from './protocol.ts'
import type { DaemonMethod } from './protocol.ts'
import { defaultHelperPath } from '../setup/paths.ts'

/** Environment override for the daemon path when the composition config leaves it unset. */
export const HELPER_PATH_ENV = 'DSH_COMPUTER_HELPER_PATH'

/** Environment name carrying the comma-separated foreground-only app list to the daemon. */
export const FOREGROUND_APPS_ENV = 'DSH_COMPUTER_FOREGROUND_APPS'

/** Environment name carrying the browser-isolation switch to the daemon. */
export const BROWSER_ISOLATION_ENV = 'DSH_COMPUTER_BROWSER_ISOLATION'

/** Environment name carrying the comma-separated allowed browser-URL prefixes to the daemon. */
export const URL_ALLOW_ENV = 'DSH_COMPUTER_URL_ALLOW'
/** Environment name carrying the comma-separated denied browser-URL prefixes to the daemon. */
export const URL_DENY_ENV = 'DSH_COMPUTER_URL_DENY'
/** Environment name carrying the comma-separated organization-policy denied app ids to the daemon. */
export const DENIED_APPS_ENV = 'DSH_COMPUTER_DENIED_APPS'

/**
 * Build the spawn-time environment override for {@link Config.foregroundApps}.
 * The subprocess seam scrubs `DSH_*` names from the ambient environment, so
 * this is the only path the daemon's foreground pinning travels.
 * @param apps - the configured canonical app ids.
 * @returns the explicit environment entry, or undefined when no app is pinned.
 */
export function foregroundAppsEnv(apps: readonly string[]): Record<string, string> | undefined {
  return csvEnv(FOREGROUND_APPS_ENV, apps)
}

/**
 * Build the spawn-time environment override for {@link Config.browserIsolation}.
 * Only the enabled value travels; absence leaves the daemon default (off).
 * @param enabled - the configured isolation switch.
 * @returns the explicit environment entry, or undefined when isolation is off.
 */
export function browserIsolationEnv(enabled: boolean): Record<string, string> | undefined {
  return enabled ? { [BROWSER_ISOLATION_ENV]: '1' } : undefined
}

/**
 * Build the spawn-time environment entry for one comma-separated string-list
 * config (URL prefixes, denied app ids). Like {@link foregroundAppsEnv}, this
 * is the only path those deployment policies travel to the daemon.
 * @param name - the environment variable name.
 * @param values - the configured entries; blank entries are dropped.
 * @returns the environment entry, or undefined when nothing is configured.
 */
export function csvEnv(name: string, values: readonly string[]): Record<string, string> | undefined {
  const joined = values.map(value => value.trim()).filter(value => value.length > 0).join(',')
  return joined.length > 0 ? { [name]: joined } : undefined
}

/** Default per-request timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 15_000
/** Default upper bound for per-request timeout overrides. */
const DEFAULT_MAX_TIMEOUT_MS = 120_000
/** Default accessibility-tree text bound per capture, in bytes. */
const DEFAULT_MAX_TREE_BYTES = 256_000
/** Default screenshot bound per capture, in bytes. */
const DEFAULT_MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024
/** Default daemon termination grace period in milliseconds. */
const DEFAULT_GRACE_MS = 3_000
/** In-memory stderr tail the engine retains for daemon-crash diagnostics. */
const DAEMON_STDERR_TAIL_BYTES = 64_000

/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /**
   * Absolute path to the `dsh-computer-daemon` executable. Unset here and in
   * {@link HELPER_PATH_ENV}, the engine uses the setup CLI's install location
   * (`<dsh home>/computer-use`, built by `npx @zibokapi/dsh-codex-computer-use`);
   * when that is absent too, the engine fails at load.
   */
  helperPath?: string
  /** Extra argv entries appended after the daemon path. */
  helperArgs?: string[]
  /** Default per-request timeout in milliseconds. */
  timeoutMs?: number
  /** Upper bound for per-request timeout overrides. */
  maxTimeoutMs?: number
  /** Byte bound applied to every captured accessibility-tree text. */
  maxTreeBytes?: number
  /** Byte bound applied to every captured screenshot; a larger capture fails the request. */
  maxScreenshotBytes?: number
  /** Grace period for daemon termination escalation; at most `MAX_TIMER_DELAY_MS`. */
  graceMs?: number
  /**
   * Canonical app ids that must receive input through the foreground path
   * (raised window, global event tap) because they reject background
   * delivery. Unlisted apps get background delivery through the SkyLight
   * private path with the public per-process fallback; the foreground path
   * is never entered automatically.
   */
  foregroundApps?: string[]
  /**
   * Isolate browser targets from the user's browser: when true, the daemon
   * launches Chromium-family browsers in a fresh instance with its own
   * temporary user-data directory instead of driving the user's logged-in
   * profile. Safari cannot be isolated and keeps the user's instance.
   */
  browserIsolation?: boolean
  /**
   * URL prefixes (scheme, optionally with host and port) the browser may be
   * driven on. Absent, every URL is allowed except {@link browserUrlDeny};
   * present, a URL must start with one of the prefixes.
   */
  browserUrlAllow?: string[]
  /** URL prefixes always refused, even when {@link browserUrlAllow} matches. */
  browserUrlDeny?: string[]
  /**
   * Canonical app ids blocked outright with the organization-policy denial.
   * The deployment expresses an organization policy this way; the daemon
   * refuses captures and actions against these apps.
   */
  deniedApps?: string[]
}

/** The shape after schemastery applied the defaults (helperPath/helperArgs have none). */
type ResolvedConfig = Required<Omit<Config, 'helperPath' | 'helperArgs'>> & Pick<Config, 'helperPath' | 'helperArgs'>

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`computer-local: ${name} must be a positive finite number`)
  }
}

/**
 * Reject a resolved section this engine could not run with. The schema
 * expresses neither "positive and finite" nor the timer bound `graceMs` has
 * to fit, so a stored value is refused where it is written instead of failing
 * at the next request.
 * @param config - the resolved section, schema-valid by construction.
 * @throws Error naming the field that cannot be used.
 */
export function assertServiceableComputerConfig(config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveFinite('timeoutMs', resolved.timeoutMs)
  assertPositiveFinite('maxTimeoutMs', resolved.maxTimeoutMs)
  assertPositiveFinite('maxTreeBytes', resolved.maxTreeBytes)
  assertPositiveFinite('maxScreenshotBytes', resolved.maxScreenshotBytes)
  assertPositiveFinite('graceMs', resolved.graceMs)
  if (resolved.graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`computer-local: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** One pending daemon request the connection correlates by id. */
interface PendingCall {
  settle: (error: Error | null, value?: unknown) => void
}

/** Narrow an unknown wire value to a plain string record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Decode the daemon's `list_apps` result into seam apps, validating the wire
 * boundary field by field.
 * @param value - the daemon result for `list_apps`.
 * @returns the canonical app entries.
 * @throws Error when the wire value violates the result shape.
 */
export function decodeApps(value: unknown): ComputerApp[] {
  if (!Array.isArray(value)) throw new Error('computer-local: daemon returned a non-array app list')
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== 'string') {
      throw new Error(`computer-local: daemon app entry ${index} lacks a string id`)
    }
    const app: ComputerApp = { id: entry.id }
    const stringField = (name: 'displayName' | 'lastUsedDate', raw: unknown): void => {
      if (typeof raw !== 'string') throw new Error(`computer-local: daemon app entry ${index} has a non-string ${name}`)
      app[name] = raw
    }
    if (entry.displayName !== undefined) stringField('displayName', entry.displayName)
    if (entry.lastUsedDate !== undefined) stringField('lastUsedDate', entry.lastUsedDate)
    if (entry.isRunning !== undefined) {
      if (typeof entry.isRunning !== 'boolean') throw new Error(`computer-local: daemon app entry ${index} has a non-boolean isRunning`)
      app.isRunning = entry.isRunning
    }
    if (entry.useCount !== undefined) {
      if (typeof entry.useCount !== 'number' || !Number.isInteger(entry.useCount) || entry.useCount < 0) {
        throw new Error(`computer-local: daemon app entry ${index} has a non-integer useCount`)
      }
      app.useCount = entry.useCount
    }
    return app
  })
}

/** The decoded get_app_state payload: seam state plus the raw decoded screenshot bytes before the bound check. */
interface RawAppState {
  app: string
  text: string
  screenshot: ComputerScreenshot | null
}

/**
 * Decode the daemon's `get_app_state` result into seam state, validating the
 * wire boundary and enforcing the screenshot byte bound.
 * @param value - the daemon result for `get_app_state`.
 * @param maxScreenshotBytes - the deployment's screenshot byte bound.
 * @returns the canonical capture.
 * @throws Error when the wire value violates the result shape or exceeds the bound.
 */
export function decodeAppState(value: unknown, maxScreenshotBytes: number): RawAppState {
  if (!isRecord(value) || typeof value.app !== 'string' || typeof value.text !== 'string') {
    throw new Error('computer-local: daemon returned a malformed app state')
  }
  const raw = value.screenshot
  if (raw === null || raw === undefined) return { app: value.app, text: value.text, screenshot: null }
  if (!isRecord(raw) || typeof raw.dataBase64 !== 'string' || typeof raw.width !== 'number' || typeof raw.height !== 'number') {
    throw new Error('computer-local: daemon returned a malformed screenshot')
  }
  if (!Number.isInteger(raw.width) || raw.width <= 0 || !Number.isInteger(raw.height) || raw.height <= 0) {
    throw new Error('computer-local: daemon screenshot dimensions must be positive integers')
  }
  const data = Buffer.from(raw.dataBase64, 'base64')
  if (data.byteLength === 0) throw new Error('computer-local: daemon screenshot decoded to zero bytes')
  if (data.byteLength > maxScreenshotBytes) {
    throw new Error(`computer-local: daemon screenshot of ${data.byteLength} bytes exceeds the ${maxScreenshotBytes}-byte bound`)
  }
  return { app: value.app, text: value.text, screenshot: { data, mediaType: 'image/jpeg', width: raw.width, height: raw.height } }
}

/**
 * Decode the daemon's `permission_status` result into the seam grant state.
 * @param value - the daemon result for `permission_status`.
 * @returns the canonical grant state.
 * @throws Error when the wire value violates the result shape.
 */
export function decodeRecordStatus(value: unknown): ComputerRecordStatus {
  if (!isRecord(value)
    || typeof value.recording !== 'boolean'
    || typeof value.maxDurationSec !== 'number'
  ) {
    throw new Error('computer-local: daemon returned a malformed record status')
  }
  return {
    recording: value.recording,
    maxDurationSec: value.maxDurationSec,
    ...typeof value.startTime === 'number' ? { startTime: value.startTime } : {},
    ...typeof value.elapsedSec === 'number' ? { elapsedSec: value.elapsedSec } : {},
    ...typeof value.path === 'string' ? { path: value.path } : {},
    ...typeof value.eventCount === 'number' ? { eventCount: value.eventCount } : {},
  }
}

export function decodePermissionStatus(value: unknown): ComputerPermissionStatus {
  if (!isRecord(value)
    || typeof value.accessibility !== 'boolean'
    || typeof value.screenRecording !== 'boolean'
    || typeof value.bundled !== 'boolean'
  ) {
    throw new Error('computer-local: daemon returned a malformed permission status')
  }
  return { accessibility: value.accessibility, screenRecording: value.screenRecording, bundled: value.bundled }
}

/**
 * One resident daemon: the spawned process plus the pending-call table and
 * line decoding for its stdout. Connection lifetime equals daemon lifetime —
 * when the process exits or its stdout ends, every pending call rejects and
 * the connection reports itself dead, after which the engine respawns.
 */
class DaemonConnection {
  /** The daemon's spawned tree; termination is tree-scoped by the subprocess seam. */
  readonly handle: SubprocessHandle
  private readonly decoder = new LineDecoder()
  private readonly pending = new Map<number, PendingCall>()
  private readonly stderrTail: SubprocessOutputReader | undefined
  private aliveFlag = true

  constructor(handle: SubprocessHandle) {
    this.handle = handle
    this.stderrTail = handle.collected.stderr
    handle.stdout?.on('data', (chunk: Buffer) => { this.onData(chunk) })
    handle.stdout?.on('end', () => { this.onDaemonEnd() })
    /* v8 ignore next -- a stream error surfaces through `done` as well; the crash test covers that settlement. */
    handle.stdout?.on('error', () => { this.onDaemonEnd() })
    void handle.done.then(
      () => { this.onDaemonEnd() },
      /* v8 ignore next -- a spawn rejection settles like a process exit; the crash test covers the exit path. */
      () => { this.onDaemonEnd() },
    )
    // A broken daemon pipe surfaces as this stream's error event (the write
    // callback does not reliably carry EPIPE); settle every in-flight write
    // with the write-failure contract instead of waiting for process exit.
    /* v8 ignore start -- a pipe error cannot be fabricated deterministically:
       node child-process pipes buffer writes to a closed peer instead of erroring. */
    handle.stdin?.on('error', (error) => {
      const reason = new Error(`computer-local: writing to the daemon failed: ${String(error)}`)
      for (const call of this.pending.values()) call.settle(reason)
      this.pending.clear()
    })
    /* v8 ignore stop */
  }

  /** Whether the daemon can still take requests. */
  get alive(): boolean {
    return this.aliveFlag
  }

  /** Process id of the daemon tree root (-1 when the spawn failed). */
  get pid(): number {
    return this.handle.pid
  }

  /** The retained daemon stderr tail for crash diagnostics. */
  private stderrDiagnostic(): string {
    /* v8 ignore next -- the reader is always present: this connection requested the collect disposition. */
    const text = this.stderrTail?.readFrom(0).text.trim() ?? ''
    return text.length === 0 ? '' : ` (daemon stderr: ${text.slice(-400)})`
  }

  private onData(chunk: Buffer): void {
    for (const line of this.decoder.push(chunk)) this.onLine(line)
  }

  private onLine(line: string): void {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      // A stray non-JSON stdout line is a protocol violation by our daemon:
      // silently dropping it would hide the bug behind a timeout.
      this.fail(new Error(`computer-local: daemon emitted a non-JSON stdout line: ${line.slice(0, 120)}`))
      return
    }
    const response = parseResponse(value)
    if (response === null) return
    const call = this.pending.get(response.id)
    if (call === undefined) return // late response after timeout/abort
    this.pending.delete(response.id)
    if (response.error !== undefined) {
      call.settle(new Error(`computer daemon error ${response.error.code}: ${response.error.message}`))
    } else {
      call.settle(null, response.result)
    }
  }

  private onDaemonEnd(): void {
    this.fail(new Error(`computer-local: computer-use daemon exited unexpectedly${this.stderrDiagnostic()}`))
  }

  /**
   * Reject every pending call with the given reason and mark the connection
   * dead. Idempotent — engine disposal and a racing process exit both call it.
   * @param reason - the failure handed to every unsettled caller.
   */
  fail(reason: Error): void {
    if (!this.aliveFlag) return
    this.aliveFlag = false
    for (const call of this.pending.values()) call.settle(reason)
    this.pending.clear()
  }

  /**
   * Register one pending call and write its request line. The caller's fused
   * deadline signal owns timeout and abort settlement; the connection only
   * correlates responses, daemon failures, and write failures.
   * @param id - unique numeric id for correlation.
   * @param method - the daemon method to invoke.
   * @param params - method parameters.
   * @param signal - the caller's fused deadline signal.
   * @returns the daemon's result, validated by the caller's operation decoder.
   */
  request(
    id: number,
    method: DaemonMethod,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      /* v8 ignore start -- the engine respawns a dead daemon before request(), so this guard defends direct connection users only. */
      if (!this.aliveFlag) {
        reject(new Error('computer-local: computer-use daemon is not running'))
        return
      }
      /* v8 ignore stop */
      // settle only runs after this synchronous block (a response line, an
      // abort event, or an async write callback), so the references below are
      // bound by then.
      const settle = (error: Error | null, value?: unknown): void => {
        this.pending.delete(id)
        signal?.removeEventListener('abort', onAbort)
        if (error !== null) reject(error)
        else resolve(value)
      }
      const onAbort = (): void => {
        settle(new Error(`computer-local: ${method} aborted`))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, { settle })
      // Write failures settle through the connection's stdin error listener,
      // which carries the broken-pipe reason to every in-flight call.
      this.handle.stdin?.write(buildRequest(id, method, params) + '\n')
    })
  }
}

/**
 * Local computer-use engine over the resident macOS helper daemon. The daemon
 * starts at load so its TCC preflight runs during startup — a missing grant
 * fails the load and unregisters the `ctx.computer` service. Once loaded it
 * survives across calls (its capture session owns per-app tree diffs), restarts
 * after a crash, and dies with the engine. Requests time out per call; aborts
 * from the caller's signal stop in-flight work without killing the daemon.
 */
export class LocalComputerEngine extends ComputerEngine {
  static inject = ['subprocess']

  static Config: z<Config> = z.object({
    helperPath: z.string(),
    helperArgs: z.array(z.string()).default([]),
    timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
    maxTimeoutMs: z.number().default(DEFAULT_MAX_TIMEOUT_MS),
    maxTreeBytes: z.number().default(DEFAULT_MAX_TREE_BYTES),
    maxScreenshotBytes: z.number().default(DEFAULT_MAX_SCREENSHOT_BYTES),
    graceMs: z.number().default(DEFAULT_GRACE_MS),
    foregroundApps: z.array(z.string()).default([]),
    browserIsolation: z.boolean().default(false),
    browserUrlAllow: z.array(z.string()).default([]),
    browserUrlDeny: z.array(z.string()).default([]),
    deniedApps: z.array(z.string()).default([]),
  })

  /** The currently authoritative config: the settings section, or the composition entry. */
  private source: () => ResolvedConfig

  /** The resident connection, present once the daemon has been started. */
  private connection: DaemonConnection | undefined

  /** Monotonic request-id counter, shared across daemon restarts. */
  private nextId = 1

  /** Validated config (schemastery applied the defaults before construction). */
  get config(): ResolvedConfig {
    return this.source()
  }

  constructor(ctx: Context, config: Config) {
    super(ctx)
    /* v8 ignore start -- platform gate: this package loads only on macOS; non-darwin hosts reject it here. */
    if (process.platform !== 'darwin') {
      throw new Error('computer-local: the desktop computer-use engine supports macOS only')
    }
    /* v8 ignore stop */
    // Schemastery fills these fields before construction; the type does not encode that step.
    const entry = config as ResolvedConfig
    assertServiceableComputerConfig(entry)
    this.source = () => entry
    installSettingsSection(ctx, COMPUTER_SETTINGS_NAMESPACE, LocalComputerEngine.Config, entry, {
      validate: assertServiceableComputerConfig,
      setSource: (current) => {
        this.source = current as () => ResolvedConfig
      },
      // Every field is read through the getter at each request, so nothing
      // derived from the source needs rebuilding when the document changes.
      onChange: () => {},
    })
    // Fail loud at load when no composition value, no environment value, and
    // no setup-CLI install name a daemon; a settings-document value present at
    // load also resolves here through the source getter.
    const helperPath = this.resolveHelperPath()
    if (helperPath === undefined || !existsSync(helperPath)) {
      throw new Error(
        `computer-local: no computer-use daemon at ${JSON.stringify(helperPath ?? null)} — `
        + "run 'npx @zibokapi/dsh-codex-computer-use' to build and install it "
        + '(or set helperPath / DSH_COMPUTER_HELPER_PATH)',
      )
    }
    ctx.effect(() => () => {
      const connection = this.connection
      this.connection = undefined
      if (connection !== undefined) {
        connection.fail(new Error('computer-local: engine disposed'))
        connection.handle.terminate()
      }
    }, 'computer-local daemon teardown')
  }

  /**
   * Load-time TCC preflight: spawn the daemon (whose startup `requestPermissions()`
   * prompts for each missing grant) and refuse to activate until both grants
   * are present. Rejection fails this fiber, which unregisters `ctx.computer`
   * and leaves the `@zibokapi/dsh-codex-computer-use/computer-tools` consumer (which injects `computer`)
   * unloaded as well — a missing permission means computer use is simply not
   * loaded, matching Codex's prompt-at-enable behavior.
   */
  async [Service.init](): Promise<void> {
    // `0` = no per-request timeout: answering the macOS TCC dialog is
    // user-paced, so this wait must not race a timer. A crashed daemon still
    // rejects through the connection's exit handler.
    const status = await this.permissionStatus(0)
    if (!status.bundled) {
      this.ctx.logger.warn(
        'computer-local: the daemon is not running from its signed app bundle, so macOS attributes '
        + 'permission prompts to the parent process (typically the terminal) instead of the helper; '
        + 'run `pnpm run build:native` and point helperPath at the .app executable for helper-attributed grants',
      )
    }
    const missing = [
      ...status.accessibility ? [] : ['Accessibility'],
      ...status.screenRecording ? [] : ['Screen Recording'],
    ]
    if (missing.length === 0) return
    throw new Error(
      `computer-local: macOS ${missing.join(' and ')} permission is not granted to the computer-use daemon; `
      + 'grant it in System Settings > Privacy & Security (the daemon opened the pane) and reload the plugin',
    )
  }

  /** Resolve the daemon path per spawn: settings/config, then the environment override, then the setup CLI's install location. */
  private resolveHelperPath(): string | undefined {
    const configured = this.source().helperPath?.trim()
    if (configured !== undefined && configured.length > 0) return configured
    const fromEnv = process.env[HELPER_PATH_ENV]?.trim()
    if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
    return defaultHelperPath()
  }

  /** The current daemon argv from the resolved path and extra args. */
  private daemonArgv(): readonly string[] {
    const helperPath = this.resolveHelperPath()
    if (helperPath === undefined || !existsSync(helperPath)) {
      throw new Error(
        `computer-local: no computer-use daemon at ${JSON.stringify(helperPath ?? null)} — `
        + "run 'npx @zibokapi/dsh-codex-computer-use' to build and install it "
        + '(or set helperPath / DSH_COMPUTER_HELPER_PATH)',
      )
    }
    /* v8 ignore next -- the schema defaults helperArgs to [], so the fallback guards a hand-built config only. */
    return [helperPath, ...(this.source().helperArgs ?? [])]
  }

  /** Process id of the resident daemon (spawned during the load-time preflight). */
  get pid(): number | undefined {
    return this.connection?.pid
  }

  /**
   * The live connection, starting the daemon when none is running. Starting
   * is synchronous until the spawn returns, so concurrent callers share one
   * connection and one daemon.
   * @returns the resident connection.
   */
  private currentConnection(): DaemonConnection {
    if (this.connection?.alive === true) return this.connection
    const source = this.source()
    const policyEnv = {
      ...foregroundAppsEnv(source.foregroundApps) ?? {},
      ...browserIsolationEnv(source.browserIsolation) ?? {},
      ...csvEnv(URL_ALLOW_ENV, source.browserUrlAllow) ?? {},
      ...csvEnv(URL_DENY_ENV, source.browserUrlDeny) ?? {},
      ...csvEnv(DENIED_APPS_ENV, source.deniedApps) ?? {},
    }
    const handle = this.ctx.subprocess.spawn({
      argv: this.daemonArgv(),
      cwd: process.cwd(),
      // The seam scrubs `DSH_*` names from the ambient environment, so the
      // deployment policies ride these explicit entries; undefined inherits.
      ...Object.keys(policyEnv).length > 0 ? { env: policyEnv } : {},
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: DAEMON_STDERR_TAIL_BYTES },
      },
      graceMs: this.source().graceMs,
    })
    this.connection = new DaemonConnection(handle)
    return this.connection
  }

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
  private async call(
    method: DaemonMethod,
    params: Record<string, unknown>,
    timeoutMs: number,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    using d = deadline(signal, timeoutMs, 'COMPUTER_TIMEOUT')
    const connection = this.currentConnection()
    try {
      return await connection.request(this.nextId++, method, params, d.signal)
    } catch (error: unknown) {
      // A deadline-driven settle reads as an abort rejection; reclassify into
      // the exact first cause the deadline library already recorded.
      if (d.signal.aborted && error instanceof Error && error.message.endsWith(' aborted')) {
        if (timeoutOf(d.signal, 'COMPUTER_TIMEOUT') !== undefined) {
          throw new Error(`computer-local: ${method} timed out after ${timeoutMs}ms`)
        }
        throw new Error(`computer-local: ${method} aborted`)
      }
      throw error
    }
  }

  resolve<T extends ComputerRequestBase>(request: T): ComputerExecSpec<T> {
    return {
      request,
      timeoutMs: clampTimeout(
        request.timeoutMs,
        this.source().timeoutMs,
        this.source().maxTimeoutMs,
        'computer-local: request.timeoutMs',
      ),
      ...request.signal ? { signal: request.signal } : {},
    }
  }

  async listApps(spec: ComputerExecSpec<ListAppsRequest>): Promise<ComputerApp[]> {
    const params = spec.request.order === undefined ? {} : { order: spec.request.order }
    return decodeApps(await this.call('list_apps', params, spec.timeoutMs, spec.signal))
  }

  /**
   * Read the daemon's macOS TCC grant state (Accessibility and Screen Recording).
   * @param timeoutMs - per-request timeout; `0` waits without a timeout (the
   *   load-time preflight passes `0` because the TCC dialog is user-paced).
   */
  async permissionStatus(timeoutMs = this.source().timeoutMs): Promise<ComputerPermissionStatus> {
    return decodePermissionStatus(await this.call('permission_status', {}, timeoutMs, undefined))
  }

  /**
   * Request the daemon's macOS TCC grants — this prompts the user through the
   * macOS dialogs (or opens System Settings on a remembered denial) — and
   * report the resulting grant state. Waits without a timeout: answering the
   * dialog is user-paced.
   */
  async requestPermissions(): Promise<ComputerPermissionStatus> {
    return decodePermissionStatus(await this.call('request_permissions', {}, 0, undefined))
  }

  async recordStart(): Promise<ComputerRecordStatus> {
    return decodeRecordStatus(await this.call('event_stream_start', {}, 0, undefined))
  }

  async recordStatus(): Promise<ComputerRecordStatus> {
    return decodeRecordStatus(await this.call('event_stream_status', {}, 0, undefined))
  }

  async recordStop(): Promise<ComputerRecordStatus> {
    return decodeRecordStatus(await this.call('event_stream_stop', {}, 0, undefined))
  }

  async getAppState(spec: ComputerExecSpec<GetAppStateRequest>): Promise<ComputerAppState> {
    const request = spec.request
    const params = {
      app: request.app,
      ...request.disableDiff === true ? { disableDiff: true } : {},
      ...request.cumulativeDiff === true ? { cumulativeDiff: true } : {},
      ...request.maxTreeNodes !== undefined ? { maxTreeNodes: request.maxTreeNodes } : {},
      ...request.maxTreeDepth !== undefined ? { maxTreeDepth: request.maxTreeDepth } : {},
    }
    const state = decodeAppState(
      await this.call('get_app_state', params, spec.timeoutMs, spec.signal),
      this.source().maxScreenshotBytes,
    )
    const byteBounded = truncateTreeText(state.text, this.source().maxTreeBytes)
    const charBounded = request.textLimit === 'max' || request.textLimit === undefined
      ? byteBounded
      : truncateTreeChars(byteBounded.text, Math.max(1, Math.floor(request.textLimit)))
    return {
      app: state.app,
      text: charBounded.text,
      truncated: charBounded.truncated,
      screenshot: state.screenshot,
    }
  }

  async click(spec: ComputerExecSpec<ClickRequest>): Promise<void> {
    const request = spec.request
    const params = {
      app: request.app,
      ...request.elementIndex !== undefined ? { elementIndex: request.elementIndex } : {},
      ...request.x !== undefined ? { x: request.x } : {},
      ...request.y !== undefined ? { y: request.y } : {},
      ...request.clickCount !== undefined ? { clickCount: request.clickCount } : {},
      ...request.mouseButton !== undefined ? { mouseButton: normalizeMouseButton(request.mouseButton) } : {},
      ...request.clickMethod !== undefined ? { clickMethod: request.clickMethod } : {},
    }
    await this.call('click', params, spec.timeoutMs, spec.signal)
  }

  async typeText(spec: ComputerExecSpec<TypeTextRequest>): Promise<void> {
    await this.call('type_text', { app: spec.request.app, text: spec.request.text }, spec.timeoutMs, spec.signal)
  }

  async pressKey(spec: ComputerExecSpec<PressKeyRequest>): Promise<string> {
    const value = await this.call('press_key', { app: spec.request.app, key: spec.request.key }, spec.timeoutMs, spec.signal)
    if (!isRecord(value) || (value.selectedText !== undefined && typeof value.selectedText !== 'string')) {
      throw new Error('computer-local: daemon returned a malformed press_key result')
    }
    return value.selectedText ?? ''
  }

  async scroll(spec: ComputerExecSpec<ScrollRequest>): Promise<void> {
    const request = spec.request
    await this.call('scroll', {
      app: request.app,
      elementIndex: request.elementIndex,
      direction: normalizeDirection(request.direction),
      ...request.pages !== undefined ? { pages: request.pages } : {},
    }, spec.timeoutMs, spec.signal)
  }

  async setValue(spec: ComputerExecSpec<SetValueRequest>): Promise<void> {
    const request = spec.request
    await this.call('set_value', { app: request.app, elementIndex: request.elementIndex, value: request.value }, spec.timeoutMs, spec.signal)
  }

  async selectText(spec: ComputerExecSpec<SelectTextRequest>): Promise<void> {
    const request = spec.request
    await this.call('select_text', {
      app: request.app,
      elementIndex: request.elementIndex,
      text: request.text,
      ...request.prefix !== undefined ? { prefix: request.prefix } : {},
      ...request.suffix !== undefined ? { suffix: request.suffix } : {},
      ...request.selectionType !== undefined ? { selectionType: request.selectionType } : {},
    }, spec.timeoutMs, spec.signal)
  }

  async drag(spec: ComputerExecSpec<DragRequest>): Promise<void> {
    const request = spec.request
    await this.call('drag', {
      app: request.app,
      fromX: request.fromX,
      fromY: request.fromY,
      toX: request.toX,
      toY: request.toY,
    }, spec.timeoutMs, spec.signal)
  }

  async performSecondaryAction(spec: ComputerExecSpec<PerformSecondaryActionRequest>): Promise<void> {
    const request = spec.request
    await this.call('perform_secondary_action', {
      app: request.app,
      elementIndex: request.elementIndex,
      action: request.action,
    }, spec.timeoutMs, spec.signal)
  }
}

export { DAEMON_METHODS }
export type { DaemonMethod } from './protocol.ts'
export { LineDecoder, buildRequest, parseResponse } from './protocol.ts'
export default LocalComputerEngine
