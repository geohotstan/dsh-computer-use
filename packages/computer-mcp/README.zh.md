# dsh-computer-mcp

[English](README.md) | 中文

独立 MCP stdio 服务器，暴露官方 Codex Computer Use 表面——十个窗口工具（`list_apps`、`get_app_state`、`click`、`perform_secondary_action`、`scroll`、`drag`、`type_text`、`press_key`、`set_value`、`select_text`），加 `request_access` 与三个 `event_stream_start` / `event_stream_status` / `event_stream_stop` Record & Replay 工具——由同一个 `dsh-computer-local` 引擎与常驻守护进程支撑。任何 MCP 客户端（Codex CLI、Claude Code 等）都可以经它驱动 harness 的计算机操作。

## 用法

```sh
dsh-computer-mcp /absolute/path/to/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon
# 或
DSH_COMPUTER_HELPER_PATH=/absolute/path/to/… dsh-computer-mcp
```

服务器在 stdin/stdout 上讲换行分隔的 JSON-RPC 2.0，应答 `initialize`、`ping`、`tools/list` 与 `tools/call`。工具 schema 复刻逆向工程得到的官方定义；调用响应复刻官方行为——动作工具以动作后状态作答（原样树文本加捕获到的 JPEG 图像块），`press_key` 附加 `Selected text: […]`，错误以 `isError` 内容返回。

## Model Experience

Indirectly, through whichever MCP client consumes the server; the server registers no prompt, schema, or result of its own beyond the protocol surface.

#### KV Cache effect

No direct effect: state text and screenshots reach models only through the consuming MCP client.

## Known Limitations and Deferred Work

- **仅限 macOS** — 引擎拒绝非 darwin 主机；守护进程面向 macOS 14+（arm64/x64）。
- **每服务器进程一个守护进程** — MCP 服务器生成自己的常驻守护进程；harness 与 MCP 客户端可以各自持有一个驱动同一桌面，但两个 agent 不得同时驱动同一个应用。
- **无会话审批** — MCP 表面不携带按应用审批闸门；消费方客户端拥有自己的策略（DSH harness 的 `dsh-computer-policy` 不适用于 MCP 调用方）。
- **未复刻 `sky_click` 与锁屏使用** — 它们分别依赖私有 SkyLight API 与授权插件。
