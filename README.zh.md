# dsh-computer-use

[English](README.md) | 中文

一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的独立插件：macOS 桌面计算机操作——应用列举、以截图加模型可读辅助功能树捕获关键窗口、合成鼠标键盘输入——克隆自 OpenAI 的 Codex Computer Use 窗口 API。输入投递与 Codex 自身的执行模型一致、后台优先：语义 AX 动作完全不需要焦点，原始事件走私有 SkyLight 路径（`SLEventPostToPid` 加键盘认证信封、字段戳记与免提升聚焦记录，移植自 MIT 许可的 [trycua/cua](https://github.com/trycua/cua) 项目），并按符号回退到公开的 `CGEvent.postToPid`，因此用户的前台从不改变。不需要任何 OpenAI 组件。

设计遵循“辅助功能树优先”：`computer_use_get_app_state` 返回带编号、制表缩进的元素树；模型按元素索引操作，窗口相对坐标作为回退；同一应用的后续捕获返回相对上一棵树的差异而非完整树。

与 OpenAI 实现之间的完整功能差异见 [docs/codex-parity.md](docs/codex-parity.md)，该参考文档即对齐清单。

## 安装

本仓库是一个 DSH bundle：根 `package.json` 声明 `dsh.bundle.patch` → [`cordis.patch.yml`](cordis.patch.yml)，后者插入三行 host 插件。像安装其他 bundle 一样从检出安装它。

### 懒人版

对你的 dsh 说：

```
安装一下这个插件包：https://github.com/geohotstan/dsh-computer-use
```

### 手动

```sh
git clone https://github.com/geohotstan/dsh-computer-use
cd dsh-computer-use
pnpm install
pnpm run build            # 构建各插件包的 host lib/
pnpm run build:native     # 构建、签名并打包守护进程（每台机器一次；需要 Xcode 命令行工具）
cd <你运行 dsh 的目录>
dsh plugin --profile <名字> add ../dsh-computer-use
```

`dsh plugin add` 会把仓库注册为 profile 的一层 bundle（`dsh.profile.bundles`）。它的行以 `dsh-computer-use/*` 子路径命名，因此一切都通过链接的检出解析——不需要安装任何兄弟包依赖。然后把 `helperPath`（或 `DSH_COMPUTER_HELPER_PATH`）指向签名包内的守护进程可执行文件，并重启 web 服务：

```sh
# helper: <检出目录>/packages/computer-local/native/.build/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon
```

请保持检出路径固定——macOS 以助手的 bundle id、代码签名和磁盘路径为键记录 TCC 授权（见[权限](#权限)）。

## 包

| 包 | 角色 | 加载行 |
|---|---|---|
| [`dsh-computer`](packages/computer/README.md) | 服务定义——`ctx.computer` | 由 `computer-local` 注册 |
| [`dsh-computer-local`](packages/computer-local/README.md) | 本地提供者——常驻 Swift 守护进程（AX 树、截图、CGEvent 输入） | `dsh-computer-use/computer-local` |
| [`dsh-computer-tools`](packages/computer-tools/README.md) | `computer_use_*` 工具与 `computer-use` skill | `dsh-computer-use/computer-tools` |
| [`dsh-computer-policy`](packages/computer-policy/README.md) | 按应用审批闸门、Codex 风格分级指引与 `computer_use_list_granted_applications` | `dsh-computer-use/computer-policy` |
| [`dsh-computer-mcp`](packages/computer-mcp/README.md) | 独立 MCP stdio 服务器，为外部 MCP 客户端暴露同一表面 | 非加载行——独立二进制 |

## 组合

手工编写组合（在 harness 源码树内，包以 workspace 或已发布依赖形式存在）时使用裸包名：

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

`helperPath` 必须指向打包后的守护进程可执行文件；其余行可选（`dsh-computer-policy` 需要挂载审批服务，例如 `@deepseek-ai/dsh-user-approval`）。可运行组合见 [`example/cordis.yml`](example/cordis.yml)。

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

## 验证

- CI `check` 任务（Ubuntu）：从 npm 全新 `pnpm install`——正是用户走的路径——然后 typecheck、test、build。测试驱动一个 fake daemon，因此不需要桌面、macOS 权限或原生构建。
- CI `native` 任务（macOS）：构建并单测 Swift 助手守护进程。
- CI `install` 任务（Ubuntu）：对真实 CLI 跑文档里的安装链路——`dsh plugin --profile ci add <检出目录>`——然后组合 profile，断言 bundle 层已注册、三行已组合、且每个 `dsh-computer-use/*` 行都能通过链接的检出解析到已构建的 `lib/`。

## 许可证

MIT——见 [LICENSE](LICENSE)。
