# @geohotstan/dsh-codex-computer-use/computer

[English](README.md) | 中文

桌面计算机操作接缝（`ctx.computer`）的服务定义：一个引擎驱动一台本地桌面——列举可操作应用、以截图加模型可读辅助功能树捕获应用关键窗口、并向该应用合成鼠标键盘输入。设计沿用 OpenAI Codex Computer Use 的“辅助功能树优先”模型：用元素索引从最近一次捕获中定位控件，窗口相对坐标作为回退，同一应用的连续捕获返回相对上一棵树的差异。

## 服务

`ComputerEngine`（抽象类，注册为 `ctx.computer`）暴露 `resolve()` 与十个操作：

| 方法 | 用途 |
|---|---|
| `resolve(request)` | 应用实现方超时默认值与上限；每个方法都接收已解析的 `ComputerExecSpec`。 |
| `listApps(spec)` | 列举可操作应用（bundle id、显示名、运行状态、可选使用元数据）。 |
| `getAppState(spec)` | 捕获关键窗口：辅助功能文本（完整树或带标记的差异）与可选的 JPEG 截图。 |
| `click(spec)` | 按索引元素或窗口相对 x/y 点击，支持次数与按键变体。 |
| `typeText(spec)` / `pressKey(spec)` | 输入字面文本；按下 keysym 风格按键组合。 |
| `scroll(spec)` | 按页数滚动一个索引元素。 |
| `setValue(spec)` / `selectText(spec)` | 直接替换可编辑值；定位文本并选中或放置光标。 |
| `drag(spec)` / `performSecondaryAction(spec)` | 坐标间拖拽；调用具名辅助功能动作。 |

各实现必须遵守的语义：

- 方法仅在基础设施、协议或策略失败时拒绝；输入动作完成后以无值完成。
- 某应用的首次捕获返回完整序列化树；后续捕获在未设置 `disableDiff` 时返回差异。实现若在字节上限处截断树，必须附加 `TREE_TRUNCATED_MARK` 并报告 `truncated: true`——绝不把截断树呈现为完整。
- `resolve` 是唯一的默认值与上限步骤：方法不会对已解析的 spec 重新取默认值。
- 捕获会话为提供者自有状态；引擎销毁时随之结束。

## 共享辅助函数

本包还拥有提供者与工具消费者共用的纯跨角色词汇：方向与鼠标按键的规范拼写、点击寻址规则（`element_index` 与 `x`/`y` 二选一）、动作请求合理性检查、按字节上限截断树，以及 `<app_state>` 模型信封。

## 设计说明

接缝天然有状态，对应 Codex 的双进程布局：常驻侧在两次捕获之间保存每应用的树与差异状态，前端工具只做协议翻译而不持有状态。截图是确认信息而非主要载体：捕获失败或被拒时 `getAppState` 返回 `screenshot: null`，树文本仍可单独使用。

## Model Experience

Indirectly, through the model-facing tools of `@geohotstan/dsh-codex-computer-use/computer-tools`; this service interface registers no prompt, schema, or result of its own.

#### KV Cache effect

No direct effect: the engine's request and result types reach the model only through the consumer's tool schemas and renderers, whose reuse behavior `@geohotstan/dsh-codex-computer-use/computer-tools` owns.

## Known Limitations and Deferred Work

- **单引擎组合** — 每个上下文只能挂载一个 `ctx.computer` 提供者（cordis 重复服务行为）；多桌面或远程桌面目标需要注册表形状的接缝而非单引擎。
- **捕获状态按引擎而非持久化** — 重启会丢失上一棵树，重启后的首次捕获又是完整树。跨重启持久化每应用树留待后续。
