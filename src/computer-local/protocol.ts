/**
 * Wire contract for the resident macOS computer-use helper daemon
 * (`dsh-computer-daemon`, built from `native/`): one JSON-RPC 2.0 object per
 * line on the daemon's stdout, one request per line on its stdin, with the
 * field vocabulary of the computer-use seam carried verbatim (camelCase),
 * except screenshot bytes, which cross as `dataBase64`. The daemon is
 * stateful across requests — its capture session owns the per-app tree used
 * for diffs — so the engine keeps exactly one resident daemon alive.
 *
 * Every value decoded here is a wire input: field-by-field validation is the
 * boundary this module owns, mirroring the seam's typed shapes.
 * @module @zibokapi/dsh-codex-computer-use/computer-local/protocol
 */

/** The methods the daemon implements, in the seam's request order. */
export const DAEMON_METHODS = [
  'list_apps',
  'permission_status',
  'request_permissions',
  'get_app_state',
  'click',
  'type_text',
  'press_key',
  'scroll',
  'set_value',
  'select_text',
  'drag',
  'perform_secondary_action',
  'event_stream_start',
  'event_stream_status',
  'event_stream_stop',
] as const

/** One daemon method name. */
export type DaemonMethod = typeof DAEMON_METHODS[number]

/** A client→daemon request line. */
export interface DaemonRequest {
  jsonrpc: '2.0'
  id: number
  method: DaemonMethod
  params: Record<string, unknown>
}

/** A daemon→client response line: a result, or a protocol error. */
export interface DaemonResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/**
 * Build a request line for the daemon.
 * @param id - unique numeric id owned by the caller.
 * @param method - the daemon method to invoke.
 * @param params - method parameters, already mapped from the seam request.
 * @returns the serialized one-line request, without trailing newline.
 */
export function buildRequest(id: number, method: DaemonMethod, params: Record<string, unknown>): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params } satisfies DaemonRequest)
}

/**
 * Recognize one parsed stdout line as a well-formed daemon response whose
 * numeric id can be correlated. Structural checks only — the payload's
 * method-specific shape is validated by each operation's decoder.
 * @param value - the parsed line.
 * @returns the typed response, or null for a line the engine must ignore.
 */
export function parseResponse(value: unknown): DaemonResponse | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (candidate.jsonrpc !== '2.0' || typeof candidate.id !== 'number') return null
  if ('error' in candidate && candidate.error !== undefined) {
    if (typeof candidate.error !== 'object' || candidate.error === null) return null
    const error = candidate.error as Record<string, unknown>
    if (typeof error.code !== 'number' || typeof error.message !== 'string') return null
    return { jsonrpc: '2.0', id: candidate.id, error: { code: error.code, message: error.message } }
  }
  return { jsonrpc: '2.0', id: candidate.id, result: candidate.result }
}

/**
 * Incremental newline-delimited decoder for the daemon's stdout: feed raw
 * chunks, drain complete lines, and keep one partial tail for the next chunk.
 * A stream that ends mid-line yields that tail as the final line.
 */
export class LineDecoder {
  private buffer = ''

  /**
   * Feed one chunk of the daemon's stdout.
   * @param chunk - raw bytes received from the stream.
   * @returns every complete line the chunk closed.
   */
  push(chunk: Buffer | string): string[] {
    this.buffer += chunk.toString('utf8')
    const lines = this.buffer.split('\n')
    /* v8 ignore next -- String.split always returns at least one element; the fallback guards a nonconforming runtime only. */
    this.buffer = lines.pop() ?? ''
    return lines.filter(line => line.length > 0)
  }

  /**
   * Drain the decoder at stream end.
   * @returns the unterminated tail as one line, or nothing when the stream ended on a newline.
   */
  end(): string[] {
    const tail = this.buffer
    this.buffer = ''
    return tail.length > 0 ? [tail] : []
  }
}
