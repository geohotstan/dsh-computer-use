# dsh-computer-mcp

English | [中文](README.zh.md)

Standalone MCP stdio server exposing the official Codex Computer Use surface — the ten window tools (`list_apps`, `get_app_state`, `click`, `perform_secondary_action`, `scroll`, `drag`, `type_text`, `press_key`, `set_value`, `select_text`), plus `request_access` and the three `event_stream_start` / `event_stream_status` / `event_stream_stop` Record & Replay tools — backed by the same `dsh-computer-local` engine and resident daemon. Any MCP client (Codex CLI, Claude Code, …) can drive the harness's computer use through it.

## Usage

```sh
dsh-computer-mcp /absolute/path/to/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon
# or
DSH_COMPUTER_HELPER_PATH=/absolute/path/to/… dsh-computer-mcp
```

The server speaks newline-delimited JSON-RPC 2.0 on stdin/stdout and answers `initialize`, `ping`, `tools/list`, and `tools/call`. Tool schemas mirror the reverse-engineered official definitions; call responses mirror the official behavior — action tools answer with the post-action state (verbatim tree text plus a JPEG image block when a screenshot was captured), `press_key` appends `Selected text: […]`, and errors return `isError` content.

## Model Experience

Indirectly, through whichever MCP client consumes the server; the server registers no prompt, schema, or result of its own beyond the protocol surface.

#### KV Cache effect

No direct effect: state text and screenshots reach models only through the consuming MCP client.

## Known Limitations and Deferred Work

- **macOS only** — the engine rejects non-darwin hosts; the daemon targets macOS 14+ (arm64/x64).
- **One daemon per server process** — the MCP server spawns its own resident daemon; a harness and an MCP client can each hold one against the same desktop, but two agents must not drive the same app simultaneously.
- **No session approvals** — the MCP surface carries no per-app approval gate; the consuming client owns its own policy (the DSH harness's `dsh-computer-policy` does not apply to MCP callers).
- **`sky_click` and locked use are not replicated** — they depend on private SkyLight APIs and an authorization plug-in respectively.
