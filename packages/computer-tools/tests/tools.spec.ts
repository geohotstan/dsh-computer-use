/**
 * Consumer tests over a fake engine and the REAL tool registry: schema
 * projection, argument validation (the cross-field rules the schema cannot
 * express), canonical values, screenshot attachment flow, abort mapping, and
 * registry disposal. The engine is the seam's external boundary, so only it
 * is faked; no desktop is driven.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ComputerEngine } from 'dsh-computer'
import type {
  ClickRequest,
  ComputerApp,
  ComputerAppState,
  ComputerExecSpec,
  ComputerPermissionStatus,
  ComputerRecordStatus,
  ComputerRequestBase,
  DragRequest,
  GetAppStateRequest,
  ListAppsRequest,
  PerformSecondaryActionRequest,
  PressKeyRequest,
  ScrollRequest,
  SelectTextRequest,
  SetValueRequest,
  TypeTextRequest,
} from 'dsh-computer'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import * as ToolComputer from 'dsh-computer-tools'

/** A minimal valid 1x1 JPEG so the real attachment store accepts the capture. */
const TINY_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=='

/** A fake engine: canned apps and state, a call log, and an armable rejection. */
class MockEngine extends ComputerEngine {
  apps: ComputerApp[] = [{ id: 'com.apple.TextEdit', displayName: 'TextEdit', isRunning: true }]
  state: ComputerAppState = { app: 'com.apple.TextEdit', text: '0 standard window\n\t1 text entry area', truncated: false, screenshot: null }
  calls: string[] = []
  lastGet: GetAppStateRequest | undefined
  rejectWith: Error | undefined
  hang = false

  private arm(): void {
    if (this.rejectWith !== undefined) throw this.rejectWith
  }

  resolve<T extends ComputerRequestBase>(request: T): ComputerExecSpec<T> {
    return {
      request,
      timeoutMs: request.timeoutMs ?? 1_000,
      ...request.signal ? { signal: request.signal } : {},
    }
  }

  async listApps(_spec: ComputerExecSpec<ListAppsRequest>): Promise<ComputerApp[]> {
    this.calls.push('listApps')
    this.arm()
    return this.apps
  }

  async getAppState(spec: ComputerExecSpec<GetAppStateRequest>): Promise<ComputerAppState> {
    this.calls.push('getAppState')
    this.lastGet = spec.request
    this.arm()
    return this.state
  }

  async click(spec: ComputerExecSpec<ClickRequest>): Promise<void> {
    this.calls.push('click')
    this.arm()
    if (this.hang) {
      // A real engine rejects an in-flight request on abort; mirror that so
      // the consumer's abort mapping is what settles the call.
      return new Promise<void>((_resolve, reject) => {
        spec.signal?.addEventListener('abort', () => { reject(new Error('computer-local: click aborted')) }, { once: true })
      })
    }
  }
  async typeText(_spec: ComputerExecSpec<TypeTextRequest>): Promise<void> { this.calls.push('typeText'); this.arm() }
  async pressKey(_spec: ComputerExecSpec<PressKeyRequest>): Promise<string> { this.calls.push('pressKey'); this.arm(); return 'codex' }
  async scroll(_spec: ComputerExecSpec<ScrollRequest>): Promise<void> { this.calls.push('scroll'); this.arm() }
  async setValue(_spec: ComputerExecSpec<SetValueRequest>): Promise<void> { this.calls.push('setValue'); this.arm() }
  async selectText(_spec: ComputerExecSpec<SelectTextRequest>): Promise<void> { this.calls.push('selectText'); this.arm() }
  async drag(_spec: ComputerExecSpec<DragRequest>): Promise<void> { this.calls.push('drag'); this.arm() }
  async performSecondaryAction(_spec: ComputerExecSpec<PerformSecondaryActionRequest>): Promise<void> { this.calls.push('performSecondaryAction'); this.arm() }
  async permissionStatus(): Promise<ComputerPermissionStatus> { return { accessibility: true, screenRecording: true, bundled: true } }
  async requestPermissions(): Promise<ComputerPermissionStatus> { return { accessibility: true, screenRecording: true, bundled: true } }
  recordStatusValue: ComputerRecordStatus = { recording: false, maxDurationSec: 1800 }
  async recordStart(): Promise<ComputerRecordStatus> { this.calls.push('recordStart'); this.arm(); return this.recordStatusValue }
  async recordStatus(): Promise<ComputerRecordStatus> { this.calls.push('recordStatus'); this.arm(); return this.recordStatusValue }
  async recordStop(): Promise<ComputerRecordStatus> { this.calls.push('recordStop'); this.arm(); return this.recordStatusValue }
}

async function setup(
  config: ToolComputer.Config = {},
  attachmentsRoot?: string,
  storeConfig: ConstructorParameters<typeof LocalAttachmentStore>[1] = {},
) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (attachmentsRoot !== undefined) {
    await ctx.plugin(LocalAttachmentStore, { dshHome: attachmentsRoot, ...storeConfig })
  }
  await ctx.plugin(MockEngine)
  await ctx.plugin(ToolComputer, config)
  return { ctx, engine: ctx.computer as MockEngine }
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

let callCounter = 0
function call(ctx: Context, name: string, args: unknown, agent?: object) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
    ...agent ? { agent: agent as never } : {},
  })
}

const visionAgent = {
  options: { provider: 'mock', model: 'vision' },
  session: { requestHeader: () => ({ config: { provider: 'mock', model: 'vision' } }) },
}

describe('computer_use tools registration', () => {
  it('registers all fourteen tools and removes them on disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(MockEngine)
    const fiber = await ctx.plugin(ToolComputer)
    const names = [
      'computer_use_list_apps', 'computer_use_get_app_state', 'computer_use_request_access', 'computer_use_click',
      'computer_use_type_text', 'computer_use_press_key', 'computer_use_scroll',
      'computer_use_set_value', 'computer_use_select_text', 'computer_use_drag',
      'computer_use_perform_secondary_action',
      'computer_use_record_start', 'computer_use_record_status', 'computer_use_record_stop',
    ]
    for (const name of names) expect(ctx.tools.get(name), name).toBeDefined()
    expect(ctx.tools.schemas()).toHaveLength(14)
    await fiber.dispose()
    expect(ctx.tools.schemas()).toHaveLength(0)
    for (const name of names) expect(ctx.tools.get(name), name).toBeUndefined()
  })

  it('adds the cross-call capture guidance to the system prompt', async () => {
    const { ctx } = await setup()
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(section => section.name === 'tool:computer')
    expect(section?.text).toContain('once per assistant turn')
  })
})

describe('computer_use_list_apps', () => {
  it('returns the canonical app list and renders model-facing lines', async () => {
    const { ctx } = await setup()
    const result = await call(ctx, 'computer_use_list_apps', { order: 'usage' })
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({ apps: [{ id: 'com.apple.TextEdit', displayName: 'TextEdit', isRunning: true }] })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain('TextEdit — com.apple.TextEdit [running]')
  })
})

describe('computer_use_get_app_state', () => {
  it('returns the tree text without a screenshot when the engine captured none', async () => {
    const { ctx } = await setup()
    const result = await call(ctx, 'computer_use_get_app_state', { app: 'TextEdit' })
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({
      app: 'com.apple.TextEdit',
      text: '0 standard window\n\t1 text entry area',
      truncated: false,
    })
    const text = result.content.map(block => block.type === 'text' ? block.text : '').join('')
    // The official surface returns the tree text verbatim — no wrapper envelope.
    expect(text).toContain('0 standard window')
    expect(text).not.toContain('<app_state')
    expect(text).not.toContain('Screenshot: unavailable')
    expect(result.content.some(block => block.type === 'image')).toBe(false)
  })

  it('commits the screenshot to the attachment store and renders an image block', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-tool-computer-attachments-'))
    dirs.push(root)
    const { ctx, engine } = await setup({}, root)
    ctx.provide('llm', {
      resolveModelInfo: async () => ({ inputModalities: ['image', 'text'] }),
    })
    engine.state = {
      app: 'com.apple.TextEdit',
      text: '0 standard window',
      truncated: false,
      screenshot: { data: Buffer.from(TINY_JPEG_BASE64, 'base64'), mediaType: 'image/jpeg', width: 1, height: 1 },
    }
    const result = await call(ctx, 'computer_use_get_app_state', { app: 'TextEdit' }, visionAgent)
    expect(result.isError).toBe(false)
    const value = result.value as { screenshot?: { attachmentId: string } }
    expect(value.screenshot?.attachmentId).toBeTruthy()
    const image = result.content.find(block => block.type === 'image')
    expect(image).toBeDefined()
    const text = result.content.map(block => block.type === 'text' ? block.text : '').join('')
    expect(text).toContain('0 standard window')
  })

  it('skips the screenshot when the route cannot carry images', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-tool-computer-attachments-'))
    dirs.push(root)
    const { ctx, engine } = await setup({}, root)
    engine.state = {
      app: 'com.apple.TextEdit',
      text: '0 standard window',
      truncated: false,
      screenshot: { data: Buffer.from(TINY_JPEG_BASE64, 'base64'), mediaType: 'image/jpeg', width: 1, height: 1 },
    }
    // No agent → no route → text-only capture.
    const result = await call(ctx, 'computer_use_get_app_state', { app: 'TextEdit' })
    expect(result.isError).toBe(false)
    expect((result.value as object)).not.toHaveProperty('screenshot')
  })

  it('skips the screenshot when no llm service resolves the route', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-tool-computer-attachments-'))
    dirs.push(root)
    const { ctx, engine } = await setup({}, root)
    engine.state = {
      app: 'com.apple.TextEdit',
      text: '0 standard window',
      truncated: false,
      screenshot: { data: Buffer.from(TINY_JPEG_BASE64, 'base64'), mediaType: 'image/jpeg', width: 1, height: 1 },
    }
    // An agent exists, but no llm service is mounted.
    const result = await call(ctx, 'computer_use_get_app_state', { app: 'TextEdit' }, visionAgent)
    expect(result.isError).toBe(false)
    expect((result.value as object)).not.toHaveProperty('screenshot')
  })

  it('skips the screenshot when the model metadata lacks image input', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-tool-computer-attachments-'))
    dirs.push(root)
    const { ctx, engine } = await setup({}, root)
    ctx.provide('llm', { resolveModelInfo: async () => ({}) })
    engine.state = {
      app: 'com.apple.TextEdit',
      text: '0 standard window',
      truncated: false,
      screenshot: { data: Buffer.from(TINY_JPEG_BASE64, 'base64'), mediaType: 'image/jpeg', width: 1, height: 1 },
    }
    const result = await call(ctx, 'computer_use_get_app_state', { app: 'TextEdit' }, visionAgent)
    expect(result.isError).toBe(false)
    expect((result.value as object)).not.toHaveProperty('screenshot')
  })

  it('skips the screenshot when model metadata resolution fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-tool-computer-attachments-'))
    dirs.push(root)
    const { ctx, engine } = await setup({}, root)
    ctx.provide('llm', { resolveModelInfo: async () => { throw new Error('adapter down') } })
    engine.state = {
      app: 'com.apple.TextEdit',
      text: '0 standard window',
      truncated: false,
      screenshot: { data: Buffer.from(TINY_JPEG_BASE64, 'base64'), mediaType: 'image/jpeg', width: 1, height: 1 },
    }
    const result = await call(ctx, 'computer_use_get_app_state', { app: 'TextEdit' }, visionAgent)
    expect(result.isError).toBe(false)
    expect((result.value as object)).not.toHaveProperty('screenshot')
  })

  it('skips the screenshot when no attachment store is mounted', async () => {
    const { ctx, engine } = await setup()
    engine.state = {
      app: 'com.apple.TextEdit',
      text: '0 standard window',
      truncated: false,
      screenshot: { data: Buffer.from(TINY_JPEG_BASE64, 'base64'), mediaType: 'image/jpeg', width: 1, height: 1 },
    }
    const result = await call(ctx, 'computer_use_get_app_state', { app: 'TextEdit' }, visionAgent)
    expect(result.isError).toBe(false)
    expect((result.value as object)).not.toHaveProperty('screenshot')
  })

  it('skips the screenshot when it exceeds the attachment byte limits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-tool-computer-attachments-'))
    dirs.push(root)
    const { ctx, engine } = await setup({}, root, { maxImageBytes: 16 })
    ctx.provide('llm', {
      resolveModelInfo: async () => ({ inputModalities: ['image', 'text'] }),
    })
    engine.state = {
      app: 'com.apple.TextEdit',
      text: '0 standard window',
      truncated: false,
      screenshot: { data: Buffer.from(TINY_JPEG_BASE64, 'base64'), mediaType: 'image/jpeg', width: 1, height: 1 },
    }
    const result = await call(ctx, 'computer_use_get_app_state', { app: 'TextEdit' }, visionAgent)
    expect(result.isError).toBe(false)
    expect((result.value as object)).not.toHaveProperty('screenshot')
  })

  it('rejects an empty app identifier', async () => {
    const { ctx } = await setup()
    const result = await call(ctx, 'computer_use_get_app_state', { app: '  ' })
    expect(result.isError).toBe(true)
    expect(result.error?.message ?? '').toMatch(/app must be a non-empty string/)
  })
})

describe('computer_use input tools', () => {
  it('enforces the click addressing rule and positive click counts', async () => {
    const { ctx } = await setup()
    const violations: Array<[string, RegExp]> = [
      ['computer_use_click', /exactly one addressing mode/],
      ['computer_use_click', /exactly one addressing mode/],
      ['computer_use_click', /require both x and y/],
      ['computer_use_click', /positive integer/],
    ]
    const argsList = [
      { app: 'a' },
      { app: 'a', element_index: 0, x: 1, y: 2 },
      { app: 'a', x: 1 },
      { app: 'a', element_index: 0, click_count: 0 },
    ]
    for (let i = 0; i < violations.length; i++) {
      const violation = violations[i]!
      const args = argsList[i]!
      const result = await call(ctx, violation[0], args)
      expect(result.isError, `case ${i}`).toBe(true)
      expect(result.error?.message ?? '', `case ${i}`).toMatch(violation[1])
    }
  })

  it('accepts a coordinate click with count and button variants', async () => {
    const { ctx, engine } = await setup()
    const result = await call(ctx, 'computer_use_click', { app: 'a', x: 1, y: 2, click_count: 2, mouse_button: 'm' })
    expect(result.isError).toBe(false)
    // The official behavior: the action answers with the post-action state.
    expect(result.value).toEqual({
      app: 'com.apple.TextEdit',
      text: '0 standard window\n\t1 text entry area',
      truncated: false,
    })
    expect(engine.calls).toEqual(['click', 'getAppState'])
  })

  it('accepts a select_text with anchors and one without a selection type', async () => {
    const { ctx, engine } = await setup()
    const anchored = await call(ctx, 'computer_use_select_text', {
      app: 'a', element_index: 0, text: 't', prefix: 'p', suffix: 's', selection_type: 'cursor_before',
    })
    expect(anchored.isError).toBe(false)
    const plain = await call(ctx, 'computer_use_select_text', { app: 'a', element_index: 0, text: 't' })
    expect(plain.isError).toBe(false)
    expect(engine.calls).toEqual(['selectText', 'getAppState', 'selectText', 'getAppState'])
  })

  it('forwards disableDiff to the engine', async () => {
    const { ctx } = await setup()
    const result = await call(ctx, 'computer_use_get_app_state', { app: 'a', disableDiff: true })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ app: 'com.apple.TextEdit' })
  })

  it('forwards cumulative_diff to the engine', async () => {
    const { ctx, engine } = await setup()
    const result = await call(ctx, 'computer_use_get_app_state', { app: 'a', cumulative_diff: true })
    expect(result.isError).toBe(false)
    expect(engine.lastGet?.cumulativeDiff).toBe(true)
    const plain = await call(ctx, 'computer_use_get_app_state', { app: 'a' })
    expect(plain.isError).toBe(false)
    expect(engine.lastGet?.cumulativeDiff).toBeUndefined()
  })

  it('routes the recording tools to the engine', async () => {
    const { ctx, engine } = await setup()
    engine.recordStatusValue = { recording: true, startTime: 1, elapsedSec: 12, maxDurationSec: 1800, eventCount: 3 }
    const status = await call(ctx, 'computer_use_record_status', {})
    expect(status.isError).toBe(false)
    const statusText = status.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(statusText).toContain('Recording in progress: 12s of 1800s, 3 events recorded.')
    expect(engine.calls).toContain('recordStatus')
    await call(ctx, 'computer_use_record_start', {})
    await call(ctx, 'computer_use_record_stop', {})
    expect(engine.calls).toEqual(expect.arrayContaining(['recordStart', 'recordStop']))
  })

  it('accepts text_limit as an integer, a numeric string, and "max"', async () => {
    const { ctx } = await setup()
    for (const text_limit of [600, '600', 'max']) {
      const result = await call(ctx, 'computer_use_get_app_state', { app: 'a', text_limit })
      expect(result.isError, String(text_limit)).toBe(false)
    }
    const invalid = await call(ctx, 'computer_use_get_app_state', { app: 'a', text_limit: 'oops' })
    expect(invalid.isError).toBe(true)
    expect(invalid.error?.message ?? '').toMatch(/text_limit must be a positive integer or "max"/)
  })

  it('reports the grant state through request_access', async () => {
    const { ctx } = await setup()
    const result = await call(ctx, 'computer_use_request_access', {})
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({ accessibility: true, screenRecording: true, bundled: true })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain('Accessibility and Screen Recording permissions are granted')
  })

  it('defers the capture into context for a nested dispatch', async () => {
    const { ctx } = await setup()
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('nested-capture'),
      name: 'computer_use_get_app_state',
      arguments: { app: 'TextEdit' },
      parent: 'enclosing-run-code-token' as never,
    })
    expect(result.isError).toBe(false)
    expect(result.additionalContexts?.length ?? 0).toBeGreaterThan(0)
  })

  it('omits screenshots when enableScreenshots is false', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-tool-computer-attachments-'))
    dirs.push(root)
    const { ctx, engine } = await setup({ enableScreenshots: false }, root)
    ctx.provide('llm', {
      resolveModelInfo: async () => ({ inputModalities: ['image', 'text'] }),
    })
    engine.state = {
      app: 'com.apple.TextEdit',
      text: '0 standard window',
      truncated: false,
      screenshot: { data: Buffer.from(TINY_JPEG_BASE64, 'base64'), mediaType: 'image/jpeg', width: 1, height: 1 },
    }
    const result = await call(ctx, 'computer_use_get_app_state', { app: 'TextEdit' }, visionAgent)
    expect(result.isError).toBe(false)
    expect((result.value as object)).not.toHaveProperty('screenshot')
  })

  it('presents every tool call as a generic card', async () => {
    const { ctx } = await setup()
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['computer_use_list_apps', {}, 'List computer apps'],
      ['computer_use_get_app_state', { app: 'a' }, 'Capture state of a'],
      ['computer_use_click', { app: 'a', element_index: 0 }, 'Click in a'],
      ['computer_use_type_text', { app: 'a', text: 'hi' }, 'Type text in a'],
      ['computer_use_press_key', { app: 'a', key: 'x' }, 'Press key in a'],
      ['computer_use_scroll', { app: 'a', element_index: 0, direction: 'up' }, 'Scroll in a'],
      ['computer_use_set_value', { app: 'a', element_index: 0, value: 'v' }, 'Set value in a'],
      ['computer_use_select_text', { app: 'a', element_index: 0, text: 't' }, 'Select text in a'],
      ['computer_use_drag', { app: 'a', from_x: 0, from_y: 0, to_x: 1, to_y: 1 }, 'Drag in a'],
      ['computer_use_perform_secondary_action', { app: 'a', element_index: 0, action: 'Raise' }, 'Perform action in a'],
    ]
    for (const [name, args, title] of cases) {
      const view = ctx.tools.get(name)?.presentCall?.(args)
      expect(view, name).toMatchObject({ card: 'generic', title })
    }
  })

  it('accepts a scroll without a page count', async () => {
    const { ctx } = await setup()
    const result = await call(ctx, 'computer_use_scroll', { app: 'a', element_index: 0, direction: 'up' })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ app: 'com.apple.TextEdit', truncated: false })
  })

  it('propagates an engine failure that is not an abort', async () => {
    const { ctx, engine } = await setup()
    engine.rejectWith = new Error('engine exploded')
    const result = await call(ctx, 'computer_use_click', { app: 'a', element_index: 0 })
    expect(result.isError).toBe(true)
    expect(result.error?.message ?? '').toContain('engine exploded')
  })

  it('runs every input tool through the engine and returns the post-action state', async () => {
    const { ctx, engine } = await setup()
    const cases: Array<[string, Record<string, unknown>]> = [
      ['computer_use_click', { app: 'TextEdit', element_index: 1, mouse_button: 'l' }],
      ['computer_use_type_text', { app: 'TextEdit', text: 'hi' }],
      ['computer_use_press_key', { app: 'TextEdit', key: 'Control_L+a' }],
      ['computer_use_scroll', { app: 'TextEdit', element_index: 1, direction: 'd', pages: 0.5 }],
      ['computer_use_set_value', { app: 'TextEdit', element_index: 1, value: '' }],
      ['computer_use_select_text', { app: 'TextEdit', element_index: 1, text: 't', selection_type: 'cursor_before' }],
      ['computer_use_drag', { app: 'TextEdit', from_x: 0, from_y: 0, to_x: 1, to_y: 1 }],
      ['computer_use_perform_secondary_action', { app: 'TextEdit', element_index: 1, action: 'Raise' }],
    ]
    for (const [name, args] of cases) {
      const result = await call(ctx, name, args)
      expect(result.isError, name).toBe(false)
      expect(result.value, name).toMatchObject({ app: 'com.apple.TextEdit', truncated: false })
      const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
      expect(text, name).toContain('0 standard window')
      if (name === 'computer_use_press_key') expect(text).toContain('Selected text: [codex]')
    }
    expect(engine.calls).toEqual([
      'click', 'getAppState',
      'typeText', 'getAppState',
      'pressKey', 'getAppState',
      'scroll', 'getAppState',
      'setValue', 'getAppState',
      'selectText', 'getAppState',
      'drag', 'getAppState',
      'performSecondaryAction', 'getAppState',
    ])
  })

  it('rejects empty text, key, and action values', async () => {
    const { ctx } = await setup()
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ['computer_use_type_text', { app: 'a', text: '' }, /text must be a non-empty string/],
      ['computer_use_press_key', { app: 'a', key: ' ' }, /key must be a non-empty string/],
      ['computer_use_select_text', { app: 'a', element_index: 0, text: '' }, /text must be a non-empty string/],
      ['computer_use_perform_secondary_action', { app: 'a', element_index: 0, action: '' }, /action must be a non-empty string/],
    ]
    for (const [name, args, pattern] of cases) {
      const result = await call(ctx, name, args)
      expect(result.isError, name).toBe(true)
      expect(result.error?.message ?? '', name).toMatch(pattern)
    }
  })

  it('maps a mid-flight engine abort to the tool-aborted error', async () => {
    const { ctx, engine } = await setup()
    engine.hang = true
    const controller = new AbortController()
    const pending = ctx.tools.execute({
      signal: controller.signal,
      callId: CallId('aborted-call'),
      name: 'computer_use_click',
      arguments: { app: 'a', element_index: 0 },
    })
    // The registry rejects pre-aborted calls before execute runs, so abort
    // while the engine call is genuinely in flight.
    setTimeout(() => { controller.abort() }, 50)
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.error?.message ?? '').toContain('tool call aborted')
  })
})
