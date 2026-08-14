/**
 * Stack test over the REAL tool registry and the REAL local engine with the
 * fake resident daemon (the only mocked boundary — the macOS desktop helper).
 * A scripted caller drives the shipping `computer_use_*` tools through
 * `ctx.tools.execute` and asserts the model-facing results end to end:
 * app listing, the capture envelope with the accessibility tree, and a
 * control action over the same engine session.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { LocalComputerEngine } from 'dsh-computer-local'
import * as ToolComputer from 'dsh-computer-tools'

const fixturePath = fileURLToPath(new URL('../../computer-local/tests/fixtures/fake-daemon.mjs', import.meta.url))
const tmpRoot = mkdtempSync(join(tmpdir(), 'dsh-computer-tools-stack-'))

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  ;(ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir: tmpRoot }
  await ctx.plugin(LocalComputerEngine, {
    helperPath: process.execPath,
    helperArgs: [fixturePath],
    timeoutMs: 5_000,
  })
  await ctx.plugin(ToolComputer, { enableScreenshots: false })
  return ctx
}

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(tmpRoot, { recursive: true, force: true })
})

let callCounter = 0
function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
    agent: { options: {}, session: { requestHeader: () => ({ config: {} }) } } as never,
  })
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

describe('computer use through the real stack', () => {
  it('lists apps, captures the app state, and runs a control action', async () => {
    const ctx = await harness()
    const listed = await call(ctx, 'computer_use_list_apps', {})
    expect(listed.isError).toBe(false)
    expect(text(listed)).toContain('TextEdit — com.apple.TextEdit [running')

    const captured = await call(ctx, 'computer_use_get_app_state', { app: 'TextEdit' })
    expect(captured.isError).toBe(false)
    expect(text(captured)).toContain('0 standard window')

    const clicked = await call(ctx, 'computer_use_click', { app: 'TextEdit', element_index: 0 })
    expect(clicked.isError).toBe(false)
    // The action answers with the post-action capture (a marked diff on the
    // second capture of the same fake-daemon session).
    expect(text(clicked)).toContain('diff from the previous accessibility tree')
    await ctx.fiber.dispose()
  })
})
