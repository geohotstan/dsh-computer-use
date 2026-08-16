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
export declare const DAEMON_METHODS: readonly ["list_apps", "permission_status", "request_permissions", "get_app_state", "click", "type_text", "press_key", "scroll", "set_value", "select_text", "drag", "perform_secondary_action", "event_stream_start", "event_stream_status", "event_stream_stop"];
/** One daemon method name. */
export type DaemonMethod = typeof DAEMON_METHODS[number];
/** A client→daemon request line. */
export interface DaemonRequest {
    jsonrpc: '2.0';
    id: number;
    method: DaemonMethod;
    params: Record<string, unknown>;
}
/** A daemon→client response line: a result, or a protocol error. */
export interface DaemonResponse {
    jsonrpc: '2.0';
    id: number;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}
/**
 * Build a request line for the daemon.
 * @param id - unique numeric id owned by the caller.
 * @param method - the daemon method to invoke.
 * @param params - method parameters, already mapped from the seam request.
 * @returns the serialized one-line request, without trailing newline.
 */
export declare function buildRequest(id: number, method: DaemonMethod, params: Record<string, unknown>): string;
/**
 * Recognize one parsed stdout line as a well-formed daemon response whose
 * numeric id can be correlated. Structural checks only — the payload's
 * method-specific shape is validated by each operation's decoder.
 * @param value - the parsed line.
 * @returns the typed response, or null for a line the engine must ignore.
 */
export declare function parseResponse(value: unknown): DaemonResponse | null;
/**
 * Incremental newline-delimited decoder for the daemon's stdout: feed raw
 * chunks, drain complete lines, and keep one partial tail for the next chunk.
 * A stream that ends mid-line yields that tail as the final line.
 */
export declare class LineDecoder {
    private buffer;
    /**
     * Feed one chunk of the daemon's stdout.
     * @param chunk - raw bytes received from the stream.
     * @returns every complete line the chunk closed.
     */
    push(chunk: Buffer | string): string[];
    /**
     * Drain the decoder at stream end.
     * @returns the unterminated tail as one line, or nothing when the stream ended on a newline.
     */
    end(): string[];
}
//# sourceMappingURL=protocol.d.ts.map