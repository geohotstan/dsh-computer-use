# dsh-computer-local

[English](README.md) | 中文

计算机操作接缝的本地服务提供者：`LocalComputerEngine` 通过子进程管道上的换行分隔 JSON-RPC 2.0 驱动常驻 macOS 助手守护进程（`dsh-computer-daemon`，Swift 源码在 [`native/`](../native/)）。守护进程拥有捕获会话——每应用辅助功能树、差异、保留的元素索引——引擎拥有守护进程生命周期：加载时即启动以便启动阶段执行 TCC 预检、崩溃后重启、销毁时经 harness 子进程接缝按进程树终止。

## 守护进程职责

用 `pnpm run build:native` 构建：先用 `swift build -c release` 编译 `native/`，再把二进制打包为 `native/.build/dsh-computer-daemon.app` 签名的应用（`native/scripts/bundle.sh` 负责布局与签名）。`helperPath` 必须指向包内的可执行文件——`native/.build/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon`——正是这个 bundle 身份让 macOS 把 TCC 提示归属给助手。它优先使用公开 macOS API（Accessibility、ScreenCaptureKit、CGEvent），并为后台输入投递增加私有 SkyLight 快速路径，动态解析并逐符号回退到公开路径：

- 应用列举：`NSWorkspace` 运行中的应用与 Spotlight 已安装应用合并。
- 捕获：macOS 辅助功能（AX）树序列化为带编号、制表缩进、特征标注的元素索引格式，外加 `ScreenCaptureKit` 窗口截图（JPEG）与短暂的框选高亮。连续捕获返回差异标记行。
- 输入：后台优先投递（Codex 执行模型）——语义操作走元素自身的 AX 动作（`AXPress`、翻页滚动、值/选区写入），完全不需要焦点；原始鼠标/键盘事件（坐标点击、输入、组合键、拖拽、滚轮）经私有 SkyLight 路径直接投递给目标应用进程（`SLEventPostToPid` 加键盘认证信封、Chromium 窗口路由字段戳记与免提升聚焦记录，移植自 MIT 许可的 trycua/cua 项目），并按符号回退到公开的 `CGEvent.postToPid`——不激活、不提升，用户的前台从不改变，真实光标绝不移动。左键点击额外执行带戳记配方：mouseMoved 引导、Chromium 的屏幕外 (-1,-1) 引导点击、同一点击组 id 下的目标按下/抬起对。文本走逐字符 unicode，非 ASCII 与 Electron 系应用走剪贴板粘贴（⌘V，剪贴板保存并恢复）；粘贴组合键走无信封路径，使 NSMenu 分派能看到它。拒绝后台投递的应用必须由 `foregroundApps` 钉到完整前台路径（提升 + 激活 + 全局事件注入）——该路径绝不自动进入。应用启动均为后台启动（`activates: false`），专用浏览器启动抑制 Chromium 的自激活闪屏。

守护进程需要 macOS **辅助功能**与**屏幕录制** TCC 授权。加载时它会为任何缺失的授权弹出系统对话框，并在 macOS 已记住拒绝（对话框无法再次出现）时直接打开对应的系统设置面板，用户无需手动导航。授权仍缺失时引擎拒绝激活——`[Service.init]` 预检抛错，从而卸载 `ctx.computer` 并使 `computer_use_*` 工具不注册。它还暴露 `permissionStatus()`（守护进程的 `permission_status` 方法）。

## 配置

| 字段 | 默认值 | 用途 |
|---|---|---|
| `helperPath` | （必填） | 打包后 `.app` 内守护进程可执行文件的绝对路径；`DSH_COMPUTER_HELPER_PATH` 为环境变量覆盖。加载时缺失即报错。 |
| `helperArgs` | `[]` | 追加在守护进程路径后的 argv 项。 |
| `timeoutMs` | `15_000` | 单请求默认超时。 |
| `maxTimeoutMs` | `120_000` | 单请求超时覆盖的上限。 |
| `maxTreeBytes` | `256_000` | 每次捕获树文本的字节上限；超出则带完整性标记截断。 |
| `maxScreenshotBytes` | `2_097_152` | 每张截图的字节上限；更大的截图使请求失败。 |
| `graceMs` | `3_000` | 守护进程终止宽限期。 |
| `foregroundApps` | `[]` | 必须走前台路径（提升窗口、全局事件注入）的应用规范 id，因其拒绝后台投递；未列出的应用使用 SkyLight 后台投递加公开回退，前台路径绝不自动进入。 |
| `browserIsolation` | `false` | 把浏览器目标与用户的浏览器隔离：为 true 时，Chromium 系浏览器以全新实例加自有临时 user-data 目录启动，而不是驱动用户已登录的配置（Safari 无法隔离）。 |
| `browserUrlAllow` | `[]` | 允许驱动浏览器的 URL 前缀（协议，可含主机与端口）。缺省时除 `browserUrlDeny` 外全部允许；存在时 URL 必须以其中一个前缀开头，否则捕获以浏览器 URL 拒绝失败。 |
| `browserUrlDeny` | `[]` | 始终拒绝的 URL 前缀，即使 `browserUrlAllow` 也匹配。 |
| `deniedApps` | `[]` | 以组织策略拒绝彻底阻止的应用规范 id；对这些应用的捕获与动作都会失败。 |

配置在接缝的 `computer` 命名空间注册设置节，所有字段运行时可被用户覆盖。

## 生命周期与失败行为

- 每引擎一个常驻守护进程，并发请求共享；融合的单请求截止时间以 `timed out after <ms>` 或 `aborted` 拒绝，按首个原因分类。
- 崩溃的守护进程以 `daemon exited unexpectedly` 加保留的 stderr 尾部拒绝在途调用，下一次请求生成新守护进程。
- 线路载荷在边界逐字段校验；守护进程输出异常时响亮断开连接而非静默超时。

## Model Experience

Indirectly, through the model-facing tools of `dsh-computer-tools`; the provider backend registers no prompt, schema, or result of its own.

#### KV Cache effect

No direct effect: provider-owned capture text and screenshots reach the model only through the consumer's rendered results.

## Known Limitations and Deferred Work

- **仅限 macOS** — 引擎在非 darwin 主机加载时拒绝；守护进程面向 macOS 14+（arm64/x64）。
- **需要本地构建** — 守护进程由 `native/` 源码构建并打包；不发布预构建产物，包安装不运行 `swift build` 与打包步骤。
- **TCC 授权持久性** — macOS 以 bundle id、代码签名和磁盘路径为键记录每项授权。用默认的 ad-hoc 签名重建（或移动检出目录）会重置授权；请以稳定身份签名（`DSH_COMPUTER_SIGN_IDENTITY`）并保持检出路径固定，避免重复提示。
- **后台投递因应用而异** — 忽略直接投递事件的应用需要 `foregroundApps`；后台投递现走私有 SkyLight 路径（按符号回退到公开的进程内投递），依赖的私有 API 可能随 macOS 版本变化——符号缺失时降级到公开路径而非失败。
- **每应用一个窗口** — 捕获针对一个窗口，且在该窗口存续期间保持锚定，因此用户同时使用同一应用不会重新定向会话；多窗口目标与按窗口标识留待后续（Codex 的 `window2` API 是参考设计）。
- **使用元数据** — `listApps` 经 `MDItem` 读取 Spotlight `kMDItemUseCount`/`kMDItemLastUsedDate`；没有索引使用记录的应用在运行时仍会出现，接缝上这两个字段保持可选。
- **锁屏** — 捕获与动作在执行前等待锁屏解除（各自上限 30 秒），无可见覆盖层；不复刻 Codex 的覆盖层呈现。
