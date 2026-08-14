/**
 * MCP server protocol tests over a fake engine: initialize, tools/list, and
 * tools/call routing — including the official behaviors (post-action state on
 * every action, `Selected text:` on press_key, verbatim state text, and error
 * results as `isError` content). No desktop is driven.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
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
import { McpError, McpServer, TOOL_DEFINITIONS, MCP_PROTOCOL_VERSION } from 'dsh-computer-mcp'

/** A fake engine: canned apps and state, and a call log. */
class StubEngine extends ComputerEngine {
  state: ComputerAppState = { app: 'com.apple.TextEdit', text: '0 standard window\n\t1 text entry area', truncated: false, screenshot: null }
  calls: string[] = []
  lastSelectText?: SelectTextRequest
  lastGet?: GetAppStateRequest

  resolve<T extends ComputerRequestBase>(request: T): ComputerExecSpec<T> {
    return { request, timeoutMs: request.timeoutMs ?? 1_000, ...request.signal ? { signal: request.signal } : {} }
  }

  async listApps(_spec: ComputerExecSpec<ListAppsRequest>): Promise<ComputerApp[]> {
    this.calls.push('listApps')
    return [{ id: 'com.apple.TextEdit', displayName: 'TextEdit', isRunning: true, useCount: 3, lastUsedDate: '2026-08-14' }]
  }

  async getAppState(spec: ComputerExecSpec<GetAppStateRequest>): Promise<ComputerAppState> {
    this.calls.push('getAppState')
    this.lastGet = spec.request
    return this.state
  }

  async click(_spec: ComputerExecSpec<ClickRequest>): Promise<void> { this.calls.push('click') }
  async typeText(_spec: ComputerExecSpec<TypeTextRequest>): Promise<void> { this.calls.push('typeText') }
  async pressKey(_spec: ComputerExecSpec<PressKeyRequest>): Promise<string> { this.calls.push('pressKey'); return 'codex' }
  async scroll(_spec: ComputerExecSpec<ScrollRequest>): Promise<void> { this.calls.push('scroll') }
  async setValue(_spec: ComputerExecSpec<SetValueRequest>): Promise<void> { this.calls.push('setValue') }
  async selectText(spec: ComputerExecSpec<SelectTextRequest>): Promise<void> {
    this.calls.push('selectText')
    this.lastSelectText = spec.request
  }
  async drag(_spec: ComputerExecSpec<DragRequest>): Promise<void> { this.calls.push('drag') }
  async performSecondaryAction(_spec: ComputerExecSpec<PerformSecondaryActionRequest>): Promise<void> { this.calls.push('performSecondaryAction') }
  async permissionStatus(): Promise<ComputerPermissionStatus> { return { accessibility: true, screenRecording: true, bundled: true } }
  async requestPermissions(): Promise<ComputerPermissionStatus> { return { accessibility: true, screenRecording: true, bundled: true } }
  async recordStart(): Promise<ComputerRecordStatus> { this.calls.push('recordStart'); return { recording: false, maxDurationSec: 1800 } }
  async recordStatus(): Promise<ComputerRecordStatus> { this.calls.push('recordStatus'); return { recording: false, maxDurationSec: 1800 } }
  async recordStop(): Promise<ComputerRecordStatus> { this.calls.push('recordStop'); return { recording: false, maxDurationSec: 1800 } }
}

async function harness(): Promise<{ server: McpServer; engine: StubEngine; ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(StubEngine)
  return { server: new McpServer(ctx, ctx.computer), engine: ctx.computer as StubEngine, ctx }
}

function textOf(content: unknown): string {
  return (content as Array<{ type: string; text?: string }>).filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

describe('dsh-computer-mcp protocol', () => {
  it('initializes with the protocol version and tools capability', async () => {
    const { server } = await harness()
    const result = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(result).toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
    })
    expect(server.handle({ jsonrpc: '2.0', id: 2, method: 'ping' })).resolves.toEqual({})
  })

  it('lists the official ten window tools plus request_access', async () => {
    const { server } = await harness()
    const result = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const tools = result?.tools as Array<{ name: string }>
    expect(tools.map(tool => tool.name)).toEqual([
      'list_apps', 'get_app_state', 'click', 'perform_secondary_action', 'scroll',
      'drag', 'type_text', 'press_key', 'set_value', 'select_text', 'request_access',
      'event_stream_start', 'event_stream_status', 'event_stream_stop',
    ])
    expect(TOOL_DEFINITIONS).toHaveLength(14)
  })

  it('renders the official app list format', async () => {
    const { server } = await harness()
    const result = await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_apps', arguments: {} },
    })
    expect(textOf(result?.content)).toBe('TextEdit — com.apple.TextEdit [running, last-used=2026-08-14, uses=3]')
  })

  it('returns the state text verbatim with a screenshot block when captured', async () => {
    const { server, engine } = await harness()
    engine.state = {
      app: 'com.apple.TextEdit',
      text: '0 standard window',
      truncated: false,
      screenshot: { data: Buffer.from('jpeg'), mediaType: 'image/jpeg', width: 1, height: 1 },
    }
    const result = await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_app_state', arguments: { app: 'TextEdit' } },
    })
    expect(textOf(result?.content)).toBe('0 standard window')
    const content = result?.content as Array<{ type: string; data?: string; mimeType?: string }>
    expect(content.find(block => block.type === 'image')).toMatchObject({ data: 'anBlZw==', mimeType: 'image/jpeg' })
  })

  it('answers every action with the post-action state', async () => {
    const { server, engine } = await harness()
    const result = await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'click', arguments: { app: 'TextEdit', element_index: '0' } },
    })
    expect(textOf(result?.content)).toContain('0 standard window')
    expect(engine.calls).toEqual(['click', 'getAppState'])
  })

  it('appends the Selected text line to press_key results', async () => {
    const { server } = await harness()
    const result = await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'press_key', arguments: { app: 'TextEdit', key: 'super+a' } },
    })
    expect(textOf(result?.content)).toContain('Selected text: [codex]')
  })

  it('routes select_text with anchors and placement, then answers with the post-action state', async () => {
    const { server, engine } = await harness()
    const result = await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'select_text',
        arguments: { app: 'TextEdit', element_index: '1', text: 'entry', prefix: 'text ', suffix: ' area', selection_type: 'cursor_before' },
      },
    })
    expect(engine.lastSelectText).toMatchObject({
      app: 'TextEdit', elementIndex: 1, text: 'entry', prefix: 'text ', suffix: ' area', selectionType: 'cursor_before',
    })
    expect(engine.calls).toEqual(['selectText', 'getAppState'])
    expect(textOf(result?.content)).toContain('0 standard window')

    const bad = await server.handle({
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'select_text', arguments: { app: 'TextEdit', element_index: '1', text: 'entry', selection_type: 'all' } },
    })
    expect(bad).toMatchObject({ isError: true })
    expect(textOf(bad?.content)).toContain('invalid selection_type')
  })

  it('routes cumulative_diff to the engine and rejects non-boolean values', async () => {
    const { server, engine } = await harness()
    const result = await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_app_state', arguments: { app: 'TextEdit', cumulative_diff: true } },
    })
    expect(engine.lastGet?.cumulativeDiff).toBe(true)
    expect(textOf(result?.content)).toBe('0 standard window\n\t1 text entry area')

    const bad = await server.handle({
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_app_state', arguments: { app: 'TextEdit', cumulative_diff: 'yes' } },
    })
    expect(bad).toMatchObject({ isError: true })
    expect(textOf(bad?.content)).toContain('invalid cumulative_diff')
  })

  it('routes the event stream tools to the engine', async () => {
    const { server, engine } = await harness()
    const result = await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'event_stream_start', arguments: {} },
    })
    expect(textOf(result?.content)).toContain('"recording":false')
    expect(engine.calls).toEqual(['recordStart'])
    await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'event_stream_status', arguments: {} } })
    await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'event_stream_stop', arguments: {} } })
    expect(engine.calls).toEqual(['recordStart', 'recordStatus', 'recordStop'])
  })

  it('reports request_access grants', async () => {
    const { server } = await harness()
    const result = await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'request_access', arguments: {} },
    })
    expect(textOf(result?.content)).toContain('Accessibility and Screen Recording permissions are granted')
  })

  it('returns unknown tools and engine failures as isError content', async () => {
    const { server } = await harness()
    const unknown = await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope', arguments: {} },
    })
    expect(unknown).toMatchObject({ isError: true })
    expect(textOf(unknown?.content)).toContain('unknown tool nope')

    const failing = new McpError(-32000, 'boom')
    const failingHarness = await harness()
    // A throwing engine surfaces as error content too.
    failingHarness.engine.getAppState = async () => { throw failing }
    const result = await failingHarness.server.handle({
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_app_state', arguments: { app: 'x' } },
    })
    expect(result).toMatchObject({ isError: true })
    expect(textOf(result?.content)).toContain('boom')
  })

  it('rejects unknown protocol methods', async () => {
    const { server } = await harness()
    await expect(server.handle({ jsonrpc: '2.0', id: 1, method: 'nope' })).rejects.toThrow(/unknown method nope/)
  })
})
