# dsh-computer-use

[English](README.md) | 中文

一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的独立插件：macOS 桌面计算机操作——应用列举、以截图加模型可读辅助功能树捕获关键窗口、合成鼠标键盘输入——克隆自 OpenAI 的 Codex Computer Use 窗口 API。输入投递与 Codex 自身的执行模型一致、后台优先：语义 AX 动作完全不需要焦点，原始事件走私有 SkyLight 路径（`SLEventPostToPid` 加键盘认证信封、字段戳记与免提升聚焦记录，移植自 MIT 许可的 [trycua/cua](https://github.com/trycua/cua) 项目），并按符号回退到公开的 `CGEvent.postToPid`，因此用户的前台从不改变。不需要任何 OpenAI 组件。

设计遵循“辅助功能树优先”：`computer_use_get_app_state` 返回带编号、制表缩进的元素树；模型按元素索引操作，窗口相对坐标作为回退；同一应用的后续捕获返回相对上一棵树的差异而非完整树。

与 OpenAI 实现之间的完整功能差异见 [docs/codex-parity.md](docs/codex-parity.md)，该参考文档即对齐清单。

## 包

| 包 | 角色 | 加载行 |
|---|---|---|
| [`dsh-computer`](packages/computer/README.md) | 服务定义——`ctx.computer` | 由 `computer-local` 注册 |
| [`dsh-computer-local`](packages/computer-local/README.md) | 本地提供者——常驻 Swift 守护进程（AX 树、截图、CGEvent 输入） | `plugin: dsh-computer-local` |
| [`dsh-computer-tools`](packages/computer-tools/README.md) | `computer_use_*` 工具与 `computer-use` skill | `plugin: dsh-computer-tools` |
| [`dsh-computer-policy`](packages/computer-policy/README.md) | 按应用审批闸门、Codex 风格分级指引与 `computer_use_list_granted_applications` | `plugin: dsh-computer-policy` |
| [`dsh-computer-mcp`](packages/computer-mcp/README.md) | 独立 MCP stdio 服务器，为外部 MCP 客户端暴露同一表面 | 非加载行——独立二进制 |

## 安装

插件依赖已发布的 harness 包（`@deepseek-ai/dsh-*`、`@deepseek-ai/cordis`、`@deepseek-ai/schemastery`）。发布这四个包（或把本文件夹作为额外 workspace 加入同一检出后安装），然后：

```sh
pnpm add dsh-computer-local dsh-computer-tools dsh-computer-policy
```

构建原生助手（每个发布版一次；需要 Xcode 命令行工具）。这一步会构建 Swift 二进制**并**将其打包为签名的 `.app`——正是这一步让 macOS 把 TCC 权限提示归属给助手，而不是托管 harness 的终端：

```sh
pnpm run build:native
# helper: packages/computer-local/native/.build/dsh-computer-daemon.app
```

`helperPath` 必须指向包内的可执行文件：`packages/computer-local/native/.build/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon`。

## 组合

把行加入 harness 组合（`cordis.yml` 或 profile 补丁）。`helperPath` 必须指向打包后的守护进程可执行文件；其余行可选（`dsh-computer-policy` 需要挂载审批服务，例如 `@deepseek-ai/dsh-user-approval`）。

```yaml
plugins:
  computer-engine:
    plugin: dsh-computer-local
    config:
      helperPath: /absolute/path/to/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon
  computer-tools:
    plugin: dsh-computer-tools
  computer-policy:
    plugin: dsh-computer-policy
```

可运行组合见 [`example/cordis.yml`](example/cordis.yml)。

## MCP 服务器

`dsh-computer-mcp` 把同一表面——官方十个 Codex Computer Use 窗口工具加 `request_access` 与三个 `event_stream_*` 录制工具——发布为独立 MCP stdio 服务器，在同一引擎上运行，使 Codex CLI、Claude Code 或任何 MCP 客户端都能驱动 harness 的计算机操作：

```sh
# 在本检出的 `pnpm run build` 之后
node packages/computer-mcp/lib/mcp.js /absolute/path/to/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon
# 或用环境变量覆盖
DSH_COMPUTER_HELPER_PATH=/absolute/path/to/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon dsh-computer-mcp
```

服务器在 stdin/stdout 上讲换行分隔的 JSON-RPC 2.0，应答 `initialize` / `ping` / `tools/list` / `tools/call`，并复刻官方响应行为：动作工具以动作后状态作答（文本加捕获到的 JPEG 图像块）。

## 权限

守护进程需要两项 macOS 授权，启动时检查并请求：**辅助功能**（读树与输入定位）与**屏幕录制**（窗口截图）。两者都是 TCC 权限；插件绝不绕过它们。加载时会为任何缺失的授权弹出提示，并在 macOS 已记住拒绝时打开对应的系统设置面板；授权缺失期间插件拒绝激活，因此计算机操作不会加载。

macOS 以助手的 bundle id、代码签名和磁盘路径为键记录每一项授权。请保持检出路径固定，并用稳定身份签名，让授权在重建后仍然有效。任何 designated requirement 为 identifier 加证书的代码签名证书都适用——包括用 Keychain Access 创建的自签证书（证书助理 → 创建证书 → 代码签名）。设置一次：

```sh
DSH_COMPUTER_SIGN_IDENTITY="<证书通用名>" pnpm run build:native
```

默认的 ad-hoc 签名可用，但其 designated requirement 是二进制的 cdhash，因此 macOS 会在每次重建后忘记授权。

## 开发

```sh
pnpm install
pnpm test          # fake-daemon tests; nothing touches a live desktop
pnpm run typecheck
pnpm run build     # emits lib/ for all four packages
```

## 许可证

MIT——见 [LICENSE](LICENSE)。
