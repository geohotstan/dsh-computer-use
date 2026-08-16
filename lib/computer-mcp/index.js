var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : Symbol.for("Symbol." + name);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function") __typeError("Object expected");
    var dispose, inner;
    if (async) dispose = value[__knownSymbol("asyncDispose")];
    if (dispose === void 0) {
      dispose = value[__knownSymbol("dispose")];
      if (async) inner = dispose;
    }
    if (typeof dispose !== "function") __typeError("Object not disposable");
    if (inner) dispose = function() {
      try {
        inner.call(this);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};
var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === "function" ? SuppressedError : function(e, s, m, _) {
    return _ = Error(m), _.name = "SuppressedError", _.error = e, _.suppressed = s, _;
  };
  var fail = (e) => error = hasError ? new E(e, error, "An error was suppressed during disposal") : (hasError = true, e);
  var next = (it) => {
    while (it = stack.pop()) {
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()));
      } catch (e) {
        fail(e);
      }
    }
    if (hasError) throw error;
  };
  return next();
};

// src/computer-mcp/index.ts
import { createInterface } from "node:readline";
import { Context as Context3 } from "@deepseek-ai/cordis";
import LocalSubprocessRuntime from "@deepseek-ai/dsh-subprocess-local";

// src/computer-local/index.ts
import { existsSync } from "node:fs";
import { Service as Service2 } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

// src/computer/index.ts
import { Service } from "@deepseek-ai/cordis";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";

// src/computer/render.ts
var TREE_TRUNCATED_MARK = "\n... (accessibility tree truncated at the capture byte limit)\n";
var DIRECTION_SPELLINGS = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  u: "up",
  d: "down",
  l: "left",
  r: "right"
};
var MOUSE_BUTTON_SPELLINGS = {
  left: "left",
  right: "right",
  middle: "middle",
  l: "left",
  r: "right",
  m: "middle"
};
function normalizeDirection(direction) {
  return DIRECTION_SPELLINGS[direction];
}
function normalizeMouseButton(mouseButton) {
  return MOUSE_BUTTON_SPELLINGS[mouseButton];
}
function truncateTreeText(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false };
  const markBytes = Buffer.byteLength(TREE_TRUNCATED_MARK, "utf8");
  if (markBytes >= maxBytes) return { text: TREE_TRUNCATED_MARK.slice(0, maxBytes), truncated: true };
  const budget = maxBytes - markBytes;
  let end = Math.min(text.length, budget);
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > budget) end -= 1;
  return { text: text.slice(0, end) + TREE_TRUNCATED_MARK, truncated: true };
}
function truncateTreeChars(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}
function formatAppStateEnvelope(state) {
  return state.text;
}
function listAppsText(apps) {
  if (apps.length === 0) return "No targetable apps found.";
  return apps.map((app) => {
    const name = app.displayName ?? app.id;
    const flags = [];
    if (app.isRunning === true) flags.push("running");
    if (app.lastUsedDate !== void 0) flags.push(`last-used=${app.lastUsedDate}`);
    if (app.useCount !== void 0) flags.push(`uses=${app.useCount}`);
    const suffix = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
    return `${name} \u2014 ${app.id}${suffix}`;
  }).join("\n");
}

// src/computer/index.ts
var COMPUTER_SETTINGS_NAMESPACE = settingsNamespace("computer");
var ComputerEngine = class extends Service {
  constructor(ctx) {
    super(ctx, "computer");
  }
};

// src/computer-local/index.ts
import { installSettingsSection } from "@deepseek-ai/dsh-settings";
import { clampTimeout, deadline, MAX_TIMER_DELAY_MS, timeoutOf } from "@deepseek-ai/dsh-timeout";

// src/computer-local/protocol.ts
function buildRequest(id, method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}
function parseResponse(value) {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value;
  if (candidate.jsonrpc !== "2.0" || typeof candidate.id !== "number") return null;
  if ("error" in candidate && candidate.error !== void 0) {
    if (typeof candidate.error !== "object" || candidate.error === null) return null;
    const error = candidate.error;
    if (typeof error.code !== "number" || typeof error.message !== "string") return null;
    return { jsonrpc: "2.0", id: candidate.id, error: { code: error.code, message: error.message } };
  }
  return { jsonrpc: "2.0", id: candidate.id, result: candidate.result };
}
var LineDecoder = class {
  buffer = "";
  /**
   * Feed one chunk of the daemon's stdout.
   * @param chunk - raw bytes received from the stream.
   * @returns every complete line the chunk closed.
   */
  push(chunk) {
    this.buffer += chunk.toString("utf8");
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines.filter((line) => line.length > 0);
  }
  /**
   * Drain the decoder at stream end.
   * @returns the unterminated tail as one line, or nothing when the stream ended on a newline.
   */
  end() {
    const tail = this.buffer;
    this.buffer = "";
    return tail.length > 0 ? [tail] : [];
  }
};

// src/setup/paths.ts
import { homedir } from "node:os";
import { join } from "node:path";
var DAEMON_APP_NAME = "dsh-computer-daemon.app";
var DAEMON_EXECUTABLE_NAME = "dsh-computer-daemon";
function expandTilde(value) {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}
function resolveInstallDir(env = process.env) {
  const home = env.DSH_HOME !== void 0 && env.DSH_HOME.length > 0 ? expandTilde(env.DSH_HOME) : join(homedir(), ".dsh");
  return join(home, "computer-use");
}
function daemonExecutableIn(installDir) {
  return join(installDir, DAEMON_APP_NAME, "Contents", "MacOS", DAEMON_EXECUTABLE_NAME);
}
function defaultHelperPath() {
  return daemonExecutableIn(resolveInstallDir());
}

// src/computer-local/index.ts
var HELPER_PATH_ENV = "DSH_COMPUTER_HELPER_PATH";
var FOREGROUND_APPS_ENV = "DSH_COMPUTER_FOREGROUND_APPS";
var BROWSER_ISOLATION_ENV = "DSH_COMPUTER_BROWSER_ISOLATION";
var URL_ALLOW_ENV = "DSH_COMPUTER_URL_ALLOW";
var URL_DENY_ENV = "DSH_COMPUTER_URL_DENY";
var DENIED_APPS_ENV = "DSH_COMPUTER_DENIED_APPS";
function foregroundAppsEnv(apps) {
  return csvEnv(FOREGROUND_APPS_ENV, apps);
}
function browserIsolationEnv(enabled) {
  return enabled ? { [BROWSER_ISOLATION_ENV]: "1" } : void 0;
}
function csvEnv(name, values) {
  const joined = values.map((value) => value.trim()).filter((value) => value.length > 0).join(",");
  return joined.length > 0 ? { [name]: joined } : void 0;
}
var DEFAULT_TIMEOUT_MS = 15e3;
var DEFAULT_MAX_TIMEOUT_MS = 12e4;
var DEFAULT_MAX_TREE_BYTES = 256e3;
var DEFAULT_MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
var DEFAULT_GRACE_MS = 3e3;
var DAEMON_STDERR_TAIL_BYTES = 64e3;
function assertPositiveFinite(name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`computer-local: ${name} must be a positive finite number`);
  }
}
function assertServiceableComputerConfig(config) {
  const resolved = config;
  assertPositiveFinite("timeoutMs", resolved.timeoutMs);
  assertPositiveFinite("maxTimeoutMs", resolved.maxTimeoutMs);
  assertPositiveFinite("maxTreeBytes", resolved.maxTreeBytes);
  assertPositiveFinite("maxScreenshotBytes", resolved.maxScreenshotBytes);
  assertPositiveFinite("graceMs", resolved.graceMs);
  if (resolved.graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`computer-local: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`);
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function decodeApps(value) {
  if (!Array.isArray(value)) throw new Error("computer-local: daemon returned a non-array app list");
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      throw new Error(`computer-local: daemon app entry ${index} lacks a string id`);
    }
    const app = { id: entry.id };
    const stringField = (name, raw) => {
      if (typeof raw !== "string") throw new Error(`computer-local: daemon app entry ${index} has a non-string ${name}`);
      app[name] = raw;
    };
    if (entry.displayName !== void 0) stringField("displayName", entry.displayName);
    if (entry.lastUsedDate !== void 0) stringField("lastUsedDate", entry.lastUsedDate);
    if (entry.isRunning !== void 0) {
      if (typeof entry.isRunning !== "boolean") throw new Error(`computer-local: daemon app entry ${index} has a non-boolean isRunning`);
      app.isRunning = entry.isRunning;
    }
    if (entry.useCount !== void 0) {
      if (typeof entry.useCount !== "number" || !Number.isInteger(entry.useCount) || entry.useCount < 0) {
        throw new Error(`computer-local: daemon app entry ${index} has a non-integer useCount`);
      }
      app.useCount = entry.useCount;
    }
    return app;
  });
}
function decodeAppState(value, maxScreenshotBytes) {
  if (!isRecord(value) || typeof value.app !== "string" || typeof value.text !== "string") {
    throw new Error("computer-local: daemon returned a malformed app state");
  }
  const raw = value.screenshot;
  if (raw === null || raw === void 0) return { app: value.app, text: value.text, screenshot: null };
  if (!isRecord(raw) || typeof raw.dataBase64 !== "string" || typeof raw.width !== "number" || typeof raw.height !== "number") {
    throw new Error("computer-local: daemon returned a malformed screenshot");
  }
  if (!Number.isInteger(raw.width) || raw.width <= 0 || !Number.isInteger(raw.height) || raw.height <= 0) {
    throw new Error("computer-local: daemon screenshot dimensions must be positive integers");
  }
  const data = Buffer.from(raw.dataBase64, "base64");
  if (data.byteLength === 0) throw new Error("computer-local: daemon screenshot decoded to zero bytes");
  if (data.byteLength > maxScreenshotBytes) {
    throw new Error(`computer-local: daemon screenshot of ${data.byteLength} bytes exceeds the ${maxScreenshotBytes}-byte bound`);
  }
  return { app: value.app, text: value.text, screenshot: { data, mediaType: "image/jpeg", width: raw.width, height: raw.height } };
}
function decodeRecordStatus(value) {
  if (!isRecord(value) || typeof value.recording !== "boolean" || typeof value.maxDurationSec !== "number") {
    throw new Error("computer-local: daemon returned a malformed record status");
  }
  return {
    recording: value.recording,
    maxDurationSec: value.maxDurationSec,
    ...typeof value.startTime === "number" ? { startTime: value.startTime } : {},
    ...typeof value.elapsedSec === "number" ? { elapsedSec: value.elapsedSec } : {},
    ...typeof value.path === "string" ? { path: value.path } : {},
    ...typeof value.eventCount === "number" ? { eventCount: value.eventCount } : {}
  };
}
function decodePermissionStatus(value) {
  if (!isRecord(value) || typeof value.accessibility !== "boolean" || typeof value.screenRecording !== "boolean" || typeof value.bundled !== "boolean") {
    throw new Error("computer-local: daemon returned a malformed permission status");
  }
  return { accessibility: value.accessibility, screenRecording: value.screenRecording, bundled: value.bundled };
}
var DaemonConnection = class {
  /** The daemon's spawned tree; termination is tree-scoped by the subprocess seam. */
  handle;
  decoder = new LineDecoder();
  pending = /* @__PURE__ */ new Map();
  stderrTail;
  aliveFlag = true;
  constructor(handle) {
    this.handle = handle;
    this.stderrTail = handle.collected.stderr;
    handle.stdout?.on("data", (chunk) => {
      this.onData(chunk);
    });
    handle.stdout?.on("end", () => {
      this.onDaemonEnd();
    });
    handle.stdout?.on("error", () => {
      this.onDaemonEnd();
    });
    void handle.done.then(
      () => {
        this.onDaemonEnd();
      },
      /* v8 ignore next -- a spawn rejection settles like a process exit; the crash test covers the exit path. */
      () => {
        this.onDaemonEnd();
      }
    );
    handle.stdin?.on("error", (error) => {
      const reason = new Error(`computer-local: writing to the daemon failed: ${String(error)}`);
      for (const call of this.pending.values()) call.settle(reason);
      this.pending.clear();
    });
  }
  /** Whether the daemon can still take requests. */
  get alive() {
    return this.aliveFlag;
  }
  /** Process id of the daemon tree root (-1 when the spawn failed). */
  get pid() {
    return this.handle.pid;
  }
  /** The retained daemon stderr tail for crash diagnostics. */
  stderrDiagnostic() {
    const text = this.stderrTail?.readFrom(0).text.trim() ?? "";
    return text.length === 0 ? "" : ` (daemon stderr: ${text.slice(-400)})`;
  }
  onData(chunk) {
    for (const line of this.decoder.push(chunk)) this.onLine(line);
  }
  onLine(line) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      this.fail(new Error(`computer-local: daemon emitted a non-JSON stdout line: ${line.slice(0, 120)}`));
      return;
    }
    const response = parseResponse(value);
    if (response === null) return;
    const call = this.pending.get(response.id);
    if (call === void 0) return;
    this.pending.delete(response.id);
    if (response.error !== void 0) {
      call.settle(new Error(`computer daemon error ${response.error.code}: ${response.error.message}`));
    } else {
      call.settle(null, response.result);
    }
  }
  onDaemonEnd() {
    this.fail(new Error(`computer-local: computer-use daemon exited unexpectedly${this.stderrDiagnostic()}`));
  }
  /**
   * Reject every pending call with the given reason and mark the connection
   * dead. Idempotent — engine disposal and a racing process exit both call it.
   * @param reason - the failure handed to every unsettled caller.
   */
  fail(reason) {
    if (!this.aliveFlag) return;
    this.aliveFlag = false;
    for (const call of this.pending.values()) call.settle(reason);
    this.pending.clear();
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
  request(id, method, params, signal) {
    return new Promise((resolve, reject) => {
      if (!this.aliveFlag) {
        reject(new Error("computer-local: computer-use daemon is not running"));
        return;
      }
      const settle = (error, value) => {
        this.pending.delete(id);
        signal?.removeEventListener("abort", onAbort);
        if (error !== null) reject(error);
        else resolve(value);
      };
      const onAbort = () => {
        settle(new Error(`computer-local: ${method} aborted`));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, { settle });
      this.handle.stdin?.write(buildRequest(id, method, params) + "\n");
    });
  }
};
var LocalComputerEngine = class _LocalComputerEngine extends ComputerEngine {
  static inject = ["subprocess"];
  static Config = z.object({
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
    deniedApps: z.array(z.string()).default([])
  });
  /** The currently authoritative config: the settings section, or the composition entry. */
  source;
  /** The resident connection, present once the daemon has been started. */
  connection;
  /** Monotonic request-id counter, shared across daemon restarts. */
  nextId = 1;
  /** Validated config (schemastery applied the defaults before construction). */
  get config() {
    return this.source();
  }
  constructor(ctx, config) {
    super(ctx);
    if (process.platform !== "darwin") {
      throw new Error("computer-local: the desktop computer-use engine supports macOS only");
    }
    const entry = config;
    assertServiceableComputerConfig(entry);
    this.source = () => entry;
    installSettingsSection(ctx, COMPUTER_SETTINGS_NAMESPACE, _LocalComputerEngine.Config, entry, {
      validate: assertServiceableComputerConfig,
      setSource: (current) => {
        this.source = current;
      },
      // Every field is read through the getter at each request, so nothing
      // derived from the source needs rebuilding when the document changes.
      onChange: () => {
      }
    });
    const helperPath = this.resolveHelperPath();
    if (helperPath === void 0 || !existsSync(helperPath)) {
      throw new Error(
        `computer-local: no computer-use daemon at ${JSON.stringify(helperPath ?? null)} \u2014 run 'npx @zibokapi/dsh-codex-computer-use' to build and install it (or set helperPath / DSH_COMPUTER_HELPER_PATH)`
      );
    }
    ctx.effect(() => () => {
      const connection = this.connection;
      this.connection = void 0;
      if (connection !== void 0) {
        connection.fail(new Error("computer-local: engine disposed"));
        connection.handle.terminate();
      }
    }, "computer-local daemon teardown");
  }
  /**
   * Load-time TCC preflight: spawn the daemon (whose startup `requestPermissions()`
   * prompts for each missing grant) and refuse to activate until both grants
   * are present. Rejection fails this fiber, which unregisters `ctx.computer`
   * and leaves the `@zibokapi/dsh-codex-computer-use/computer-tools` consumer (which injects `computer`)
   * unloaded as well — a missing permission means computer use is simply not
   * loaded, matching Codex's prompt-at-enable behavior.
   */
  async [Service2.init]() {
    const status = await this.permissionStatus(0);
    if (!status.bundled) {
      this.ctx.logger.warn(
        "computer-local: the daemon is not running from its signed app bundle, so macOS attributes permission prompts to the parent process (typically the terminal) instead of the helper; run `pnpm run build:native` and point helperPath at the .app executable for helper-attributed grants"
      );
    }
    const missing = [
      ...status.accessibility ? [] : ["Accessibility"],
      ...status.screenRecording ? [] : ["Screen Recording"]
    ];
    if (missing.length === 0) return;
    throw new Error(
      `computer-local: macOS ${missing.join(" and ")} permission is not granted to the computer-use daemon; grant it in System Settings > Privacy & Security (the daemon opened the pane) and reload the plugin`
    );
  }
  /** Resolve the daemon path per spawn: settings/config, then the environment override, then the setup CLI's install location. */
  resolveHelperPath() {
    const configured = this.source().helperPath?.trim();
    if (configured !== void 0 && configured.length > 0) return configured;
    const fromEnv = process.env[HELPER_PATH_ENV]?.trim();
    if (fromEnv !== void 0 && fromEnv.length > 0) return fromEnv;
    return defaultHelperPath();
  }
  /** The current daemon argv from the resolved path and extra args. */
  daemonArgv() {
    const helperPath = this.resolveHelperPath();
    if (helperPath === void 0 || !existsSync(helperPath)) {
      throw new Error(
        `computer-local: no computer-use daemon at ${JSON.stringify(helperPath ?? null)} \u2014 run 'npx @zibokapi/dsh-codex-computer-use' to build and install it (or set helperPath / DSH_COMPUTER_HELPER_PATH)`
      );
    }
    return [helperPath, ...this.source().helperArgs ?? []];
  }
  /** Process id of the resident daemon (spawned during the load-time preflight). */
  get pid() {
    return this.connection?.pid;
  }
  /**
   * The live connection, starting the daemon when none is running. Starting
   * is synchronous until the spawn returns, so concurrent callers share one
   * connection and one daemon.
   * @returns the resident connection.
   */
  currentConnection() {
    if (this.connection?.alive === true) return this.connection;
    const source = this.source();
    const policyEnv = {
      ...foregroundAppsEnv(source.foregroundApps) ?? {},
      ...browserIsolationEnv(source.browserIsolation) ?? {},
      ...csvEnv(URL_ALLOW_ENV, source.browserUrlAllow) ?? {},
      ...csvEnv(URL_DENY_ENV, source.browserUrlDeny) ?? {},
      ...csvEnv(DENIED_APPS_ENV, source.deniedApps) ?? {}
    };
    const handle = this.ctx.subprocess.spawn({
      argv: this.daemonArgv(),
      cwd: process.cwd(),
      // The seam scrubs `DSH_*` names from the ambient environment, so the
      // deployment policies ride these explicit entries; undefined inherits.
      ...Object.keys(policyEnv).length > 0 ? { env: policyEnv } : {},
      stdio: {
        stdin: "pipe",
        stdout: "pipe",
        stderr: { maxBytes: DAEMON_STDERR_TAIL_BYTES }
      },
      graceMs: this.source().graceMs
    });
    this.connection = new DaemonConnection(handle);
    return this.connection;
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
  async call(method, params, timeoutMs, signal) {
    var _stack = [];
    try {
      const d = __using(_stack, deadline(signal, timeoutMs, "COMPUTER_TIMEOUT"));
      const connection = this.currentConnection();
      try {
        return await connection.request(this.nextId++, method, params, d.signal);
      } catch (error) {
        if (d.signal.aborted && error instanceof Error && error.message.endsWith(" aborted")) {
          if (timeoutOf(d.signal, "COMPUTER_TIMEOUT") !== void 0) {
            throw new Error(`computer-local: ${method} timed out after ${timeoutMs}ms`);
          }
          throw new Error(`computer-local: ${method} aborted`);
        }
        throw error;
      }
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  resolve(request) {
    return {
      request,
      timeoutMs: clampTimeout(
        request.timeoutMs,
        this.source().timeoutMs,
        this.source().maxTimeoutMs,
        "computer-local: request.timeoutMs"
      ),
      ...request.signal ? { signal: request.signal } : {}
    };
  }
  async listApps(spec) {
    const params = spec.request.order === void 0 ? {} : { order: spec.request.order };
    return decodeApps(await this.call("list_apps", params, spec.timeoutMs, spec.signal));
  }
  /**
   * Read the daemon's macOS TCC grant state (Accessibility and Screen Recording).
   * @param timeoutMs - per-request timeout; `0` waits without a timeout (the
   *   load-time preflight passes `0` because the TCC dialog is user-paced).
   */
  async permissionStatus(timeoutMs = this.source().timeoutMs) {
    return decodePermissionStatus(await this.call("permission_status", {}, timeoutMs, void 0));
  }
  /**
   * Request the daemon's macOS TCC grants — this prompts the user through the
   * macOS dialogs (or opens System Settings on a remembered denial) — and
   * report the resulting grant state. Waits without a timeout: answering the
   * dialog is user-paced.
   */
  async requestPermissions() {
    return decodePermissionStatus(await this.call("request_permissions", {}, 0, void 0));
  }
  async recordStart() {
    return decodeRecordStatus(await this.call("event_stream_start", {}, 0, void 0));
  }
  async recordStatus() {
    return decodeRecordStatus(await this.call("event_stream_status", {}, 0, void 0));
  }
  async recordStop() {
    return decodeRecordStatus(await this.call("event_stream_stop", {}, 0, void 0));
  }
  async getAppState(spec) {
    const request = spec.request;
    const params = {
      app: request.app,
      ...request.disableDiff === true ? { disableDiff: true } : {},
      ...request.cumulativeDiff === true ? { cumulativeDiff: true } : {},
      ...request.maxTreeNodes !== void 0 ? { maxTreeNodes: request.maxTreeNodes } : {},
      ...request.maxTreeDepth !== void 0 ? { maxTreeDepth: request.maxTreeDepth } : {}
    };
    const state = decodeAppState(
      await this.call("get_app_state", params, spec.timeoutMs, spec.signal),
      this.source().maxScreenshotBytes
    );
    const byteBounded = truncateTreeText(state.text, this.source().maxTreeBytes);
    const charBounded = request.textLimit === "max" || request.textLimit === void 0 ? byteBounded : truncateTreeChars(byteBounded.text, Math.max(1, Math.floor(request.textLimit)));
    return {
      app: state.app,
      text: charBounded.text,
      truncated: charBounded.truncated,
      screenshot: state.screenshot
    };
  }
  async click(spec) {
    const request = spec.request;
    const params = {
      app: request.app,
      ...request.elementIndex !== void 0 ? { elementIndex: request.elementIndex } : {},
      ...request.x !== void 0 ? { x: request.x } : {},
      ...request.y !== void 0 ? { y: request.y } : {},
      ...request.clickCount !== void 0 ? { clickCount: request.clickCount } : {},
      ...request.mouseButton !== void 0 ? { mouseButton: normalizeMouseButton(request.mouseButton) } : {},
      ...request.clickMethod !== void 0 ? { clickMethod: request.clickMethod } : {}
    };
    await this.call("click", params, spec.timeoutMs, spec.signal);
  }
  async typeText(spec) {
    await this.call("type_text", { app: spec.request.app, text: spec.request.text }, spec.timeoutMs, spec.signal);
  }
  async pressKey(spec) {
    const value = await this.call("press_key", { app: spec.request.app, key: spec.request.key }, spec.timeoutMs, spec.signal);
    if (!isRecord(value) || value.selectedText !== void 0 && typeof value.selectedText !== "string") {
      throw new Error("computer-local: daemon returned a malformed press_key result");
    }
    return value.selectedText ?? "";
  }
  async scroll(spec) {
    const request = spec.request;
    await this.call("scroll", {
      app: request.app,
      elementIndex: request.elementIndex,
      direction: normalizeDirection(request.direction),
      ...request.pages !== void 0 ? { pages: request.pages } : {}
    }, spec.timeoutMs, spec.signal);
  }
  async setValue(spec) {
    const request = spec.request;
    await this.call("set_value", { app: request.app, elementIndex: request.elementIndex, value: request.value }, spec.timeoutMs, spec.signal);
  }
  async selectText(spec) {
    const request = spec.request;
    await this.call("select_text", {
      app: request.app,
      elementIndex: request.elementIndex,
      text: request.text,
      ...request.prefix !== void 0 ? { prefix: request.prefix } : {},
      ...request.suffix !== void 0 ? { suffix: request.suffix } : {},
      ...request.selectionType !== void 0 ? { selectionType: request.selectionType } : {}
    }, spec.timeoutMs, spec.signal);
  }
  async drag(spec) {
    const request = spec.request;
    await this.call("drag", {
      app: request.app,
      fromX: request.fromX,
      fromY: request.fromY,
      toX: request.toX,
      toY: request.toY
    }, spec.timeoutMs, spec.signal);
  }
  async performSecondaryAction(spec) {
    const request = spec.request;
    await this.call("perform_secondary_action", {
      app: request.app,
      elementIndex: request.elementIndex,
      action: request.action
    }, spec.timeoutMs, spec.signal);
  }
};

// src/computer-mcp/index.ts
var MCP_PROTOCOL_VERSION = "2025-03-26";
var MCP_SERVER_NAME = "dsh-computer-mcp";
var MCP_SERVER_VERSION = "0.1.0";
var TOOL_DEFINITIONS = [
  {
    name: "list_apps",
    description: "List the apps on this computer. Returns the set of apps that are currently running, as well as any that have been used in the last 14 days, including details on usage frequency.",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "get_app_state",
    description: "Start an app use session if needed, then get the state of the app's key window and return a screenshot and accessibility tree. This must be called once per assistant turn before interacting with the app.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", description: "App name or bundle identifier" },
        text_limit: {
          anyOf: [{ type: "integer" }, { type: "string", enum: ["max"] }],
          description: 'Maximum text characters to return. Use "max" for full text. Defaults to 500.'
        },
        max_tree_nodes: { type: "integer", description: "Maximum accessibility tree nodes to render. Defaults to 1200." },
        max_tree_depth: { type: "integer", description: "Maximum accessibility tree depth to render. Defaults to 64." },
        cumulative_diff: {
          type: "boolean",
          description: "Diff against the first capture of this app instead of the previous one. Defaults to false."
        }
      },
      required: ["app"]
    }
  },
  {
    name: "click",
    description: "Click an element by index or pixel coordinates from screenshot.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", description: "App name or bundle identifier" },
        element_index: { type: "string", description: "Element index to click" },
        x: { type: "number", description: "X coordinate in screenshot pixel coordinates" },
        y: { type: "number", description: "Y coordinate in screenshot pixel coordinates" },
        click_count: { type: "integer", description: "Number of clicks. Defaults to 1" },
        mouse_button: { type: "string", description: "Mouse button to click. Defaults to left.", enum: ["left", "right", "middle"] },
        click_method: {
          type: "string",
          description: "Click implementation: auto (default), accessibility, app_post, sky_click, or global. Accessibility requires element_index. app_post and sky_click run the SkyLight background-window recipe with no activation. Global may move the system pointer.",
          enum: ["auto", "accessibility", "app_post", "sky_click", "global"]
        }
      },
      required: ["app"]
    }
  },
  {
    name: "perform_secondary_action",
    description: "Invoke a secondary accessibility action exposed by an element.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", description: "App name or bundle identifier" },
        element_index: { type: "string", description: "Element identifier" },
        action: { type: "string", description: "Secondary accessibility action name" }
      },
      required: ["app", "element_index", "action"]
    }
  },
  {
    name: "scroll",
    description: "Scroll an element in a direction by a number of pages.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", description: "App name or bundle identifier" },
        direction: { type: "string", description: "Scroll direction: up, down, left, or right" },
        element_index: { type: "string", description: "Element identifier" },
        pages: { type: "number", description: "Number of pages to scroll. Fractional values are supported. Defaults to 1" }
      },
      required: ["app", "element_index", "direction"]
    }
  },
  {
    name: "drag",
    description: "Drag from one point to another using pixel coordinates.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", description: "App name or bundle identifier" },
        from_x: { type: "number", description: "Start X coordinate" },
        from_y: { type: "number", description: "Start Y coordinate" },
        to_x: { type: "number", description: "End X coordinate" },
        to_y: { type: "number", description: "End Y coordinate" }
      },
      required: ["app", "from_x", "from_y", "to_x", "to_y"]
    }
  },
  {
    name: "type_text",
    description: "Type literal text using keyboard input.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", description: "App name or bundle identifier" },
        text: { type: "string", description: "Literal text to type" }
      },
      required: ["app", "text"]
    }
  },
  {
    name: "press_key",
    description: 'Press a key or key-combination on the keyboard, including modifier and navigation keys.\n  - This supports xdotool\'s `key` syntax.\n  - Examples: "a", "Return", "Tab", "super+c", "Up", "KP_0" (for the numpad 0 key).',
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", description: "App name or bundle identifier" },
        key: { type: "string", description: "Key or key combination to press" }
      },
      required: ["app", "key"]
    }
  },
  {
    name: "set_value",
    description: "Set the value of a settable accessibility element.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", description: "App name or bundle identifier" },
        element_index: { type: "string", description: "Element identifier" },
        value: { type: "string", description: "Value to assign" }
      },
      required: ["app", "element_index", "value"]
    }
  },
  {
    name: "select_text",
    description: "Select text inside a text element, or place the text cursor before or after it. Provide the text exactly as it appears in the accessibility tree. When the text repeats, give surrounding prefix or suffix text to disambiguate it.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", description: "App name or bundle identifier" },
        element_index: { type: "string", description: "Element identifier" },
        text: { type: "string", description: "Text to locate within the element" },
        prefix: { type: "string", description: "Optional text immediately before the target to disambiguate matches" },
        suffix: { type: "string", description: "Optional text immediately after the target to disambiguate matches" },
        selection_type: {
          type: "string",
          enum: ["text", "cursor_before", "cursor_after"],
          description: "Whether to select the text or place the cursor before or after it. Defaults to text."
        }
      },
      required: ["app", "element_index", "text"]
    }
  },
  {
    name: "request_access",
    description: "Request the macOS Accessibility and Screen Recording permissions the computer-use daemon needs, prompting the user through the system dialogs, and report the resulting grant state.",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "event_stream_start",
    description: "Start recording the user's actions for up to 30 minutes. If a recording is already active, return that active session instead of starting another one.",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "event_stream_status",
    description: "Get the current or most recent Record & Replay recording status including paths to metadata and events during the recording.",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "event_stream_stop",
    description: "Stop the active event stream recording if one is running and return status including paths to metadata and events during the recording.",
    inputSchema: { type: "object", properties: {}, required: [] }
  }
];
var McpServer = class {
  ctx;
  engine;
  constructor(ctx, engine) {
    this.ctx = ctx;
    this.engine = engine;
  }
  /** Handle one MCP request and return the response payload (or undefined for notifications). */
  async handle(request) {
    switch (request.method) {
      case "initialize":
        return {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }
        };
      case "ping":
        return {};
      case "tools/list":
        return { tools: TOOL_DEFINITIONS.map((tool) => ({ ...tool })) };
      case "tools/call":
        return this.callTool(request.params ?? {});
      case "notifications/initialized":
      case "notifications/cancelled":
        return void 0;
      default:
        throw new McpError(-32601, `unknown method ${request.method}`);
    }
  }
  /** Route one `tools/call` to the engine, mirroring the official response behavior. */
  async callTool(params) {
    const name = params.name;
    const args = isRecord2(params.arguments) ? params.arguments : {};
    if (typeof name !== "string") throw new McpError(-32602, "tools/call requires a string name");
    try {
      const content = await this.executeTool(name, args);
      return { content };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: message }], isError: true };
    }
  }
  async executeTool(name, args) {
    switch (name) {
      case "list_apps":
        return [{ type: "text", text: listAppsText(await this.engine.listApps(this.engine.resolve({}))) }];
      case "get_app_state":
        return this.stateContent(await this.engine.getAppState(this.engine.resolve({
          app: stringArg(args, "app"),
          ...textLimitArg(args),
          ...positiveIntArg(args, "max_tree_nodes", "maxTreeNodes"),
          ...positiveIntArg(args, "max_tree_depth", "maxTreeDepth"),
          ...boolArg(args, "cumulative_diff", "cumulativeDiff")
        })));
      case "click": {
        await this.engine.click(this.engine.resolve({
          app: stringArg(args, "app"),
          ...intArg(args, "element_index", "elementIndex"),
          ...numberArg(args, "x"),
          ...numberArg(args, "y"),
          ...positiveIntArg(args, "click_count", "clickCount"),
          ...buttonArg(args),
          ...clickMethodArg(args)
        }));
        return this.stateContent(await this.postActionState(stringArg(args, "app")));
      }
      case "type_text":
        await this.engine.typeText(this.engine.resolve({ app: stringArg(args, "app"), text: stringArg(args, "text") }));
        return this.stateContent(await this.postActionState(stringArg(args, "app")));
      case "press_key": {
        const app = stringArg(args, "app");
        const selected = await this.engine.pressKey(this.engine.resolve({ app, key: stringArg(args, "key") }));
        const content = this.stateContent(await this.postActionState(app));
        if (selected.length > 0) {
          const first = content[0];
          const text = first !== void 0 && first.type === "text" ? first.text : "";
          return [{ type: "text", text: `${text}
Selected text: [${selected}]` }, ...content.slice(1)];
        }
        return content;
      }
      case "scroll":
        await this.engine.scroll(this.engine.resolve({
          app: stringArg(args, "app"),
          elementIndex: intRequired(args, "element_index"),
          direction: directionArg(args),
          ...numberArg(args, "pages")
        }));
        return this.stateContent(await this.postActionState(stringArg(args, "app")));
      case "set_value":
        await this.engine.setValue(this.engine.resolve({
          app: stringArg(args, "app"),
          elementIndex: intRequired(args, "element_index"),
          value: stringArg(args, "value")
        }));
        return this.stateContent(await this.postActionState(stringArg(args, "app")));
      case "select_text":
        await this.engine.selectText(this.engine.resolve({
          app: stringArg(args, "app"),
          elementIndex: intRequired(args, "element_index"),
          text: stringArg(args, "text"),
          ...optionalStringArg(args, "prefix"),
          ...optionalStringArg(args, "suffix"),
          ...selectionTypeArg(args)
        }));
        return this.stateContent(await this.postActionState(stringArg(args, "app")));
      case "drag":
        await this.engine.drag(this.engine.resolve({
          app: stringArg(args, "app"),
          fromX: numberRequired(args, "from_x"),
          fromY: numberRequired(args, "from_y"),
          toX: numberRequired(args, "to_x"),
          toY: numberRequired(args, "to_y")
        }));
        return this.stateContent(await this.postActionState(stringArg(args, "app")));
      case "perform_secondary_action":
        await this.engine.performSecondaryAction(this.engine.resolve({
          app: stringArg(args, "app"),
          elementIndex: intRequired(args, "element_index"),
          action: stringArg(args, "action")
        }));
        return this.stateContent(await this.postActionState(stringArg(args, "app")));
      case "request_access": {
        const status = await this.engine.requestPermissions();
        return [{
          type: "text",
          text: status.accessibility && status.screenRecording ? "Accessibility and Screen Recording permissions are granted." : [
            `Accessibility: ${status.accessibility ? "granted" : "not granted"}`,
            `Screen Recording: ${status.screenRecording ? "granted" : "not granted"}`,
            ...status.bundled ? [] : ["The daemon is not running from its signed app bundle; permission prompts may attribute to the parent process."],
            "Grant any missing permission in the dialog or System Settings pane that just appeared, then retry."
          ].join("\n")
        }];
      }
      case "event_stream_start":
        return this.recordStatusContent(await this.engine.recordStart());
      case "event_stream_status":
        return this.recordStatusContent(await this.engine.recordStatus());
      case "event_stream_stop":
        return this.recordStatusContent(await this.engine.recordStop());
      default:
        throw new McpError(-32602, `unknown tool ${name}`);
    }
  }
  /** The canonical recording status text block. */
  recordStatusContent(status) {
    return [{ type: "text", text: JSON.stringify(status) }];
  }
  /** The official action-response behavior: re-capture the app state after an action. */
  async postActionState(app) {
    return this.engine.getAppState(this.engine.resolve({ app, disableDiff: true }));
  }
  /** Canonical state content: verbatim tree text plus a JPEG image block when one was captured. */
  stateContent(state) {
    const blocks = [{ type: "text", text: formatAppStateEnvelope({ app: state.app, text: state.text }) }];
    if (state.screenshot !== null) {
      blocks.push({ type: "image", data: state.screenshot.data.toString("base64"), mimeType: "image/jpeg" });
    }
    return blocks;
  }
  /** Serve requests on stdin until the stream ends or the process is terminated. */
  async serve() {
    const lines = createInterface({ input: process.stdin, terminal: false });
    for await (const line of lines) {
      let payload;
      try {
        payload = JSON.parse(line);
      } catch {
        continue;
      }
      const request = parseRequest(payload);
      if (request === void 0) continue;
      try {
        const result = await this.handle(request);
        if (result !== void 0) writeResponse(request.id, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = error instanceof McpError ? error.code : -32603;
        writeError(request.id, code, message);
      }
    }
    await this.ctx.fiber.dispose();
  }
};
var McpError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
async function createServer(options = {}) {
  const helperPath = options.helperPath ?? process.env.DSH_COMPUTER_HELPER_PATH;
  if (helperPath === void 0 || helperPath.length === 0) {
    throw new Error("dsh-computer-mcp: no daemon path \u2014 pass it as the first argument or set DSH_COMPUTER_HELPER_PATH");
  }
  const ctx = new Context3();
  await ctx.plugin(LocalSubprocessRuntime);
  await ctx.plugin(LocalComputerEngine, { helperPath });
  return new McpServer(ctx, ctx.computer);
}
function writeResponse(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function writeError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}
function parseRequest(value) {
  if (!isRecord2(value)) return void 0;
  if (value.jsonrpc !== "2.0") return void 0;
  if (typeof value.id !== "number" && typeof value.id !== "string") return void 0;
  if (typeof value.method !== "string") return void 0;
  return {
    jsonrpc: "2.0",
    id: value.id,
    method: value.method,
    ...isRecord2(value.params) ? { params: value.params } : {}
  };
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringArg(args, name) {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) throw new McpError(-32602, `invalid ${name}`);
  return value;
}
function intArg(args, name, target) {
  const value = args[name];
  if (value === void 0) return {};
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed)) throw new McpError(-32602, `invalid ${name}`);
  return { [target]: parsed };
}
function intRequired(args, name) {
  const parsed = intArg(args, name, "elementIndex");
  const value = parsed.elementIndex;
  if (value === void 0) throw new McpError(-32602, `missing ${name}`);
  return value;
}
function positiveIntArg(args, name, target) {
  const parsed = intArg(args, name, target);
  const value = parsed[target];
  if (value !== void 0 && value <= 0) throw new McpError(-32602, `invalid ${name}`);
  return parsed;
}
function numberArg(args, name) {
  const value = args[name];
  if (value === void 0) return {};
  if (typeof value !== "number" || !Number.isFinite(value)) throw new McpError(-32602, `invalid ${name}`);
  return { [name]: value };
}
function numberRequired(args, name) {
  const value = args[name];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new McpError(-32602, `invalid ${name}`);
  return value;
}
function textLimitArg(args) {
  const value = args.text_limit;
  if (value === void 0) return {};
  if (value === "max") return { textLimit: "max" };
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) return { textLimit: value };
  if (typeof value === "string" && value.trim() !== "" && Number.isInteger(Number(value))) return { textLimit: Number(value) };
  throw new McpError(-32602, "invalid text_limit");
}
function buttonArg(args) {
  const value = args.mouse_button;
  if (value === void 0) return {};
  if (value === "left" || value === "right" || value === "middle" || value === "l" || value === "r" || value === "m") {
    return { mouseButton: value };
  }
  throw new McpError(-32602, "invalid mouse_button");
}
function clickMethodArg(args) {
  const value = args.click_method;
  if (value === void 0) return {};
  if (value === "auto" || value === "accessibility" || value === "app_post" || value === "sky_click" || value === "global") {
    return { clickMethod: value };
  }
  throw new McpError(-32602, "invalid click_method");
}
function directionArg(args) {
  const value = args.direction;
  if (value === "up" || value === "down" || value === "left" || value === "right" || value === "u" || value === "d" || value === "l" || value === "r") {
    return value;
  }
  throw new McpError(-32602, "invalid direction");
}
function optionalStringArg(args, name) {
  const value = args[name];
  if (value === void 0) return {};
  if (typeof value !== "string") throw new McpError(-32602, `invalid ${name}`);
  return { [name]: value };
}
function boolArg(args, name, target) {
  const value = args[name];
  if (value === void 0) return {};
  if (typeof value !== "boolean") throw new McpError(-32602, `invalid ${name}`);
  return { [target]: value };
}
function selectionTypeArg(args) {
  const value = args.selection_type;
  if (value === void 0) return {};
  if (value === "text" || value === "cursor_before" || value === "cursor_after") {
    return { selectionType: value };
  }
  throw new McpError(-32602, "invalid selection_type");
}
export {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  McpError,
  McpServer,
  TOOL_DEFINITIONS,
  createServer
};
