/**
 * Stack test over the REAL tool registry, the REAL local engine, and the
 * shipping policy with a fake approval channel: a scripted caller drives
 * gated control actions through `ctx.tools.execute` and asserts both the
 * granted flow (one ask, persisted grant) and the denied flow.
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
import * as ComputerPolicy from 'dsh-computer-policy'

const fixturePath = fileURLToPath(new URL('../../computer-local/tests/fixtures/fake-daemon.mjs', import.meta.url))
const tmpRoot = mkdtempSync(join(tmpdir(), 'dsh-computer-policy-stack-'))

class SpyApproval {
  calls: string[] = []
  outcome: 'allowed-once' | 'rejected' = 'allowed-once'

  request({ toolName }: { toolName: string }): 'allowed-once' | 'rejected' {
    this.calls.push(toolName)
    return this.outcome
  }
}

async function harness(approval: SpyApproval): Promise<Context> {
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
  ctx.provide('approval', approval)
  await ctx.plugin(ComputerPolicy)
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

describe('computer policy through the real stack', () => {
  it('asks once, persists the grant, and stops asking', async () => {
    const approval = new SpyApproval()
    const ctx = await harness(approval)
    const capture = await call(ctx, 'computer_use_get_app_state', { app: 'TextEdit' })
    expect(capture.isError).toBe(false)

    const first = await call(ctx, 'computer_use_click', { app: 'TextEdit', element_index: 0 })
    expect(first.isError).toBe(false)
    expect(approval.calls).toEqual(['computer_use_click'])

    const second = await call(ctx, 'computer_use_click', { app: 'TextEdit', element_index: 0 })
    expect(second.isError).toBe(false)
    expect(approval.calls).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('denies the action when the user rejects', async () => {
    const approval = new SpyApproval()
    approval.outcome = 'rejected'
    const ctx = await harness(approval)
    const result = await call(ctx, 'computer_use_type_text', { app: 'TextEdit', text: 'hi' })
    expect(result.isError).toBe(true)
    expect(result.error?.message ?? '').toContain('user rejected')
    await ctx.fiber.dispose()
  })
})
