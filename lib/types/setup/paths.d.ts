/**
 * Shared install-location rules for the computer-use daemon setup.
 *
 * Both the setup CLI (`lib/setup.js`, dependency-free so `npx` can run it
 * standalone) and the engine (`computer-local`, which bundles this file in)
 * need the exact same stable location, so the rule lives here as pure
 * functions with no imports beyond Node builtins.
 *
 * The daemon is installed under the DSH home (`$DSH_HOME`, default `~/.dsh`)
 * rather than inside `node_modules` for two reasons: `node_modules` paths
 * change with every plugin update, and macOS TCC keys its Accessibility and
 * Screen Recording grants on the executable's on-disk path — a stable install
 * location keeps the grants valid across rebuilds of the plugin.
 * @module @zibokapi/dsh-codex-computer-use/setup/paths
 */
/** The `.app` bundle name of the bundled, signed daemon. */
export declare const DAEMON_APP_NAME = "dsh-computer-daemon.app";
/** The daemon executable's name inside the `.app` bundle. */
export declare const DAEMON_EXECUTABLE_NAME = "dsh-computer-daemon";
/**
 * Expand a leading `~` against the OS home, mirroring the harness's own
 * home-path expansion for user-supplied values.
 * @param value - a path that may begin with `~`, `~/`, or no tilde at all.
 * @returns the expanded path, or the original value when no tilde prefix is present.
 */
export declare function expandTilde(value: string): string;
/**
 * Resolve the stable directory the setup CLI installs the daemon `.app` into:
 * `<dsh home>/computer-use`, where the dsh home is `$DSH_HOME` (tilde-expanded)
 * or `~/.dsh` by default — the same rule the harness itself uses.
 * @param env - the environment to read `DSH_HOME` from (defaults to `process.env`).
 * @returns the absolute install directory.
 */
export declare function resolveInstallDir(env?: {
    DSH_HOME?: string | undefined;
}): string;
/**
 * The daemon executable's path inside an install directory.
 * @param installDir - the directory {@link resolveInstallDir} returned.
 * @returns the path to the executable inside the signed `.app` bundle.
 */
export declare function daemonExecutableIn(installDir: string): string;
/**
 * The engine's fallback daemon path: the executable the setup CLI installed
 * under the DSH home. Checked only after `helperPath` config and
 * {@link HELPER_PATH_ENV} come up empty, so an explicit configuration always
 * wins.
 * @returns the default daemon executable path on this machine.
 */
export declare function defaultHelperPath(): string;
//# sourceMappingURL=paths.d.ts.map