#!/usr/bin/env node

// src/setup/cli.ts
import { spawnSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join as join2 } from "node:path";

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

// src/setup/cli.ts
var USAGE = `dsh-codex-computer-use \u2014 build, install, and grant permissions to the computer-use daemon

Usage:
  dsh-codex-computer-use [options]        build + install the daemon, then ask for
                                          Accessibility and Screen Recording
  dsh-codex-computer-use status [options] report whether the daemon is installed

Options:
  --install-dir <dir>      install into <dir> instead of <dsh home>/computer-use
  --skip-permission-prompt build and install only; skip the TCC permission ask
  -h, --help               print this help
  --version                print the package version

The default install directory is $DSH_HOME/computer-use (~/.dsh/computer-use),
matching the engine's unconfigured helperPath fallback, so "dsh plugin add
@zibokapi/dsh-codex-computer-use" plus this command is a complete install.`;
var EXIT_PERMISSIONS = 3;
var PERMISSION_WAIT_MS = 18e4;
var PERMISSION_POLL_MS = 1e3;
function parseSetupArgs(argv) {
  const args = { command: "setup", skipPermissionPrompt: false, installDir: void 0 };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "setup") {
      args.command = "setup";
    } else if (argument === "status") {
      args.command = "status";
    } else if (argument === "-h" || argument === "--help") {
      args.command = "help";
    } else if (argument === "--version") {
      args.command = "version";
    } else if (argument === "--skip-permission-prompt") {
      args.skipPermissionPrompt = true;
    } else if (argument === "--install-dir") {
      const value = argv[++index];
      if (value === void 0 || value.length === 0) throw new Error("--install-dir needs a directory path");
      args.installDir = value;
    } else {
      throw new Error(`unknown argument: ${argument}

${USAGE}`);
    }
  }
  return args;
}
function platformError(platform) {
  return `the computer-use daemon drives macOS Accessibility and screen capture; this host is ${platform}.`;
}
function say(text) {
  process.stdout.write(`dsh-codex-computer-use: ${text}
`);
}
function fail(text) {
  process.stderr.write(`dsh-codex-computer-use: ${text}
`);
}
function packageRoot() {
  return fileURLToPath(new URL("..", import.meta.url));
}
function packageVersion(root) {
  try {
    const manifest = JSON.parse(readFileSync(join2(root, "package.json"), "utf8"));
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  return result.status ?? 1;
}
function decodePermissionReply(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error(`daemon emitted a non-JSON line: ${line.slice(0, 120)}`);
  }
  const record = value;
  if (record.id !== 1 || typeof record.result !== "object" || record.result === null) {
    throw new Error("daemon reply is not the expected permission status");
  }
  const result = record.result;
  if (typeof result.accessibility !== "boolean" || typeof result.screenRecording !== "boolean" || typeof result.bundled !== "boolean") {
    throw new Error("daemon returned a malformed permission status");
  }
  return {
    accessibility: result.accessibility,
    screenRecording: result.screenRecording,
    bundled: result.bundled
  };
}
var PermissionWatch = class {
  child;
  decoder = new TextDecoder();
  buffer = "";
  stderrTail = "";
  dead = false;
  nextId = 1;
  waiter;
  constructor(executable) {
    this.child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (chunk) => {
      this.onData(chunk);
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderrTail = (this.stderrTail + this.decoder.decode(chunk, { stream: true })).slice(-2e3);
    });
    this.child.on("exit", () => {
      this.dead = true;
      this.settle(null);
    });
    this.child.on("error", () => {
      this.stderrTail = `spawn failed: ${this.stderrTail}`.slice(-2e3);
      this.dead = true;
      this.settle(null);
    });
    this.child.stdin.on("error", () => {
    });
  }
  /** Whether the daemon is beyond further polling. */
  get exited() {
    return this.dead;
  }
  onData(chunk) {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    for (; ; ) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) return;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        this.stderrTail = `daemon emitted a non-JSON line: ${line.slice(0, 120)}
${this.stderrTail}`.slice(-2e3);
        continue;
      }
      const record = value;
      if (this.waiter !== void 0 && record.id === this.waiter.id) {
        if (typeof record.result !== "object" || record.result === null) {
          this.stderrTail = `daemon reply is not the expected permission status
${this.stderrTail}`.slice(-2e3);
          this.settle(null);
          return;
        }
        try {
          const status = decodePermissionReply(line);
          this.settle({ ...status, stderrTail: this.stderrTail });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.stderrTail = `${reason}
${this.stderrTail}`.slice(-2e3);
          this.settle(null);
        }
        return;
      }
    }
  }
  settle(status) {
    const waiter = this.waiter;
    this.waiter = void 0;
    waiter?.resolve(status);
  }
  /**
   * Poll the daemon's grant state once.
   * @param timeoutMs - cap for this poll; answering the TCC dialog is
   *   user-paced, so `null` — not a hang — is returned when the cap elapses.
   * @returns the reported grant state, or null when this poll timed out or the
   *   daemon died (its stderr tail is kept on {@link stderrTail}).
   */
  poll(timeoutMs) {
    if (this.dead || this.waiter !== void 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.waiter = { id, resolve };
      this.child.stdin.write(`${JSON.stringify({ id, method: "permission_status", params: {} })}
`);
      const timer = setTimeout(() => {
        this.settle(null);
      }, Math.max(0, timeoutMs));
      timer.unref?.();
    });
  }
  /** Terminate the daemon; safe to call after exit. */
  stop() {
    this.child.kill("SIGTERM");
    setTimeout(() => {
      this.child.kill("SIGKILL");
    }, 3e3).unref();
  }
};
function reportStatus(installDir) {
  const executable = daemonExecutableIn(installDir);
  say(`install directory: ${installDir}`);
  if (!existsSync(executable)) {
    fail(`no daemon installed \u2014 run 'dsh-codex-computer-use' (or 'npx @zibokapi/dsh-codex-computer-use') to set it up`);
    return 1;
  }
  const mode = statSync(executable).mode;
  say(`daemon: ${executable}`);
  say(`executable: ${(mode & 73) !== 0 ? "yes" : "no (re-run setup)"}`);
  say(`Accessibility and Screen Recording are requested when the daemon next starts (dsh asks at plugin load).`);
  return 0;
}
async function runSetupCli(args, platform = process.platform) {
  if (args.command === "help") {
    process.stdout.write(`${USAGE}
`);
    return 0;
  }
  const root = packageRoot();
  if (args.command === "version") {
    say(packageVersion(root));
    return 0;
  }
  const installDir = expandTilde(args.installDir ?? resolveInstallDir());
  if (args.command === "status") return reportStatus(installDir);
  if (platform !== "darwin") {
    fail(platformError(platform));
    return 1;
  }
  const nativeDir = join2(root, "native");
  if (!existsSync(join2(nativeDir, "Package.swift"))) {
    fail(`no Swift package at ${nativeDir} \u2014 the installed package is incomplete; reinstall it`);
    return 1;
  }
  if (run("xcode-select", ["-p"]) !== 0) {
    fail("Xcode Command Line Tools are required to build the daemon \u2014 install them with: xcode-select --install");
    return 1;
  }
  say("building the daemon with Swift (first build takes a few minutes)...");
  if (run("swift", ["build", "-c", "release", "--package-path", nativeDir]) !== 0) {
    fail("swift build failed \u2014 see the compiler output above");
    return 1;
  }
  const builtApp = join2(nativeDir, ".build", DAEMON_APP_NAME);
  if (run("bash", [join2(nativeDir, "scripts", "bundle.sh")], {
    env: { ...process.env, DSH_COMPUTER_VERSION: packageVersion(root) }
  }) !== 0 || !existsSync(builtApp)) {
    fail("bundling the daemon failed \u2014 see the output above");
    return 1;
  }
  mkdirSync(installDir, { recursive: true });
  rmSync(join2(installDir, DAEMON_APP_NAME), { recursive: true, force: true });
  if (run("cp", ["-R", builtApp, join2(installDir, DAEMON_APP_NAME)]) !== 0) {
    fail(`copying the daemon into ${installDir} failed`);
    return 1;
  }
  const installedApp = join2(installDir, DAEMON_APP_NAME);
  if (run("codesign", ["--verify", "--strict", installedApp]) !== 0) {
    if (run("codesign", ["--force", "--sign", "-", "--identifier", "com.deepseek-ai.dsh-computer-daemon", installedApp]) !== 0 || run("codesign", ["--verify", "--strict", installedApp]) !== 0) {
      fail("code-signing the installed daemon failed");
      return 1;
    }
  }
  const executable = daemonExecutableIn(installDir);
  say(`installed: ${executable}`);
  if (args.skipPermissionPrompt) return 0;
  say("asking macOS for Accessibility and Screen Recording \u2014 answer the two system dialogs");
  if (!existsSync(executable)) {
    fail(`the installed executable is missing: ${executable}`);
    return 1;
  }
  const watch = new PermissionWatch(executable);
  const deadlineAt = Date.now() + PERMISSION_WAIT_MS;
  try {
    for (; ; ) {
      const remaining = deadlineAt - Date.now();
      const status = await watch.poll(remaining);
      if (status !== null && status.accessibility && status.screenRecording) {
        say("Accessibility: granted");
        say("Screen Recording: granted");
        say("setup complete \u2014 computer use loads on the next dsh start, no configuration needed");
        return 0;
      }
      if (Date.now() >= deadlineAt) {
        const missing = [
          ...status?.accessibility ? [] : ["Accessibility"],
          ...status?.screenRecording ? [] : ["Screen Recording"]
        ];
        fail(`${missing.join(" and ")} not granted yet \u2014 enable the daemon in System Settings > Privacy & Security`);
        fail("the panes are already open; dsh re-checks the grants every time it loads the plugin");
        const diagnostics = watch.stderrTail.trim();
        if (diagnostics.length > 0) fail(`daemon diagnostics: ${diagnostics.slice(-400)}`);
        return EXIT_PERMISSIONS;
      }
      const granted = (label, value) => `${label}: ${value ? "granted" : "not granted"}`;
      say(`waiting for the grants (${granted("Accessibility", status?.accessibility ?? false)}, ${granted("Screen Recording", status?.screenRecording ?? false)})...`);
      await new Promise((resolve) => {
        setTimeout(resolve, PERMISSION_POLL_MS);
      });
    }
  } finally {
    watch.stop();
  }
}
function invokedAsBinary() {
  if (process.argv[1] === void 0) return false;
  const resolveOrSelf = (path) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  return resolveOrSelf(process.argv[1]) === resolveOrSelf(fileURLToPath(import.meta.url));
}
if (invokedAsBinary()) {
  try {
    process.exit(await runSetupCli(parseSetupArgs(process.argv.slice(2))));
  } catch (error) {
    process.stderr.write(`dsh-codex-computer-use: ${error instanceof Error ? error.message : String(error)}
`);
    process.exit(1);
  }
}
export {
  decodePermissionReply,
  parseSetupArgs,
  platformError,
  runSetupCli
};
