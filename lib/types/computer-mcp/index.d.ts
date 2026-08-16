/**
 * MCP stdio server exposing the official Codex Computer Use tool surface,
 * backed by the dsh computer-use engine (the resident macOS daemon). One
 * newline-delimited JSON-RPC 2.0 object per line on stdin/stdout; the tools
 * and their schemas mirror the reverse-engineered official `computer-use` MCP
 * (the ten window tools plus `request_access`), and the call responses mirror
 * the official behavior — action tools answer with the post-action state
 * (text plus a JPEG screenshot block when one was captured).
 * @module @zibokapi/dsh-codex-computer-use/computer-mcp
 */
import { Context } from '@deepseek-ai/cordis';
import type { ComputerEngine } from '../computer/index.ts';
/** MCP protocol version this server speaks. */
export declare const MCP_PROTOCOL_VERSION = "2025-03-26";
/** Server identity reported by `initialize`. */
export declare const MCP_SERVER_NAME = "dsh-computer-mcp";
/** Server version reported by `initialize`. */
export declare const MCP_SERVER_VERSION = "0.1.0";
/** Boot options for the MCP server. */
export interface McpServerOptions {
    /** Absolute path to the daemon executable inside its bundled .app; env `DSH_COMPUTER_HELPER_PATH` when absent. */
    helperPath?: string;
}
/** One MCP tool definition: name, description, and JSON input schema. */
interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}
/** The official ten window tools plus `request_access`, with the official schema vocabulary. */
export declare const TOOL_DEFINITIONS: readonly ToolDefinition[];
/** One parsed stdin request line; nil-able shape checked field by field. */
interface McpRequest {
    jsonrpc: '2.0';
    id: number | string;
    method: string;
    params?: Record<string, unknown>;
}
/**
 * One running MCP server: the cordis context, the engine, and the request
 * loop over stdin. Disposal stops the engine's resident daemon.
 */
export declare class McpServer {
    readonly ctx: Context;
    readonly engine: ComputerEngine;
    constructor(ctx: Context, engine: ComputerEngine);
    /** Handle one MCP request and return the response payload (or undefined for notifications). */
    handle(request: McpRequest): Promise<Record<string, unknown> | undefined>;
    /** Route one `tools/call` to the engine, mirroring the official response behavior. */
    private callTool;
    private executeTool;
    /** The canonical recording status text block. */
    private recordStatusContent;
    /** The official action-response behavior: re-capture the app state after an action. */
    private postActionState;
    /** Canonical state content: verbatim tree text plus a JPEG image block when one was captured. */
    private stateContent;
    /** Serve requests on stdin until the stream ends or the process is terminated. */
    serve(): Promise<void>;
}
/** MCP protocol error with a JSON-RPC error code. */
export declare class McpError extends Error {
    readonly code: number;
    constructor(code: number, message: string);
}
/** Boot the engine and return a serving MCP server. */
export declare function createServer(options?: McpServerOptions): Promise<McpServer>;
export {};
//# sourceMappingURL=index.d.ts.map