# @zibokapi/dsh-codex-computer-use

[English](README.md) | 中文

一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的独立插件：macOS 桌面计算机操作——应用列举、以截图加模型可读辅助功能树捕获关键窗口、合成鼠标键盘输入——克隆自 OpenAI 的 Codex Computer Use 窗口 API。输入投递与 Codex 自身的执行模型一致、后台优先：语义 AX 动作完全不需要焦点，原始事件走私有 SkyLight 路径（`SLEventPostToPid` 加键盘认证信封、字段戳记与免提升聚焦记录，移植自 MIT 许可的 [trycua/cua](https://github.com/trycua/cua) 项目），并按符号回退到公开的 `CGEvent.postToPid`，因此用户的前台从不改变。不需要任何 OpenAI 组件。

设计遵循“辅助功能树优先”：`computer_use_get_app_state` 返回带编号、制表缩进的元素树；模型按元素索引操作，窗口相对坐标作为回退；同一应用的后续捕获返回相对上一棵树的差异而非完整树。

全部内容都在这一个包里：接缝、本地 Swift 守护进程提供者、`computer_use_*` 工具、审批策略与独立 MCP 服务器。与 OpenAI 实现之间的完整功能差异见 [docs/codex-parity.md](docs/codex-parity.md)，该参考文档即对齐清单。

## 安装

本仓库是一个 DSH bundle：根 `package.json` 声明 `dsh.bundle.patch` → [`cordis.patch.yml`](cordis.patch.yml)，后者以本包自己的子路径（`@zibokapi/dsh-codex-computer-use/*`）插入三行 host 插件。一次安装带齐全部内容。

```sh
# 1. 把插件安装进 profile
dsh plugin --profile <名字> add @zibokapi/dsh-codex-computer-use

# 2. 构建 macOS 守护进程并授权（每台机器一次）
npx @zibokapi/dsh-codex-computer-use

# 3. （重新）启动 profile —— computer_use_* 工具即可用
dsh --profile <名字> web
```

第 2 步是唯一与 macOS 相关的部分：它用已安装包内自带的 `native/` 目录构建 Swift 助手（需要 Xcode 命令行工具——`xcode-select --install`），打包并签名到 `~/.dsh/computer-use/dsh-computer-daemon.app`，然后通过 macOS 系统对话框**显式请求**守护进程所需的两项权限——**辅助功能**与**屏幕录制**——并轮询直到授权生效。它不写任何配置，也不需要配置：`helperPath` 未设置时，引擎会回退到这个确切路径。

安装位置固定是有意为之。macOS TCC 以助手的 bundle id、代码签名和磁盘路径为键记录授权；`node_modules` 里的路径会随每次插件更新而变化，因此守护进程安装在 DSH home（`$DSH_HOME/computer-use`）下，授权在插件更新后依然有效。

插件每次加载时都会重新检查授权：缺失或被撤销的授权意味着计算机操作在该授权补齐前不会加载（macOS 已记住拒绝时，守护进程会打开对应的系统设置面板）。随时可用 `dsh-codex-computer-use status` 查看安装状态。

registry 上的 tarball 自带 `lib/`，且 `lib/` 已提交进 git，因此任何安装方式——npm、git URL、打包 tarball——都无需执行构建脚本（`pnpm` ≥10 默认禁止 git 托管依赖的生命周期脚本，所以构建产物直接随仓库分发）。

### 懒人版

对你的 dsh 说：

```
安装一下这个插件包：https://github.com/geohotstan/dsh-computer-use
```

然后执行上面第 2–3 步（`npx @zibokapi/dsh-codex-computer-use`，重启 profile）。

### 手动（从检出安装）

```sh
git clone https://github.com/geohotstan/dsh-computer-use
cd dsh-computer-use
pnpm install
pnpm exec dsh-codex-computer-use   # 构建 + 安装守护进程并请求授权
pnpm run build:native              # 可选：Developer ID / 自签名构建，见「权限」
cd <你运行 dsh 的目录>
dsh plugin --profile <名字> add ../dsh-computer-use
```

`dsh plugin add` 会把仓库注册为 profile 的一层 bundle（`dsh.profile.bundles`）。引擎按以下顺序解析守护进程：`helperPath` 配置 → `DSH_COMPUTER_HELPER_PATH` 环境变量 → 安装命令的安装位置（`~/.dsh/computer-use/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon`）。只有指向自定义构建时才需要设置 `helperPath`。

## 入口

一个包、五个子路径入口（另有 `./<入口>/invariant` 的 invariant 伴侣）：

| 入口 | 角色 | 加载行 |
|---|---|---|
| [`./computer`](docs/computer.zh.md) | 服务定义——`ctx.computer` | 由 `computer-local` 注册 |
| [`./computer-local`](docs/computer-local.zh.md) | 本地提供者——常驻 Swift 守护进程（AX 树、截图、CGEvent 输入） | `@zibokapi/dsh-codex-computer-use/computer-local` |
| [`./computer-tools`](docs/computer-tools.zh.md) | `computer_use_*` 工具与 `computer-use` skill | `@zibokapi/dsh-codex-computer-use/computer-tools` |
| [`./computer-policy`](docs/computer-policy.zh.md) | 按应用审批闸门、Codex 风格分级指引与 `computer_use_list_granted_applications` | `@zibokapi/dsh-codex-computer-use/computer-policy` |
| [`./computer-mcp`](docs/computer-mcp.zh.md) | 独立 MCP stdio 服务器，为外部 MCP 客户端暴露同一表面 | 非加载行——独立二进制 |

## 组合

手工编写组合时使用同样的子路径：

```yaml
plugins:
  computer-engine:
    plugin: '@zibokapi/dsh-codex-computer-use/computer-local'
  computer-tools:
    plugin: '@zibokapi/dsh-codex-computer-use/computer-tools'
  computer-policy:
    plugin: '@zibokapi/dsh-codex-computer-use/computer-policy'
```

`helperPath` 可选——引擎会回退到安装命令的安装位置；其余行同样可选（`@zibokapi/dsh-codex-computer-use/computer-policy` 需要挂载审批服务，例如 `@deepseek-ai/dsh-user-approval`）。可运行组合见 [`example/cordis.yml`](example/cordis.yml)。

## MCP 服务器

`@zibokapi/dsh-codex-computer-use/computer-mcp` 这个 bin 把同一表面——官方十个 Codex Computer Use 窗口工具加 `request_access` 与三个 `event_stream_*` 录制工具——发布为独立 MCP stdio 服务器，在同一引擎上运行，使 Codex CLI、Claude Code 或任何 MCP 客户端都能驱动 harness 的计算机操作。该 bin 与其他入口一样把 harness 包留在外部（`@deepseek-ai/dsh-subprocess-local` 带有 node-pty——无法打包的原生模块），因此在 `pnpm install` 已拉齐依赖的任何环境都能运行：

```sh
# 执行过 `npx @zibokapi/dsh-codex-computer-use` 后无需路径：
node lib/mcp.js
# 显式路径（第一个参数）与环境变量覆盖同样可用：
node lib/mcp.js /absolute/path/to/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon
DSH_COMPUTER_HELPER_PATH=/absolute/path/to/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon dsh-computer-mcp
```

服务器在 stdin/stdout 上讲换行分隔的 JSON-RPC 2.0，应答 `initialize` / `ping` / `tools/list` / `tools/call`，并复刻官方响应行为：动作工具以动作后状态作答（文本加捕获到的 JPEG 图像块）。

## 权限

守护进程需要两项 macOS 授权，启动时检查并请求：**辅助功能**（读树与输入定位）与**屏幕录制**（窗口截图）。两者都是 TCC 权限；插件绝不绕过它们。安装命令（`npx @zibokapi/dsh-codex-computer-use`）会提前请求两项授权，且插件每次加载都会复查：为任何缺失的授权弹出提示，并在 macOS 已记住拒绝时打开对应的系统设置面板；授权缺失期间插件拒绝激活，因此计算机操作不会加载。

macOS 以助手的 bundle id、代码签名和磁盘路径为键记录每一项授权。安装命令把守护进程安装到固定路径（`~/.dsh/computer-use`），授权因此可以留存；再用稳定身份签名，授权还能在重建后仍然有效。任何 designated requirement 为 identifier 加证书的代码签名证书都适用——包括用 Keychain Access 创建的自签证书（证书助理 → 创建证书 → 代码签名）。设置一次：

```sh
DSH_COMPUTER_SIGN_IDENTITY="<证书通用名>" npx @zibokapi/dsh-codex-computer-use
```

默认的 ad-hoc 签名可用，但其 designated requirement 是二进制的 cdhash，因此 macOS 会在每次重建后忘记授权。

## 开发

```sh
pnpm install
pnpm test          # fake-daemon tests; nothing touches a live desktop
pnpm run typecheck
pnpm run build     # esbuild → lib/, tsc → lib/types
```

## 验证

- CI `check` 任务（Ubuntu）：从 npm 全新 `pnpm install`——正是用户走的路径——然后对已发布的 `@deepseek-ai/*` 包做 typecheck 与 build。
- CI `native` 任务（macOS）：构建并单测 Swift 助手守护进程，运行 Node 测试套件——引擎按设计只支持 macOS（在非 darwin 主机上构造时抛出平台闸门），因此启动引擎的测试放在这里，驱动 fake daemon、不触碰真实桌面——并端到端演练安装命令（构建、打包、签名、安装、status）。
- CI `install` 任务（Ubuntu）：对真实 CLI 跑文档里的安装链路——`dsh plugin --profile ci add` 分别从检出路径、打包 tarball 与 git URL 安装——断言安装命令在非 macOS 主机上给出可操作的提示，然后组合 profile，断言 bundle 层已注册、三行已组合、且每个 `@zibokapi/dsh-codex-computer-use/*` 行都能通过已安装的包解析并加载。

## 许可证

MIT——见 [LICENSE](LICENSE)。
