#!/usr/bin/env node
/**
 * The `dsh-codex-computer-use` binary — the one-command setup behind
 * `npx @zibokapi/dsh-codex-computer-use`. Builds the macOS helper daemon from
 * the `native/` directory that ships inside this package (registry tarball,
 * git checkout, or `dsh plugin add` install alike), bundles and signs it into
 * a stable location under the DSH home, then explicitly asks for the two TCC
 * grants it needs — Accessibility and Screen Recording — through the macOS
 * system dialogs.
 *
 * After this succeeds the engine needs no configuration: its `helperPath`
 * resolution falls back to the exact path installed here.
 *
 * The file must stay dependency-free (Node builtins only): `npx` runs it
 * standalone, where no harness profile and no peer dependency exists.
 * @module @zibokapi/dsh-codex-computer-use/setup/cli
 */import { spawnSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { DAEMON_APP_NAME, resolveInstallDir, daemonExecutableIn, expandTilde } from './paths.ts'

const USAGE = `dsh-codex-computer-use — build, install, and grant permissions to the computer-use daemon

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
@zibokapi/dsh-codex-computer-use" plus this command is a complete install.`

/** Exit code for "installed, but one or both TCC grants are still missing". */
const EXIT_PERMISSIONS = 3

/** How long the permission poll waits for the user to answer the dialogs, in milliseconds. */
const PERMISSION_WAIT_MS = 180_000
/** Interval between permission polls, in milliseconds. */
const PERMISSION_POLL_MS = 1_000

/** The parsed command line. */
export interface SetupCliArgs {
  command: 'setup' | 'status' | 'help' | 'version'
  skipPermissionPrompt: boolean
  installDir: string | undefined
}

/**
 * Parse the CLI argument vector into a command plus options.
 * @param argv - arguments after the binary name (e.g. `process.argv.slice(2)`).
 * @returns the parsed arguments.
 * @throws Error with usage guidance on an unknown flag or subcommand.
 */
export function parseSetupArgs(argv: readonly string[]): SetupCliArgs {
  const args: SetupCliArgs = { command: 'setup', skipPermissionPrompt: false, installDir: undefined }
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === 'setup') {
      args.command = 'setup'
    } else if (argument === 'status') {
      args.command = 'status'
    } else if (argument === '-h' || argument === '--help') {
      args.command = 'help'
    } else if (argument === '--version') {
      args.command = 'version'
    } else if (argument === '--skip-permission-prompt') {
      args.skipPermissionPrompt = true
    } else if (argument === '--install-dir') {
      const value = argv[++index]
      if (value === undefined || value.length === 0) throw new Error('--install-dir needs a directory path')
      args.installDir = value
    } else {
      throw new Error(`unknown argument: ${argument}\n\n${USAGE}`)
    }
  }
  return args
}

/** The message printed when the CLI runs on a platform the engine cannot support. */
export function platformError(platform: NodeJS.Platform): string {
  return `the computer-use daemon drives macOS Accessibility and screen capture; this host is ${platform}.`
}

/** Print a line to the terminal. */
function say(text: string): void {
  process.stdout.write(`dsh-codex-computer-use: ${text}\n`)
}

/** Print a failure line to the terminal. */
function fail(text: string): void {
  process.stderr.write(`dsh-codex-computer-use: ${text}\n`)
}

/** The package root this CLI ships in (lib/setup.js → one level up). */
function packageRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url))
}

/** Read the package version for `--version` and daemon bundle stamping. */
function packageVersion(root: string): string {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * Run one command, inheriting stdio so build progress streams to the user.
 * @returns the exit status, or 1 when the binary could not start.
 */
function run(command: string, args: readonly string[], options: { cwd?: string, env?: NodeJS.ProcessEnv } = {}): number {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  return result.status ?? 1
}

/** One `permission_status`/`request_permissions` exchange with a freshly spawned daemon. */
interface PermissionAsk {
  accessibility: boolean
  screenRecording: boolean
  bundled: boolean
  stderrTail: string
}

/** Narrow the daemon's wire reply into the grant-state record. */
export function decodePermissionReply(line: string): { accessibility: boolean, screenRecording: boolean, bundled: boolean } {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new Error(`daemon emitted a non-JSON line: ${line.slice(0, 120)}`)
  }
  const record = value as { id?: unknown, result?: unknown }
  if (record.id !== 1 || typeof record.result !== 'object' || record.result === null) {
    throw new Error('daemon reply is not the expected permission status')
  }
  const result = record.result as Record<string, unknown>
  if (typeof result.accessibility !== 'boolean'
    || typeof result.screenRecording !== 'boolean'
    || typeof result.bundled !== 'boolean') {
    throw new Error('daemon returned a malformed permission status')
  }
  return {
    accessibility: result.accessibility,
    screenRecording: result.screenRecording,
    bundled: result.bundled,
  }
}

/**
 * One resident daemon for the permission ask: spawned once (its startup
 * requests both TCC grants, showing the system dialogs at most once), then
 * polled over the same connection — requests sent while the startup request
 * still blocks inside the dialog are answered in order once it settles.
 */
class PermissionWatch {
  private readonly child
  private readonly decoder = new TextDecoder()
  private buffer = ''
  stderrTail = ''
  private dead = false
  private nextId = 1
  private waiter: { id: number, resolve: (status: PermissionAsk | null) => void } | undefined

  constructor(executable: string) {
    this.child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stdout.on('data', (chunk: Buffer) => { this.onData(chunk) })
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + this.decoder.decode(chunk, { stream: true })).slice(-2_000)
    })
    this.child.on('exit', () => {
      this.dead = true
      this.settle(null)
    })
    this.child.on('error', () => {
      this.stderrTail = `spawn failed: ${this.stderrTail}`.slice(-2_000)
      this.dead = true
      this.settle(null)
    })
    // EPIPE on a dead daemon surfaces through the exit path above.
    this.child.stdin.on('error', () => {})
  }

  /** Whether the daemon is beyond further polling. */
  get exited(): boolean {
    return this.dead
  }

  private onData(chunk: Buffer): void {
    this.buffer += this.decoder.decode(chunk, { stream: true })
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline === -1) return
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        this.stderrTail = `daemon emitted a non-JSON line: ${line.slice(0, 120)}\n${this.stderrTail}`.slice(-2_000)
        continue
      }
      const record = value as { id?: unknown, result?: unknown, error?: unknown }
      if (this.waiter !== undefined && record.id === this.waiter.id) {
        if (typeof record.result !== 'object' || record.result === null) {
          this.stderrTail = `daemon reply is not the expected permission status\n${this.stderrTail}`.slice(-2_000)
          this.settle(null)
          return
        }
        try {
          const status = decodePermissionReply(line)
          this.settle({ ...status, stderrTail: this.stderrTail })
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : String(error)
          this.stderrTail = `${reason}\n${this.stderrTail}`.slice(-2_000)
          this.settle(null)
        }
        return
      }
    }
  }

  private settle(status: PermissionAsk | null): void {
    const waiter = this.waiter
    this.waiter = undefined
    waiter?.resolve(status)
  }

  /**
   * Poll the daemon's grant state once.
   * @param timeoutMs - cap for this poll; answering the TCC dialog is
   *   user-paced, so `null` — not a hang — is returned when the cap elapses.
   * @returns the reported grant state, or null when this poll timed out or the
   *   daemon died (its stderr tail is kept on {@link stderrTail}).
   */
  poll(timeoutMs: number): Promise<PermissionAsk | null> {
    if (this.dead || this.waiter !== undefined) return Promise.resolve(null)
    return new Promise((resolve) => {
      const id = this.nextId++
      this.waiter = { id, resolve }
      this.child.stdin.write(`${JSON.stringify({ id, method: 'permission_status', params: {} })}\n`)
      const timer = setTimeout(() => { this.settle(null) }, Math.max(0, timeoutMs))
      timer.unref?.()
    })
  }

  /** Terminate the daemon; safe to call after exit. */
  stop(): void {
    this.child.kill('SIGTERM')
    setTimeout(() => { this.child.kill('SIGKILL') }, 3_000).unref()
  }
}

/** Report the daemon install state without spawning anything (spawning prompts for permissions). */
function reportStatus(installDir: string): number {
  const executable = daemonExecutableIn(installDir)
  say(`install directory: ${installDir}`)
  if (!existsSync(executable)) {
    fail(`no daemon installed — run 'dsh-codex-computer-use' (or 'npx @zibokapi/dsh-codex-computer-use') to set it up`)
    return 1
  }
  const mode = statSync(executable).mode
  say(`daemon: ${executable}`)
  say(`executable: ${(mode & 0o111) !== 0 ? 'yes' : 'no (re-run setup)'}`)
  say(`Accessibility and Screen Recording are requested when the daemon next starts (dsh asks at plugin load).`)
  return 0
}

/**
 * Entry point: dispatch the parsed command. Returns the process exit code.
 * @param args - the parsed arguments.
 * @param platform - the host platform (injected for testability).
 */
export async function runSetupCli(args: SetupCliArgs, platform: NodeJS.Platform = process.platform): Promise<number> {
  if (args.command === 'help') {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  const root = packageRoot()
  if (args.command === 'version') {
    say(packageVersion(root))
    return 0
  }
  const installDir = expandTilde(args.installDir ?? resolveInstallDir())
  if (args.command === 'status') return reportStatus(installDir)

  if (platform !== 'darwin') {
    fail(platformError(platform))
    return 1
  }
  const nativeDir = join(root, 'native')
  if (!existsSync(join(nativeDir, 'Package.swift'))) {
    fail(`no Swift package at ${nativeDir} — the installed package is incomplete; reinstall it`)
    return 1
  }
  if (run('xcode-select', ['-p']) !== 0) {
    fail('Xcode Command Line Tools are required to build the daemon — install them with: xcode-select --install')
    return 1
  }

  say('building the daemon with Swift (first build takes a few minutes)...')
  if (run('swift', ['build', '-c', 'release', '--package-path', nativeDir]) !== 0) {
    fail('swift build failed — see the compiler output above')
    return 1
  }

  const builtApp = join(nativeDir, '.build', DAEMON_APP_NAME)
  if (run('bash', [join(nativeDir, 'scripts', 'bundle.sh')], {
    env: { ...process.env, DSH_COMPUTER_VERSION: packageVersion(root) },
  }) !== 0 || !existsSync(builtApp)) {
    fail('bundling the daemon failed — see the output above')
    return 1
  }

  // Install to a stable path: TCC keys its grants on the executable's path,
  // and a node_modules path would change on every plugin update.
  mkdirSync(installDir, { recursive: true })
  rmSync(join(installDir, DAEMON_APP_NAME), { recursive: true, force: true })
  if (run('cp', ['-R', builtApp, join(installDir, DAEMON_APP_NAME)]) !== 0) {
    fail(`copying the daemon into ${installDir} failed`)
    return 1
  }
  const installedApp = join(installDir, DAEMON_APP_NAME)
  // A bundle copy can invalidate the code signature's sealed resources; re-sign
  // in place when verification fails so TCC always sees a valid signature.
  if (run('codesign', ['--verify', '--strict', installedApp]) !== 0) {
    if (run('codesign', ['--force', '--sign', '-', '--identifier', 'com.deepseek-ai.dsh-computer-daemon', installedApp]) !== 0
      || run('codesign', ['--verify', '--strict', installedApp]) !== 0) {
      fail('code-signing the installed daemon failed')
      return 1
    }
  }
  const executable = daemonExecutableIn(installDir)
  say(`installed: ${executable}`)

  if (args.skipPermissionPrompt) return 0
  say('asking macOS for Accessibility and Screen Recording — answer the two system dialogs')
  if (!existsSync(executable)) {
    fail(`the installed executable is missing: ${executable}`)
    return 1
  }

  // One daemon for the whole ask: its startup requests both grants (each
  // dialog appears at most once), then this loop polls the same connection.
  // Answering is user-paced — the startup request can block inside the system
  // dialog — so every poll is capped by the remaining wait budget.
  const watch = new PermissionWatch(executable)
  const deadlineAt = Date.now() + PERMISSION_WAIT_MS
  try {
    for (;;) {
      const remaining = deadlineAt - Date.now()
      const status = await watch.poll(remaining)
      if (status !== null && status.accessibility && status.screenRecording) {
        say('Accessibility: granted')
        say('Screen Recording: granted')
        say('setup complete — computer use loads on the next dsh start, no configuration needed')
        return 0
      }
      if (Date.now() >= deadlineAt) {
        const missing = [
          ...status?.accessibility ? [] : ['Accessibility'],
          ...status?.screenRecording ? [] : ['Screen Recording'],
        ]
        fail(`${missing.join(' and ')} not granted yet — enable the daemon in System Settings > Privacy & Security`)
        fail('the panes are already open; dsh re-checks the grants every time it loads the plugin')
        const diagnostics = watch.stderrTail.trim()
        if (diagnostics.length > 0) fail(`daemon diagnostics: ${diagnostics.slice(-400)}`)
        // Screen Recording granted mid-flight only takes effect after a daemon
        // restart, which every dsh boot performs — so not granted yet is not an
        // error for the setup itself, but exit non-zero so scripts can tell.
        return EXIT_PERMISSIONS
      }
      const granted = (label: string, value: boolean): string => `${label}: ${value ? 'granted' : 'not granted'}`
      say(`waiting for the grants (${granted('Accessibility', status?.accessibility ?? false)}, `
        + `${granted('Screen Recording', status?.screenRecording ?? false)})...`)
      await new Promise(resolve => { setTimeout(resolve, PERMISSION_POLL_MS) })
    }
  } finally {
    watch.stop()
  }
}

// Run only when executed as a binary (node_modules/.bin links are symlinks, so
// both sides resolve through realpath), staying inert under `import` in tests.
function invokedAsBinary(): boolean {
  if (process.argv[1] === undefined) return false
  const resolveOrSelf = (path: string): string => {
    try {
      return realpathSync(path)
    } catch {
      return path
    }
  }
  return resolveOrSelf(process.argv[1]) === resolveOrSelf(fileURLToPath(import.meta.url))
}

if (invokedAsBinary()) {
  try {
    process.exit(await runSetupCli(parseSetupArgs(process.argv.slice(2))))
  } catch (error: unknown) {
    process.stderr.write(`dsh-codex-computer-use: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
