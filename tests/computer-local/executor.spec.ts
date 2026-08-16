/**
 * Local engine over the REAL subprocess seam and a fake resident daemon: the
 * daemon is the engine's external boundary (a macOS helper in production), so
 * the fake stands in for exactly that boundary while the spawn, JSON-RPC
 * framing, correlation, timeout/abort, restart, bound, and teardown paths
 * stay real. No live desktop is driven here.
 */

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalComputerEngine, HELPER_PATH_ENV, assertServiceableComputerConfig } from '../../src/computer-local/index.ts'
import type {
  ClickRequest,
  DragRequest,
  GetAppStateRequest,
  ListAppsRequest,
  PerformSecondaryActionRequest,
  PressKeyRequest,
  ScrollRequest,
  SelectTextRequest,
  SetValueRequest,
  TypeTextRequest,
} from '../../src/computer/index.ts'
import { TREE_TRUNCATED_MARK } from '../../src/computer/index.ts'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

const fixturePath = fileURLToPath(new URL('./fixtures/fake-daemon.mjs', import.meta.url))
const tmpRoot = mkdtempSync(join(tmpdir(), 'dsh-computer-local-spec-'))
const contexts: Context[] = []

async function setup(config: ConstructorParameters<typeof LocalComputerEngine>[1] = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalSubprocessRuntime)
  ;(ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir: tmpRoot }
  await ctx.plugin(LocalComputerEngine, { helperPath: process.execPath, helperArgs: [fixturePath], ...config })
  return { ctx, engine: ctx.computer as LocalComputerEngine }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  while (contexts.length > 0) {
    const ctx = contexts.pop()!
    await ctx.fiber.dispose()
  }
})

describe('LocalComputerEngine construction', () => {
  it('rejects invalid numeric config', async () => {
    await expect(setup({ timeoutMs: Number.NaN })).rejects.toThrow(/timeoutMs/)
    await expect(setup({ maxTimeoutMs: 0 })).rejects.toThrow(/maxTimeoutMs/)
    await expect(setup({ maxTreeBytes: -1 })).rejects.toThrow(/maxTreeBytes/)
    await expect(setup({ maxScreenshotBytes: 0 })).rejects.toThrow(/maxScreenshotBytes/)
    await expect(setup({ graceMs: 0 })).rejects.toThrow(/graceMs/)
    await expect(setup({ graceMs: MAX_TIMER_DELAY_MS + 1 }))
      .rejects.toThrow(`graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  })

  it('fails loud when no daemon path is configured or the path is missing', async () => {
    vi.stubEnv(HELPER_PATH_ENV, '')
    // Anchor the setup-CLI install fallback inside the empty temp root, so the
    // unconfigured engine deterministically finds no daemon on any machine.
    vi.stubEnv('DSH_HOME', tmpRoot)
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await expect(ctx.plugin(LocalComputerEngine, {}))
      .rejects.toThrow(/no computer-use daemon .*npx @zibokapi\/dsh-codex-computer-use/)
    await expect(ctx.plugin(LocalComputerEngine, { helperPath: resolve(tmpRoot, 'missing-daemon') }))
      .rejects.toThrow(/no computer-use daemon/)
    await ctx.fiber.dispose()
  })

  it('resolves the daemon path from the environment override', async () => {
    vi.stubEnv(HELPER_PATH_ENV, process.execPath)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalComputerEngine, { helperArgs: [fixturePath] })
    const apps = await ctx.computer.listApps(ctx.computer.resolve({}))
    expect(apps[0]?.id).toBe('com.apple.TextEdit')
  })

  it('falls back to the setup CLI install location when nothing is configured', async () => {
    vi.stubEnv(HELPER_PATH_ENV, '')
    const home = join(tmpRoot, 'fallback-home')
    vi.stubEnv('DSH_HOME', home)
    // An executable fake daemon at the exact path `npx @zibokapi/dsh-codex-computer-use`
    // installs: a shebang script that evaluates the fake-daemon fixture module.
    const executable = join(
      home, 'computer-use', 'dsh-computer-daemon.app', 'Contents', 'MacOS', 'dsh-computer-daemon',
    )
    mkdirSync(dirname(executable), { recursive: true })
    writeFileSync(executable, `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(fixturePath).href)})\n`)
    chmodSync(executable, 0o755)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalComputerEngine, {})
    const apps = await ctx.computer.listApps(ctx.computer.resolve({}))
    expect(apps[0]?.id).toBe('com.apple.TextEdit')
  })
})

describe('LocalComputerEngine operations', () => {
  it('lists apps with mapped metadata', async () => {
    const { engine } = await setup()
    const apps = await engine.listApps(engine.resolve<ListAppsRequest>({ order: 'usage' }))
    expect(apps).toEqual([
      { id: 'com.apple.TextEdit', displayName: 'TextEdit', isRunning: true, useCount: 3 },
      { id: 'com.apple.Safari', lastUsedDate: '2026-08-14T00:00:00Z' },
    ])
  })

  it('captures the full tree first and a marked diff after, with the screenshot decoded', async () => {
    const { engine } = await setup()
    const first = await engine.getAppState(engine.resolve<GetAppStateRequest>({ app: 'TextEdit' }))
    expect(first.text).toContain('0 standard window')
    expect(first.screenshot).toEqual({
      data: Buffer.from('fake-jpeg-TextEdit'),
      mediaType: 'image/jpeg',
      width: 100,
      height: 50,
    })
    const second = await engine.getAppState(engine.resolve<GetAppStateRequest>({ app: 'TextEdit' }))
    expect(second.text).toContain('The following is a diff from the previous accessibility tree')
    // disableDiff passes through to the daemon, which serves the full text on its first capture only;
    // the provider forwards the flag and the daemon's own session decides the text.
    expect(second.text).toContain('+ 2 button')
  })

  it('rejects a screenshot exceeding the deployment byte bound', async () => {
    const { engine } = await setup({ maxScreenshotBytes: 10 })
    await expect(engine.getAppState(engine.resolve<GetAppStateRequest>({ app: 'TextEdit' }))).rejects.toThrow(/exceeds the 10-byte bound/)
  })

  it('truncates oversized tree text at the byte bound with the completeness mark', async () => {
    const { engine } = await setup({ maxTreeBytes: 100 })
    const state = await engine.getAppState(engine.resolve<GetAppStateRequest>({ app: 'big' }))
    expect(state.truncated).toBe(true)
    expect(state.text.endsWith(TREE_TRUNCATED_MARK)).toBe(true)
    expect(Buffer.byteLength(state.text, 'utf8')).toBeLessThanOrEqual(100)
  })

  it('rejects a malformed app-state payload at the wire boundary', async () => {
    const { engine } = await setup()
    await expect(engine.getAppState(engine.resolve<GetAppStateRequest>({ app: 'malformed' }))).rejects.toThrow(/malformed app state/)
  })

  it('surfaces daemon protocol errors as call failures', async () => {
    const { engine } = await setup()
    await expect(engine.getAppState(engine.resolve<GetAppStateRequest>({ app: 'errorreply' })))
      .rejects.toThrow(/computer daemon error -32000: fixture failure/)
  })

  it('fails the connection on a non-JSON stdout line', async () => {
    const { engine } = await setup()
    await expect(engine.getAppState(engine.resolve<GetAppStateRequest>({ app: 'noise' }))).rejects.toThrow(/non-JSON stdout line/)
  })

  it('times out a silent daemon at the resolved bound', async () => {
    const { engine } = await setup()
    const spec = engine.resolve<GetAppStateRequest>({ app: 'slow', timeoutMs: 200 })
    expect(spec.timeoutMs).toBe(200)
    await expect(engine.getAppState(spec)).rejects.toThrow(/timed out after 200ms/)
  })

  it('aborts an in-flight request on the caller signal', async () => {
    const { engine } = await setup()
    const controller = new AbortController()
    const pending = engine.getAppState(engine.resolve<GetAppStateRequest>({ app: 'slow', timeoutMs: 5_000, signal: controller.signal }))
    setTimeout(() => { controller.abort() }, 50)
    await expect(pending).rejects.toThrow(/aborted/)
  })

  it('starts the daemon eagerly at load and restarts it after a crash', async () => {
    const { engine } = await setup()
    const eagerPid = engine.pid
    expect(eagerPid).toBeGreaterThan(0)
    await engine.listApps(engine.resolve<ListAppsRequest>({}))
    expect(engine.pid).toBe(eagerPid)
    await expect(engine.getAppState(engine.resolve<GetAppStateRequest>({ app: 'crash' }))).rejects.toThrow(/daemon exited unexpectedly/)
    // The engine self-heals on the next request with a fresh daemon.
    const apps = await engine.listApps(engine.resolve<ListAppsRequest>({}))
    expect(apps[0]?.id).toBe('com.apple.TextEdit')
    expect(engine.pid).toBeGreaterThan(0)
    expect(engine.pid).not.toBe(eagerPid)
  })

  it('reports the daemon stderr tail when a crash takes the daemon down', async () => {
    const { engine } = await setup()
    await engine.listApps(engine.resolve<ListAppsRequest>({}))
    await expect(engine.getAppState(engine.resolve<GetAppStateRequest>({ app: 'crash' })))
      .rejects.toThrow(/daemon exited unexpectedly.*fake daemon boom/)
  })

  it('drops late responses after a timeout settles the call', async () => {
    const { engine } = await setup()
    await expect(engine.getAppState(engine.resolve<GetAppStateRequest>({ app: 'late', timeoutMs: 100 })))
      .rejects.toThrow(/timed out after 100ms/)
    // The daemon's late line arrives while the engine is still running; it
    // must be dropped, not misrouted into a later request.
    await new Promise(resolve => setTimeout(resolve, 600))
    const apps = await engine.listApps(engine.resolve<ListAppsRequest>({}))
    expect(apps[0]?.id).toBe('com.apple.TextEdit')
  })

  it('ignores a well-formed non-response stdout line', async () => {
    const { engine } = await setup()
    const state = await engine.getAppState(engine.resolve<GetAppStateRequest>({ app: 'ignoreline' }))
    expect(state.text).toContain('0 window')
  })

  it('re-resolves the daemon path on each spawn, failing loud when it is gone', async () => {
    vi.stubEnv(HELPER_PATH_ENV, process.execPath)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalComputerEngine, { helperArgs: [fixturePath] })
    // Eager start spawned the daemon while the override was present.
    await expect(ctx.computer.listApps(ctx.computer.resolve<ListAppsRequest>({}))).resolves.toBeTruthy()
    // Crash the resident daemon, then remove the override: the respawn
    // re-resolves the path and fails loud.
    await expect(ctx.computer.getAppState(ctx.computer.resolve<GetAppStateRequest>({ app: 'crash' }))).rejects.toThrow(/daemon exited unexpectedly/)
    vi.stubEnv(HELPER_PATH_ENV, '')
    vi.stubEnv('DSH_HOME', tmpRoot)
    await expect(ctx.computer.listApps(ctx.computer.resolve<ListAppsRequest>({}))).rejects.toThrow(/no computer-use daemon/)
  })

  it('exposes the resolved config', async () => {
    const { engine } = await setup({ timeoutMs: 9_999, foregroundApps: ['com.a.Brave'] })
    expect(engine.config.timeoutMs).toBe(9_999)
    expect(engine.config.foregroundApps).toEqual(['com.a.Brave'])
  })

  it('reads the daemon permission status', async () => {
    const { engine } = await setup()
    await expect(engine.permissionStatus()).resolves.toEqual({ accessibility: true, screenRecording: true, bundled: true })
  })

  it('fails to load when a macOS grant is missing', async () => {
    vi.stubEnv('FIXTURE_PERMISSION_STATUS', JSON.stringify({ accessibility: false, screenRecording: true, bundled: true }))
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    ;(ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir: tmpRoot }
    await expect(ctx.plugin(LocalComputerEngine, { helperPath: process.execPath, helperArgs: [fixturePath] }))
      .rejects.toThrow(/Accessibility permission is not granted/)
    // The refused engine unregisters the seam: `ctx.computer` is unavailable.
    expect(ctx.get('computer')).toBeUndefined()
  })

  it('warns but still loads when the daemon runs unbundled', async () => {
    vi.stubEnv('FIXTURE_PERMISSION_STATUS', JSON.stringify({ accessibility: true, screenRecording: true, bundled: false }))
    const warnings: string[] = []
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    ;(ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir: tmpRoot }
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    await ctx.plugin(LocalComputerEngine, { helperPath: process.execPath, helperArgs: [fixturePath] })
    expect(warnings.some(w => w.includes('not running from its signed app bundle'))).toBe(true)
    // Unbundled attribution is a warning, not a refusal: the seam stays loaded.
    expect(ctx.get('computer')).toBeDefined()
  })

  it('covers the optional parameter variants across operations', async () => {
    const { engine } = await setup()
    await engine.click(engine.resolve<ClickRequest>({ app: 'a', elementIndex: 1 }))
    await engine.scroll(engine.resolve<ScrollRequest>({ app: 'a', elementIndex: 1, direction: 'up' }))
    await engine.selectText(engine.resolve<SelectTextRequest>({ app: 'a', elementIndex: 1, text: 't' }))
    await engine.getAppState(engine.resolve<GetAppStateRequest>({ app: 'a', disableDiff: true }))
    const apps = await engine.listApps(engine.resolve<ListAppsRequest>({}))
    expect(apps.length).toBeGreaterThan(0)
  })

  it('forwards every input method and its canonical vocabulary', async () => {
    const { engine } = await setup()
    await engine.click(engine.resolve<ClickRequest>({ app: 'a', x: 1, y: 2, mouseButton: 'l', clickCount: 2 }))
    await engine.typeText(engine.resolve<TypeTextRequest>({ app: 'a', text: 'hi' }))
    await engine.pressKey(engine.resolve<PressKeyRequest>({ app: 'a', key: 'Control_L+a' }))
    await engine.scroll(engine.resolve<ScrollRequest>({ app: 'a', elementIndex: 1, direction: 'd', pages: 0.5 }))
    await engine.setValue(engine.resolve<SetValueRequest>({ app: 'a', elementIndex: 1, value: 'v' }))
    await engine.selectText(engine.resolve<SelectTextRequest>({ app: 'a', elementIndex: 1, text: 't', prefix: 'p', suffix: 's', selectionType: 'text' }))
    await engine.drag(engine.resolve<DragRequest>({ app: 'a', fromX: 0, fromY: 0, toX: 1, toY: 1 }))
    await engine.performSecondaryAction(engine.resolve<PerformSecondaryActionRequest>({ app: 'a', elementIndex: 1, action: 'Raise' }))
    // Two captures prove the daemon session survived all input traffic and now
    // serves the diff shape (the fake daemon counts captures per process).
    await engine.getAppState(engine.resolve<GetAppStateRequest>({ app: 'a' }))
    const state = await engine.getAppState(engine.resolve<GetAppStateRequest>({ app: 'a' }))
    expect(state.text).toContain('diff')
  })
})

describe('LocalComputerEngine resolve', () => {
  it('fills the default timeout and caps overrides', async () => {
    const { engine } = await setup()
    expect(engine.resolve({}).timeoutMs).toBe(15_000)
    expect(engine.resolve({ timeoutMs: 9_000 }).timeoutMs).toBe(9_000)
    expect(engine.resolve({ timeoutMs: 999_999 }).timeoutMs).toBe(120_000)
    expect(() => engine.resolve({ timeoutMs: Number.NaN })).toThrow(/request\.timeoutMs/)
    expect(() => engine.resolve({ timeoutMs: -1 })).toThrow(/request\.timeoutMs/)
  })

  it('carries the caller signal onto the spec', async () => {
    const { engine } = await setup()
    const controller = new AbortController()
    expect(engine.resolve({ signal: controller.signal }).signal).toBe(controller.signal)
    expect(engine.resolve({}).signal).toBeUndefined()
  })
})

describe('LocalComputerEngine teardown', () => {
  it('terminates the resident daemon tree at engine disposal', async () => {
    const marker = join(tmpRoot, `marker-${Math.random().toString(36).slice(2)}.txt`)
    vi.stubEnv('FIXTURE_MARKER', marker)
    const { ctx, engine } = await setup()
    await engine.listApps(engine.resolve({}))
    const pid = engine.pid!
    expect(pid).toBeGreaterThan(0)
    await ctx.fiber.dispose()
    // The subprocess seam awaits whole-tree exit before disposal returns,
    // so the daemon is gone and its SIGTERM handler has run.
    expect(() => process.kill(pid, 0)).toThrow()
    expect(readFileSync(marker, 'utf8')).toBe('terminated')
  })
})

describe('assertServiceableComputerConfig', () => {
  it('accepts the default resolved section and rejects invalid fields', () => {
    expect(() => { assertServiceableComputerConfig({
      timeoutMs: 15_000, maxTimeoutMs: 120_000, maxTreeBytes: 256_000,
      maxScreenshotBytes: 2_097_152, graceMs: 3_000,
    }) }).not.toThrow()
    expect(() => { assertServiceableComputerConfig({
      timeoutMs: 15_000, maxTimeoutMs: 120_000, maxTreeBytes: 256_000,
      maxScreenshotBytes: 2_097_152, graceMs: Number.NaN,
    }) }).toThrow(/graceMs/)
  })
})
