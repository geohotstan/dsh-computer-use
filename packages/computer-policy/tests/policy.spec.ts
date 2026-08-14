/**
 * Policy tests over the REAL tool registry, settings service, and approval
 * resolution: reads pass, first control actions ask once and persist the
 * grant, rejections deny, always-confirm rules re-ask, and the gate fails
 * closed without an approval service. The engine and the approval channel
 * are the faked boundaries.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { ComputerEngine } from 'dsh-computer'
import type {
  ClickRequest,
  ComputerApp,
  ComputerAppState,
  ComputerExecSpec,
  ComputerPermissionStatus,
  ComputerRecordStatus,
  ComputerRequestBase,
  GetAppStateRequest,
  ListAppsRequest,
  PerformSecondaryActionRequest,
} from 'dsh-computer'
import * as ComputerPolicy from 'dsh-computer-policy'
import { COMPUTER_POLICY_NAMESPACE } from 'dsh-computer-policy'
import * as ToolComputer from 'dsh-computer-tools'

/** A minimal engine: canned reads; input methods are no-ops. */
class MockEngine extends ComputerEngine {
  resolve<T extends ComputerRequestBase>(request: T): ComputerExecSpec<T> {
    return { request, timeoutMs: request.timeoutMs ?? 1_000, ...request.signal ? { signal: request.signal } : {} }
  }

  async listApps(_spec: ComputerExecSpec<ListAppsRequest>): Promise<ComputerApp[]> { return [] }
  async getAppState(_spec: ComputerExecSpec<GetAppStateRequest>): Promise<ComputerAppState> {
    return { app: 'com.apple.TextEdit', text: '0 window', truncated: false, screenshot: null }
  }
  async click(_spec: ComputerExecSpec<ClickRequest>): Promise<void> {}
  async typeText(_spec: ComputerExecSpec<ClickRequest>): Promise<void> {}
  async pressKey(_spec: ComputerExecSpec<ClickRequest>): Promise<string> { return '' }
  async scroll(_spec: ComputerExecSpec<ClickRequest>): Promise<void> {}
  async setValue(_spec: ComputerExecSpec<ClickRequest>): Promise<void> {}
  async selectText(_spec: ComputerExecSpec<ClickRequest>): Promise<void> {}
  async drag(_spec: ComputerExecSpec<ClickRequest>): Promise<void> {}
  async performSecondaryAction(_spec: ComputerExecSpec<PerformSecondaryActionRequest>): Promise<void> {}
  async permissionStatus(): Promise<ComputerPermissionStatus> { return { accessibility: true, screenRecording: true, bundled: true } }
  async requestPermissions(): Promise<ComputerPermissionStatus> { return { accessibility: true, screenRecording: true, bundled: true } }
  async recordStart(): Promise<ComputerRecordStatus> { return { recording: false, maxDurationSec: 1800 } }
  async recordStatus(): Promise<ComputerRecordStatus> { return { recording: false, maxDurationSec: 1800 } }
  async recordStop(): Promise<ComputerRecordStatus> { return { recording: false, maxDurationSec: 1800 } }
}

/** The smallest real settings provider: one in-memory document. */
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

type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

class SpyApproval {
  calls: string[] = []
  outcome: ApprovalOutcome = 'allowed-once'

  request({ toolName, reason }: { toolName: string; reason?: string }): ApprovalOutcome {
    this.calls.push(`${toolName}:${reason ?? ''}`)
    return this.outcome
  }
}

type AnswerChoice = 'session' | 'persistent' | 'deny'

interface QuestionShape {
  id: string
  question: string
  header?: string
  detail?: string
  options?: Array<{ label: string }>
}

class SpyQuestions {
  calls: string[] = []
  choice: AnswerChoice = 'session'
  sendChoice: 'send' | 'cancel' = 'send'
  sendDetails: Array<string | undefined> = []
  failure: Error | undefined

  ask(request: { questions: QuestionShape[] }): Promise<{ answers: Array<{ id: string; selected: string[] }> }> {
    const question = request.questions[0]
    this.calls.push(`${question?.header ?? ''}:${question?.question ?? ''}`)
    if (this.failure !== undefined) return Promise.reject(this.failure)
    if (question?.id === 'computer-use-send-approval') {
      this.sendDetails.push(question.detail)
      const label = this.sendChoice === 'send' ? 'Send' : 'Cancel'
      return Promise.resolve({ answers: [{ id: 'computer-use-send-approval', selected: [label] }] })
    }
    const label = this.choice === 'session' ? 'Allow once' : this.choice === 'persistent' ? 'Always allow' : 'Deny'
    return Promise.resolve({ answers: [{ id: 'computer-use-app-grant', selected: [label] }] })
  }
}

async function setup(options: {
  config?: ComputerPolicy.Config
  approval?: SpyApproval
  questions?: SpyQuestions
  settings?: boolean
} = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (options.settings !== false) await ctx.plugin(MemorySettings)
  if (options.approval !== undefined) ctx.provide('approval', options.approval)
  if (options.questions !== undefined) ctx.provide('userQuestions', options.questions)
  await ctx.plugin(MockEngine)
  await ctx.plugin(ToolComputer, { enableScreenshots: false })
  await ctx.plugin(ComputerPolicy, options.config ?? {})
  return ctx
}

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

describe('computer-policy', () => {
  it('lists the approved applications through list_granted_applications', async () => {
    const ctx = await setup({ config: { allowlistApps: ['com.apple.TextEdit', 'com.a.Brave'] } })
    const result = await call(ctx, 'computer_use_list_granted_applications', {})
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({ applications: ['com.apple.TextEdit', 'com.a.Brave'] })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain('com.a.Brave')
  })

  it('passes through malformed arguments for the tool to validate', async () => {
    const approval = new SpyApproval()
    const ctx = await setup({ approval })
    const nonObject = await call(ctx, 'computer_use_click', 42)
    expect(nonObject.isError).toBe(true)
    const emptyApp = await call(ctx, 'computer_use_click', { app: '  ' })
    expect(emptyApp.isError).toBe(true)
    expect(approval.calls).toEqual([])
    await ctx.fiber.dispose()
  })

  it('never gates the read tools', async () => {
    const approval = new SpyApproval()
    const ctx = await setup({ approval })
    const listed = await call(ctx, 'computer_use_list_apps', {})
    const captured = await call(ctx, 'computer_use_get_app_state', { app: 'TextEdit' })
    expect(listed.isError).toBe(false)
    expect(captured.isError).toBe(false)
    expect(approval.calls).toEqual([])
    await ctx.fiber.dispose()
  })

  it('asks once for the first control action and persists the grant', async () => {
    const approval = new SpyApproval()
    const ctx = await setup({ approval })
    const first = await call(ctx, 'computer_use_click', { app: 'TextEdit', element_index: 0 })
    expect(first.isError).toBe(false)
    expect(approval.calls).toEqual(['computer_use_click:Computer Use needs your approval to control TextEdit'])
    // The grant persists through the settings user layer.
    const second = await call(ctx, 'computer_use_click', { app: 'TextEdit', element_index: 0 })
    expect(second.isError).toBe(false)
    expect(approval.calls).toHaveLength(1)
    expect(ctx.settings.describe().map(row => String(row.ns))).toContain('computer-policy')
    await ctx.fiber.dispose()
  })

  it('offers a session grant through the user-questions channel', async () => {
    const questions = new SpyQuestions()
    questions.choice = 'session'
    const ctx = await setup({ questions })
    const first = await call(ctx, 'computer_use_click', { app: 'TextEdit', element_index: 0 })
    expect(first.isError).toBe(false)
    expect(questions.calls).toEqual(['Computer Use access:Allow Computer Use to control TextEdit?'])
    // The once grant covers later actions without re-asking, but stays out of
    // the persistent layer.
    const second = await call(ctx, 'computer_use_click', { app: 'TextEdit', element_index: 0 })
    expect(second.isError).toBe(false)
    expect(questions.calls).toHaveLength(1)
    const listed = await call(ctx, 'computer_use_list_granted_applications', {})
    expect(listed.value).toEqual({ applications: [] })
    await ctx.fiber.dispose()
  })

  it('persists an always-allow grant through the user-questions channel', async () => {
    const questions = new SpyQuestions()
    questions.choice = 'persistent'
    const ctx = await setup({ questions })
    const first = await call(ctx, 'computer_use_type_text', { app: 'TextEdit', text: 'hi' })
    expect(first.isError).toBe(false)
    const second = await call(ctx, 'computer_use_type_text', { app: 'TextEdit', text: 'hi' })
    expect(second.isError).toBe(false)
    expect(questions.calls).toHaveLength(1)
    const listed = await call(ctx, 'computer_use_list_granted_applications', {})
    expect(listed.value).toEqual({ applications: ['TextEdit'] })
    await ctx.fiber.dispose()
  })

  it('denies through the user-questions channel and asks again next time', async () => {
    const questions = new SpyQuestions()
    questions.choice = 'deny'
    const ctx = await setup({ questions })
    const first = await call(ctx, 'computer_use_click', { app: 'TextEdit', element_index: 0 })
    expect(first.isError).toBe(true)
    expect(first.error?.message ?? '').toContain('denied Computer Use access')
    expect(questions.calls).toHaveLength(1)
    const second = await call(ctx, 'computer_use_click', { app: 'TextEdit', element_index: 0 })
    expect(second.isError).toBe(true)
    expect(questions.calls).toHaveLength(2)
    await ctx.fiber.dispose()
  })

  it('falls back to the approval seam when the user-questions ask fails', async () => {
    const approval = new SpyApproval()
    const questions = new SpyQuestions()
    questions.failure = new Error('NO_PROVIDER')
    const ctx = await setup({ approval, questions })
    const result = await call(ctx, 'computer_use_click', { app: 'TextEdit', element_index: 0 })
    expect(result.isError).toBe(false)
    expect(approval.calls).toEqual(['computer_use_click:Computer Use needs your approval to control TextEdit'])
    await ctx.fiber.dispose()
  })

  it('requires send approval on configured apps and shows the composed text', async () => {
    const questions = new SpyQuestions()
    const ctx = await setup({ questions, config: { sendApprovalApps: ['com.apple.mail'] } })
    const result = await call(ctx, 'computer_use_press_key', { app: 'com.apple.mail', key: 'super+Return' })
    expect(result.isError).toBe(false)
    expect(questions.calls).toEqual(['Send approval:Send this message in com.apple.mail?'])
    expect(questions.sendDetails).toEqual(['0 window'])
    // The send approval never grants: the next send asks again.
    await call(ctx, 'computer_use_press_key', { app: 'com.apple.mail', key: 'Return' })
    expect(questions.calls).toHaveLength(2)
    await ctx.fiber.dispose()
  })

  it('cancels a send when the user declines', async () => {
    const questions = new SpyQuestions()
    questions.sendChoice = 'cancel'
    const ctx = await setup({ questions, config: { sendApprovalApps: ['com.apple.mail'] } })
    const result = await call(ctx, 'computer_use_type_text', { app: 'com.apple.mail', text: 'hello\n' })
    expect(result.isError).toBe(true)
    expect(result.error?.message ?? '').toContain('cancelled sending the message in com.apple.mail')
    await ctx.fiber.dispose()
  })

  it('falls back to the approval seam for send approval without a questions channel', async () => {
    const approval = new SpyApproval()
    const ctx = await setup({ approval, config: { sendApprovalApps: ['com.apple.mail'] } })
    const result = await call(ctx, 'computer_use_press_key', { app: 'com.apple.mail', key: 'Return' })
    expect(result.isError).toBe(false)
    expect(approval.calls).toEqual(['computer_use_press_key:sending a message in com.apple.mail requires approval'])
    await ctx.fiber.dispose()
  })

  it('gates recording starts through the approval seam and leaves status and stop ungated', async () => {
    const approval = new SpyApproval()
    const ctx = await setup({ approval })
    const started = await call(ctx, 'computer_use_record_start', {})
    expect(started.isError).toBe(false)
    expect(approval.calls).toEqual(['computer_use_record_start:recording your actions requires approval'])
    const status = await call(ctx, 'computer_use_record_status', {})
    expect(status.isError).toBe(false)
    const stopped = await call(ctx, 'computer_use_record_stop', {})
    expect(stopped.isError).toBe(false)
    expect(approval.calls).toHaveLength(1)

    approval.outcome = 'rejected'
    const refused = await call(ctx, 'computer_use_record_start', {})
    expect(refused.isError).toBe(true)
    expect(refused.error?.message ?? '').toContain('user rejected')
    await ctx.fiber.dispose()
  })

  it('leaves non-send actions on send-approval apps on the ordinary grant path', async () => {
    const approval = new SpyApproval()
    const ctx = await setup({ approval, config: { sendApprovalApps: ['com.apple.mail'] } })
    const click = await call(ctx, 'computer_use_click', { app: 'com.apple.mail', element_index: 0 })
    expect(click.isError).toBe(false)
    expect(approval.calls).toEqual(['computer_use_click:Computer Use needs your approval to control com.apple.mail'])
    const plainKey = await call(ctx, 'computer_use_press_key', { app: 'com.apple.mail', key: 'a' })
    expect(plainKey.isError).toBe(false)
    expect(approval.calls).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('denies the action when the user rejects', async () => {
    const approval = new SpyApproval()
    approval.outcome = 'rejected'
    const ctx = await setup({ approval })
    const result = await call(ctx, 'computer_use_type_text', { app: 'TextEdit', text: 'hi' })
    expect(result.isError).toBe(true)
    expect(result.error?.message ?? '').toContain('user rejected')
    // A rejection is not a grant: the next action asks again.
    expect(approval.calls).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('fails closed when no approval service is mounted', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'computer_use_press_key', { app: 'TextEdit', key: 'a' })
    expect(result.isError).toBe(true)
    expect(result.error?.message ?? '').toContain('Computer Use needs your approval to control TextEdit')
    await ctx.fiber.dispose()
  })

  it('always confirms configured tools, even for approved apps', async () => {
    const approval = new SpyApproval()
    const ctx = await setup({ approval, config: { alwaysConfirmTools: ['computer_use_click'] } })
    await call(ctx, 'computer_use_click', { app: 'TextEdit', element_index: 0 })
    await call(ctx, 'computer_use_click', { app: 'TextEdit', element_index: 0 })
    expect(approval.calls).toHaveLength(2)
    await ctx.fiber.dispose()
  })

  it('always confirms destructive secondary actions, even for approved apps', async () => {
    const approval = new SpyApproval()
    const ctx = await setup({ approval })
    // Approve the app via a benign action first.
    await call(ctx, 'computer_use_scroll', { app: 'TextEdit', element_index: 0, direction: 'up' })
    const destructive = await call(ctx, 'computer_use_perform_secondary_action', {
      app: 'TextEdit', element_index: 0, action: 'Delete All',
    })
    expect(destructive.isError).toBe(false)
    expect(approval.calls.at(-1)).toContain('requires approval')
    const callsBeforeBenign = approval.calls.length
    const benign = await call(ctx, 'computer_use_perform_secondary_action', {
      app: 'TextEdit', element_index: 0, action: 'Raise',
    })
    expect(benign.isError).toBe(false)
    expect(approval.calls).toHaveLength(callsBeforeBenign)
    await ctx.fiber.dispose()
  })

  it('never gates allowlisted apps', async () => {
    const approval = new SpyApproval()
    const ctx = await setup({ approval, config: { allowlistApps: ['com.apple.Finder'] } })
    const result = await call(ctx, 'computer_use_drag', { app: 'com.apple.Finder', from_x: 0, from_y: 0, to_x: 1, to_y: 1 })
    expect(result.isError).toBe(false)
    expect(approval.calls).toEqual([])
    await ctx.fiber.dispose()
  })

  it('keeps session-local grants when no settings service is mounted', async () => {
    const approval = new SpyApproval()
    const ctx = await setup({ approval, settings: false })
    await call(ctx, 'computer_use_set_value', { app: 'TextEdit', element_index: 0, value: 'v' })
    await call(ctx, 'computer_use_set_value', { app: 'TextEdit', element_index: 0, value: 'w' })
    expect(approval.calls).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('adds the tier guidance to the system prompt', async () => {
    const ctx = await setup()
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(section => section.name === 'tool:computer-policy')
    expect(section?.text).toContain('third-party content')
    await ctx.fiber.dispose()
  })

  it('stops gating after disposal (HMR safety)', async () => {
    const approval = new SpyApproval()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(MemorySettings)
    ctx.provide('approval', approval)
    await ctx.plugin(MockEngine)
    await ctx.plugin(ToolComputer, { enableScreenshots: false })
    const fiber = await ctx.plugin(ComputerPolicy)
    await fiber.dispose()
    const result = await call(ctx, 'computer_use_click', { app: 'TextEdit', element_index: 0 })
    expect(result.isError).toBe(false)
    expect(approval.calls).toEqual([])
    await ctx.fiber.dispose()
  })
})

describe('COMPUTER_POLICY_NAMESPACE', () => {
  it('names the persisted grant section', () => {
    expect(String(COMPUTER_POLICY_NAMESPACE)).toBe('computer-policy')
  })
})
