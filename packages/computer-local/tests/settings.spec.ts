/** The `computer` settings section layered over the engine's composition entry. */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { COMPUTER_SETTINGS_NAMESPACE } from 'dsh-computer'
import { LocalComputerEngine } from 'dsh-computer-local'

const fixturePath = fileURLToPath(new URL('./fixtures/fake-daemon.mjs', import.meta.url))

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

async function boot(config: ConstructorParameters<typeof LocalComputerEngine>[1] = {}): Promise<{
  ctx: Context
  settingsFiber: Fiber
  engineFiber: Fiber
  engine: LocalComputerEngine
}> {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const engineFiber = ctx.plugin(LocalComputerEngine, {
    helperPath: process.execPath,
    helperArgs: [fixturePath],
    timeoutMs: 60_000,
    ...config,
  })
  await engineFiber.await()
  return { ctx, settingsFiber, engineFiber, engine: ctx.computer as LocalComputerEngine }
}

describe('computer settings section', () => {
  it('resolves the user layer over the composition entry', async () => {
    const bench = await boot()
    expect(bench.engine.config.timeoutMs).toBe(60_000)

    await bench.ctx.settings.update(COMPUTER_SETTINGS_NAMESPACE, { timeoutMs: 5_000 })

    expect(bench.engine.config.timeoutMs).toBe(5_000)
    await bench.ctx.fiber.dispose()
  })

  it('refuses a stored value the constructor would have rejected', async () => {
    const bench = await boot()

    await expect(bench.ctx.settings.update(COMPUTER_SETTINGS_NAMESPACE, { timeoutMs: 0 }))
      .rejects.toThrow(/positive finite/)

    expect(bench.engine.config.timeoutMs).toBe(60_000)
    await bench.ctx.fiber.dispose()
  })

  it('refuses a grace period longer than a timer can carry', async () => {
    const bench = await boot()

    await expect(bench.ctx.settings.update(COMPUTER_SETTINGS_NAMESPACE, { graceMs: Number.MAX_SAFE_INTEGER }))
      .rejects.toThrow(/graceMs must be no greater than/)

    await bench.ctx.fiber.dispose()
  })

  it('serves the stored section to every later read', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(COMPUTER_SETTINGS_NAMESPACE, { maxTreeBytes: 1_024 })

    expect(bench.engine.config.maxTreeBytes).toBe(1_024)
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(COMPUTER_SETTINGS_NAMESPACE, { timeoutMs: 5_000 })
    expect(bench.engine.config.timeoutMs).toBe(5_000)

    await bench.settingsFiber.dispose()

    expect(bench.engine.config.timeoutMs).toBe(60_000)
    await bench.ctx.fiber.dispose()
  })

  it('keeps the composition entry when no settings provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalComputerEngine, {
      helperPath: process.execPath,
      helperArgs: [fixturePath],
      timeoutMs: 1_234,
    })

    expect((ctx.computer as LocalComputerEngine).config.timeoutMs).toBe(1_234)
    await ctx.fiber.dispose()
  })

  it('releases the namespace when the engine unloads', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('computer')

    await bench.engineFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('computer')
    await bench.ctx.fiber.dispose()
  })
})
