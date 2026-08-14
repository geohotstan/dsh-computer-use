# dsh-computer-tools

[English](README.md) | 中文

`ctx.computer` 接缝的模型侧消费者：十个镜像 Codex Computer Use 窗口 API 的 `computer_use_*` 工具，以及让“辅助功能树优先”流程成立的跨调用捕获指引。挂载了附件存储且模型路由支持图像输入时，窗口截图以图像块伴随 `computer_use_get_app_state`；两者缺一，树文本单独承载结果。

## 工具

| 工具 | 用途 |
|---|---|
| `computer_use_list_apps` | 列举可操作应用与运行状态。 |
| `computer_use_get_app_state` | 捕获关键窗口的截图与辅助功能树；每轮助手交互前调用一次。 |
| `computer_use_click` | 按元素索引点击，或以窗口相对 x/y 回退；支持次数与按键变体。 |
| `computer_use_type_text` / `computer_use_press_key` | 输入字面文本；按下 keysym 风格组合。 |
| `computer_use_scroll` | 按页数滚动索引元素。 |
| `computer_use_set_value` / `computer_use_select_text` | 直接替换可编辑值；定位文本并选中或放置光标。 |
| `computer_use_drag` / `computer_use_perform_secondary_action` | 坐标间拖拽；调用具名辅助功能动作。 |

工具执行 schema 无法表达的跨字段规则：点击恰好一种寻址模式、次数与页数为正、app/text/key/action 输入非空（`set_value` 允许清空字段）。工具把调用方中止转换为注册表的 `tool call aborted` 错误。

## 截图流程

`computer_use_get_app_state` 把捕获的 JPEG 提交到持久附件存储，并以图像块渲染在 `<app_state>` 信封旁。当附件存储缺失、拒绝 JPEG、路由未声明图像输入、元数据解析失败、捕获为空或字节超出附件限制时，捕获降级为树文本——绝不失败。规范值携带附件引用，供 Code Mode 调用方程序化获取；嵌套分发把渲染后的捕获推迟进下一次模型请求。

## 配置

| 字段 | 默认值 | 用途 |
|---|---|---|
| `enableScreenshots` | `true` | 路由支持图像时附带窗口截图；`false` 只返回树文本捕获。 |

部署策略属于 `tools/pre-execute`；[`dsh-computer-policy`](../computer-policy/README.md) 提供控制动作的审批闸门。

## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains the capture guidance below, independent of the tool schemas (a scoped tool restriction hides schemas without removing this section).

##### Capture guidance

```markdown
Computer use is stateful: call `computer_use_get_app_state` once per assistant turn before interacting with an app, then address controls by element index from the returned accessibility tree (window-relative x/y only as a fallback). After every computer_use action, call `computer_use_get_app_state` again to observe the updated UI before the next action.
```

#### Token effect

Small fixed input cost per request while the plugin is active.

#### KV Cache effect

Prefix-stable while the registration scope and prompt text are unchanged; plugin activation or disposal may invalidate reuse from this section.

### Tool schemas

#### What the model sees

The model sees the ten schemas generated from this package's tool definitions. The arguments carry the exact vocabulary above; the `computer_use_get_app_state` result adds `truncated` plus an optional `screenshot` attachment reference.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while visibility and tool definitions are unchanged; a restriction or definition change may invalidate reuse from the first changed tool definition.

### Capture result

#### What the model sees

The `<app_state app="…">` envelope wrapping the engine's tree text (full tree, a marked diff, or the unchanged sentence), prefixed by the screenshot availability note, plus the image block when a screenshot was committed. A truncated tree ends with the engine's truncation mark.

#### Token effect

Data-dependent and bounded: the engine caps tree text at `maxTreeBytes` and the screenshot is skipped beyond the attachment limits.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing entries.

### Action acknowledgement

#### What the model sees

Every completed input action renders exactly `Action completed. Call \`computer_use_get_app_state\` to fetch the updated UI state.`

#### Token effect

Small fixed acknowledgement per action.

#### KV Cache effect

Append-only.

### Tool errors

#### What the model sees

Validation and policy failures are normalized as `Error: <message>`. This package's stable messages are `computer_use: app must be a non-empty string`, `computer_use: click requires exactly one addressing mode: elementIndex, or both x and y`, `computer_use: click coordinates require both x and y`, `computer_use: click_count must be a positive integer, got <value>`, `computer_use: text must be a non-empty string`, `computer_use: key must be a non-empty string`, `computer_use: action must be a non-empty string`, and `tool call aborted`.

#### Token effect

Small fixed error text; retained like any other result until compaction.

#### KV Cache effect

Append-only.

## Known Limitations and Deferred Work

- **无 `launch_app` 工具** — 工具镜像的 macOS 窗口 API 没有启动动词；`computer_use_get_app_state` 启动应用的会话，守护进程在首次捕获时启动未运行的应用。
- **仅关键窗口** — 捕获针对关键窗口；多窗口目标留待守护进程后续实现。
- **截图模型闸门** — 未声明图像输入的路由只得到树文本捕获；与树优先设计一致，不提供像素坐标回退提示。
