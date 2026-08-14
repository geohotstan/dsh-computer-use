/**
 * MCP stdio server exposing the official Codex Computer Use tool surface,
 * backed by the dsh computer-use engine (the resident macOS daemon). One
 * newline-delimited JSON-RPC 2.0 object per line on stdin/stdout; the tools
 * and their schemas mirror the reverse-engineered official `computer-use` MCP
 * (the ten window tools plus `request_access`), and the call responses mirror
 * the official behavior — action tools answer with the post-action state
 * (text plus a JPEG screenshot block when one was captured).
 * @module @geohotstan/dsh-codex-computer-use/computer-mcp
 */

import { createInterface } from 'node:readline'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { LocalComputerEngine } from '../computer-local/index.ts'
import { formatAppStateEnvelope, listAppsText } from '../computer/index.ts'
import type { ComputerEngine } from '../computer/index.ts'
import type {
  ClickRequest,
  ComputerAppState,
  ComputerClickMethod,
  ComputerDirection,
  ComputerMouseButton,
  ComputerRecordStatus,
  ComputerSelectTextSelectionType,
  DragRequest,
  GetAppStateRequest,
  ListAppsRequest,
  PerformSecondaryActionRequest,
  PressKeyRequest,
  ScrollRequest,
  SelectTextRequest,
  SetValueRequest,
  TypeTextRequest,
} from '../computer/index.ts'

/** MCP protocol version this server speaks. */
export const MCP_PROTOCOL_VERSION = '2025-03-26'
/** Server identity reported by `initialize`. */
export const MCP_SERVER_NAME = 'dsh-computer-mcp'
/** Server version reported by `initialize`. */
export const MCP_SERVER_VERSION = '0.1.0'

/** Boot options for the MCP server. */
export interface McpServerOptions {
  /** Absolute path to the daemon executable inside its bundled .app; env `DSH_COMPUTER_HELPER_PATH` when absent. */
  helperPath?: string
}

/** One MCP tool definition: name, description, and JSON input schema. */
interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** The official ten window tools plus `request_access`, with the official schema vocabulary. */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'list_apps',
    description: 'List the apps on this computer. Returns the set of apps that are currently running, as well '
      + 'as any that have been used in the last 14 days, including details on usage frequency.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_app_state',
    description: 'Start an app use session if needed, then get the state of the app\'s key window and return a '
      + 'screenshot and accessibility tree. This must be called once per assistant turn before interacting with the app.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'App name or bundle identifier' },
        text_limit: {
          anyOf: [{ type: 'integer' }, { type: 'string', enum: ['max'] }],
          description: 'Maximum text characters to return. Use "max" for full text. Defaults to 500.',
        },
        max_tree_nodes: { type: 'integer', description: 'Maximum accessibility tree nodes to render. Defaults to 1200.' },
        max_tree_depth: { type: 'integer', description: 'Maximum accessibility tree depth to render. Defaults to 64.' },
        cumulative_diff: {
          type: 'boolean',
          description: 'Diff against the first capture of this app instead of the previous one. Defaults to false.',
        },
      },
      required: ['app'],
    },
  },
  {
    name: 'click',
    description: 'Click an element by index or pixel coordinates from screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'App name or bundle identifier' },
        element_index: { type: 'string', description: 'Element index to click' },
        x: { type: 'number', description: 'X coordinate in screenshot pixel coordinates' },
        y: { type: 'number', description: 'Y coordinate in screenshot pixel coordinates' },
        click_count: { type: 'integer', description: 'Number of clicks. Defaults to 1' },
        mouse_button: { type: 'string', description: 'Mouse button to click. Defaults to left.', enum: ['left', 'right', 'middle'] },
        click_method: {
          type: 'string',
          description: 'Click implementation: auto (default), accessibility, app_post, sky_click, or global. Accessibility '
            + 'requires element_index. app_post and sky_click run the SkyLight background-window recipe with no '
            + 'activation. Global may move the system pointer.',
          enum: ['auto', 'accessibility', 'app_post', 'sky_click', 'global'],
        },
      },
      required: ['app'],
    },
  },
  {
    name: 'perform_secondary_action',
    description: 'Invoke a secondary accessibility action exposed by an element.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'App name or bundle identifier' },
        element_index: { type: 'string', description: 'Element identifier' },
        action: { type: 'string', description: 'Secondary accessibility action name' },
      },
      required: ['app', 'element_index', 'action'],
    },
  },
  {
    name: 'scroll',
    description: 'Scroll an element in a direction by a number of pages.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'App name or bundle identifier' },
        direction: { type: 'string', description: 'Scroll direction: up, down, left, or right' },
        element_index: { type: 'string', description: 'Element identifier' },
        pages: { type: 'number', description: 'Number of pages to scroll. Fractional values are supported. Defaults to 1' },
      },
      required: ['app', 'element_index', 'direction'],
    },
  },
  {
    name: 'drag',
    description: 'Drag from one point to another using pixel coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'App name or bundle identifier' },
        from_x: { type: 'number', description: 'Start X coordinate' },
        from_y: { type: 'number', description: 'Start Y coordinate' },
        to_x: { type: 'number', description: 'End X coordinate' },
        to_y: { type: 'number', description: 'End Y coordinate' },
      },
      required: ['app', 'from_x', 'from_y', 'to_x', 'to_y'],
    },
  },
  {
    name: 'type_text',
    description: 'Type literal text using keyboard input.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'App name or bundle identifier' },
        text: { type: 'string', description: 'Literal text to type' },
      },
      required: ['app', 'text'],
    },
  },
  {
    name: 'press_key',
    description: 'Press a key or key-combination on the keyboard, including modifier and navigation keys.\n'
      + '  - This supports xdotool\'s `key` syntax.\n'
      + '  - Examples: "a", "Return", "Tab", "super+c", "Up", "KP_0" (for the numpad 0 key).',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'App name or bundle identifier' },
        key: { type: 'string', description: 'Key or key combination to press' },
      },
      required: ['app', 'key'],
    },
  },
  {
    name: 'set_value',
    description: 'Set the value of a settable accessibility element.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'App name or bundle identifier' },
        element_index: { type: 'string', description: 'Element identifier' },
        value: { type: 'string', description: 'Value to assign' },
      },
      required: ['app', 'element_index', 'value'],
    },
  },
  {
    name: 'select_text',
    description: 'Select text inside a text element, or place the text cursor before or after it. Provide the text '
      + 'exactly as it appears in the accessibility tree. When the text repeats, give surrounding prefix or suffix '
      + 'text to disambiguate it.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'App name or bundle identifier' },
        element_index: { type: 'string', description: 'Element identifier' },
        text: { type: 'string', description: 'Text to locate within the element' },
        prefix: { type: 'string', description: 'Optional text immediately before the target to disambiguate matches' },
        suffix: { type: 'string', description: 'Optional text immediately after the target to disambiguate matches' },
        selection_type: {
          type: 'string',
          enum: ['text', 'cursor_before', 'cursor_after'],
          description: 'Whether to select the text or place the cursor before or after it. Defaults to text.',
        },
      },
      required: ['app', 'element_index', 'text'],
    },
  },
  {
    name: 'request_access',
    description: 'Request the macOS Accessibility and Screen Recording permissions the computer-use daemon needs, '
      + 'prompting the user through the system dialogs, and report the resulting grant state.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'event_stream_start',
    description: 'Start recording the user\'s actions for up to 30 minutes. If a recording is already active, '
      + 'return that active session instead of starting another one.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'event_stream_status',
    description: 'Get the current or most recent Record & Replay recording status including paths to metadata and '
      + 'events during the recording.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'event_stream_stop',
    description: 'Stop the active event stream recording if one is running and return status including paths to '
      + 'metadata and events during the recording.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
]

/** The three MCP content-block kinds this server emits. */
type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: 'image/jpeg' }

/** One parsed stdin request line; nil-able shape checked field by field. */
interface McpRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

/**
 * One running MCP server: the cordis context, the engine, and the request
 * loop over stdin. Disposal stops the engine's resident daemon.
 */
export class McpServer {
  readonly ctx: Context
  readonly engine: ComputerEngine

  constructor(ctx: Context, engine: ComputerEngine) {
    this.ctx = ctx
    this.engine = engine
  }

  /** Handle one MCP request and return the response payload (or undefined for notifications). */
  async handle(request: McpRequest): Promise<Record<string, unknown> | undefined> {
    switch (request.method) {
      case 'initialize':
        return {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        }
      case 'ping':
        return {}
      case 'tools/list':
        return { tools: TOOL_DEFINITIONS.map(tool => ({ ...tool })) }
      case 'tools/call':
        return this.callTool(request.params ?? {})
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return undefined
      default:
        throw new McpError(-32601, `unknown method ${request.method}`)
    }
  }

  /** Route one `tools/call` to the engine, mirroring the official response behavior. */
  private async callTool(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const name = params.name
    const args = isRecord(params.arguments) ? params.arguments : {}
    if (typeof name !== 'string') throw new McpError(-32602, 'tools/call requires a string name')
    try {
      const content = await this.executeTool(name, args)
      return { content }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { content: [{ type: 'text', text: message }], isError: true }
    }
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<McpContentBlock[]> {
    switch (name) {
      case 'list_apps':
        return [{ type: 'text', text: listAppsText(await this.engine.listApps(this.engine.resolve<ListAppsRequest>({}))) }]
      case 'get_app_state':
        return this.stateContent(await this.engine.getAppState(this.engine.resolve<GetAppStateRequest>({
          app: stringArg(args, 'app'),
          ...textLimitArg(args),
          ...positiveIntArg(args, 'max_tree_nodes', 'maxTreeNodes'),
          ...positiveIntArg(args, 'max_tree_depth', 'maxTreeDepth'),
          ...boolArg(args, 'cumulative_diff', 'cumulativeDiff'),
        })))
      case 'click': {
        await this.engine.click(this.engine.resolve<ClickRequest>({
          app: stringArg(args, 'app'),
          ...intArg(args, 'element_index', 'elementIndex'),
          ...numberArg(args, 'x'),
          ...numberArg(args, 'y'),
          ...positiveIntArg(args, 'click_count', 'clickCount'),
          ...buttonArg(args),
          ...clickMethodArg(args),
        }))
        return this.stateContent(await this.postActionState(stringArg(args, 'app')))
      }
      case 'type_text':
        await this.engine.typeText(this.engine.resolve<TypeTextRequest>({ app: stringArg(args, 'app'), text: stringArg(args, 'text') }))
        return this.stateContent(await this.postActionState(stringArg(args, 'app')))
      case 'press_key': {
        const app = stringArg(args, 'app')
        const selected = await this.engine.pressKey(this.engine.resolve<PressKeyRequest>({ app, key: stringArg(args, 'key') }))
        const content = this.stateContent(await this.postActionState(app))
        if (selected.length > 0) {
          const first = content[0]
          const text = first !== undefined && first.type === 'text' ? first.text : ''
          return [{ type: 'text', text: `${text}\nSelected text: [${selected}]` }, ...content.slice(1)]
        }
        return content
      }
      case 'scroll':
        await this.engine.scroll(this.engine.resolve<ScrollRequest>({
          app: stringArg(args, 'app'),
          elementIndex: intRequired(args, 'element_index'),
          direction: directionArg(args),
          ...numberArg(args, 'pages'),
        }))
        return this.stateContent(await this.postActionState(stringArg(args, 'app')))
      case 'set_value':
        await this.engine.setValue(this.engine.resolve<SetValueRequest>({
          app: stringArg(args, 'app'),
          elementIndex: intRequired(args, 'element_index'),
          value: stringArg(args, 'value'),
        }))
        return this.stateContent(await this.postActionState(stringArg(args, 'app')))
      case 'select_text':
        await this.engine.selectText(this.engine.resolve<SelectTextRequest>({
          app: stringArg(args, 'app'),
          elementIndex: intRequired(args, 'element_index'),
          text: stringArg(args, 'text'),
          ...optionalStringArg(args, 'prefix'),
          ...optionalStringArg(args, 'suffix'),
          ...selectionTypeArg(args),
        }))
        return this.stateContent(await this.postActionState(stringArg(args, 'app')))
      case 'drag':
        await this.engine.drag(this.engine.resolve<DragRequest>({
          app: stringArg(args, 'app'),
          fromX: numberRequired(args, 'from_x'),
          fromY: numberRequired(args, 'from_y'),
          toX: numberRequired(args, 'to_x'),
          toY: numberRequired(args, 'to_y'),
        }))
        return this.stateContent(await this.postActionState(stringArg(args, 'app')))
      case 'perform_secondary_action':
        await this.engine.performSecondaryAction(this.engine.resolve<PerformSecondaryActionRequest>({
          app: stringArg(args, 'app'),
          elementIndex: intRequired(args, 'element_index'),
          action: stringArg(args, 'action'),
        }))
        return this.stateContent(await this.postActionState(stringArg(args, 'app')))
      case 'request_access': {
        const status = await this.engine.requestPermissions()
        return [{
          type: 'text',
          text: status.accessibility && status.screenRecording
            ? 'Accessibility and Screen Recording permissions are granted.'
            : [
              `Accessibility: ${status.accessibility ? 'granted' : 'not granted'}`,
              `Screen Recording: ${status.screenRecording ? 'granted' : 'not granted'}`,
              ...status.bundled ? [] : ['The daemon is not running from its signed app bundle; permission prompts may attribute to the parent process.'],
              'Grant any missing permission in the dialog or System Settings pane that just appeared, then retry.',
            ].join('\n'),
        }]
      }
      case 'event_stream_start':
        return this.recordStatusContent(await this.engine.recordStart())
      case 'event_stream_status':
        return this.recordStatusContent(await this.engine.recordStatus())
      case 'event_stream_stop':
        return this.recordStatusContent(await this.engine.recordStop())
      default:
        throw new McpError(-32602, `unknown tool ${name}`)
    }
  }

  /** The canonical recording status text block. */
  private recordStatusContent(status: ComputerRecordStatus): McpContentBlock[] {
    return [{ type: 'text', text: JSON.stringify(status) }]
  }

  /** The official action-response behavior: re-capture the app state after an action. */
  private async postActionState(app: string): Promise<ComputerAppState> {
    return this.engine.getAppState(this.engine.resolve<GetAppStateRequest>({ app, disableDiff: true }))
  }

  /** Canonical state content: verbatim tree text plus a JPEG image block when one was captured. */
  private stateContent(state: ComputerAppState): McpContentBlock[] {
    const blocks: McpContentBlock[] = [{ type: 'text', text: formatAppStateEnvelope({ app: state.app, text: state.text }) }]
    if (state.screenshot !== null) {
      blocks.push({ type: 'image', data: state.screenshot.data.toString('base64'), mimeType: 'image/jpeg' })
    }
    return blocks
  }

  /** Serve requests on stdin until the stream ends or the process is terminated. */
  async serve(): Promise<void> {
    const lines = createInterface({ input: process.stdin, terminal: false })
    for await (const line of lines) {
      let payload: unknown
      try {
        payload = JSON.parse(line)
      } catch {
        continue // protocol garbage: skip, like a stray non-JSON line
      }
      const request = parseRequest(payload)
      if (request === undefined) continue
      try {
        const result = await this.handle(request)
        if (result !== undefined) writeResponse(request.id, result)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        const code = error instanceof McpError ? error.code : -32603
        writeError(request.id, code, message)
      }
    }
    await this.ctx.fiber.dispose()
  }
}

/** MCP protocol error with a JSON-RPC error code. */
export class McpError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message)
  }
}

/** Boot the engine and return a serving MCP server. */
export async function createServer(options: McpServerOptions = {}): Promise<McpServer> {
  const helperPath = options.helperPath ?? process.env.DSH_COMPUTER_HELPER_PATH
  if (helperPath === undefined || helperPath.length === 0) {
    throw new Error('dsh-computer-mcp: no daemon path — pass it as the first argument or set DSH_COMPUTER_HELPER_PATH')
  }
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalComputerEngine, { helperPath })
  return new McpServer(ctx, ctx.computer)
}

// MARK: wire helpers

function writeResponse(id: number | string, result: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function writeError(id: number | string, code: number, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

function parseRequest(value: unknown): McpRequest | undefined {
  if (!isRecord(value)) return undefined
  if (value.jsonrpc !== '2.0') return undefined
  if (typeof value.id !== 'number' && typeof value.id !== 'string') return undefined
  if (typeof value.method !== 'string') return undefined
  return {
    jsonrpc: '2.0',
    id: value.id,
    method: value.method,
    ...isRecord(value.params) ? { params: value.params } : {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Argument helpers: the official schema types `element_index` as a string; both spellings are accepted at the wire. */
function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name]
  if (typeof value !== 'string' || value.length === 0) throw new McpError(-32602, `invalid ${name}`)
  return value
}

function intArg(args: Record<string, unknown>, name: string, target: 'elementIndex' | 'clickCount' | 'maxTreeNodes' | 'maxTreeDepth'): Record<string, number> {
  const value = args[name]
  if (value === undefined) return {}
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isInteger(parsed)) throw new McpError(-32602, `invalid ${name}`)
  return { [target]: parsed }
}

function intRequired(args: Record<string, unknown>, name: string): number {
  const parsed = intArg(args, name, 'elementIndex')
  const value = parsed.elementIndex
  if (value === undefined) throw new McpError(-32602, `missing ${name}`)
  return value
}

function positiveIntArg(args: Record<string, unknown>, name: string, target: 'clickCount' | 'maxTreeNodes' | 'maxTreeDepth'): Record<string, number> {
  const parsed = intArg(args, name, target)
  const value = parsed[target]
  if (value !== undefined && value <= 0) throw new McpError(-32602, `invalid ${name}`)
  return parsed
}

function numberArg(args: Record<string, unknown>, name: 'x' | 'y' | 'pages'): Record<string, number> {
  const value = args[name]
  if (value === undefined) return {}
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new McpError(-32602, `invalid ${name}`)
  return { [name]: value }
}

function numberRequired(args: Record<string, unknown>, name: 'from_x' | 'from_y' | 'to_x' | 'to_y'): number {
  const value = args[name]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new McpError(-32602, `invalid ${name}`)
  return value
}

function textLimitArg(args: Record<string, unknown>): { textLimit?: number | 'max' } {
  const value = args.text_limit
  if (value === undefined) return {}
  if (value === 'max') return { textLimit: 'max' }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return { textLimit: value }
  if (typeof value === 'string' && value.trim() !== '' && Number.isInteger(Number(value))) return { textLimit: Number(value) }
  throw new McpError(-32602, 'invalid text_limit')
}

function buttonArg(args: Record<string, unknown>): { mouseButton?: ComputerMouseButton } {
  const value = args.mouse_button
  if (value === undefined) return {}
  if (value === 'left' || value === 'right' || value === 'middle' || value === 'l' || value === 'r' || value === 'm') {
    return { mouseButton: value as ComputerMouseButton }
  }
  throw new McpError(-32602, 'invalid mouse_button')
}

function clickMethodArg(args: Record<string, unknown>): { clickMethod?: ComputerClickMethod } {
  const value = args.click_method
  if (value === undefined) return {}
  if (value === 'auto' || value === 'accessibility' || value === 'app_post' || value === 'sky_click' || value === 'global') {
    return { clickMethod: value as ComputerClickMethod }
  }
  throw new McpError(-32602, 'invalid click_method')
}

function directionArg(args: Record<string, unknown>): ComputerDirection {
  const value = args.direction
  if (value === 'up' || value === 'down' || value === 'left' || value === 'right' || value === 'u' || value === 'd' || value === 'l' || value === 'r') {
    return value as ComputerDirection
  }
  throw new McpError(-32602, 'invalid direction')
}

function optionalStringArg(args: Record<string, unknown>, name: 'prefix' | 'suffix'): Record<string, string> {
  const value = args[name]
  if (value === undefined) return {}
  if (typeof value !== 'string') throw new McpError(-32602, `invalid ${name}`)
  return { [name]: value }
}

function boolArg(args: Record<string, unknown>, name: 'cumulative_diff', target: 'cumulativeDiff'): Record<string, boolean> {
  const value = args[name]
  if (value === undefined) return {}
  if (typeof value !== 'boolean') throw new McpError(-32602, `invalid ${name}`)
  return { [target]: value }
}

function selectionTypeArg(args: Record<string, unknown>): { selectionType?: ComputerSelectTextSelectionType } {
  const value = args.selection_type
  if (value === undefined) return {}
  if (value === 'text' || value === 'cursor_before' || value === 'cursor_after') {
    return { selectionType: value as ComputerSelectTextSelectionType }
  }
  throw new McpError(-32602, 'invalid selection_type')
}
