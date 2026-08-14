# @geohotstan/dsh-codex-computer-use/computer-tools

English | [中文](README.zh.md)

Model-facing Consumer of the `ctx.computer` seam: the ten `computer_use_*` tools mirroring the Codex Computer Use window API, plus the cross-call capture guidance that makes the accessibility-tree-first flow work. Window screenshots accompany `computer_use_get_app_state` as image blocks when an attachment store and an image-capable model route are mounted; without either, the tree text alone carries the result.

## Tools

| Tool | Purpose |
|---|---|
| `computer_use_list_apps` | List targetable apps with running status. |
| `computer_use_get_app_state` | Capture the key window's screenshot and accessibility tree; call once per assistant turn before interacting. |
| `computer_use_click` | Click an element index, or a window-relative x/y fallback; count and button variants. |
| `computer_use_type_text` / `computer_use_press_key` | Type literal text; press a keysym-style chord. |
| `computer_use_scroll` | Scroll an indexed element by pages. |
| `computer_use_set_value` / `computer_use_select_text` | Replace an editable value directly; locate text and select or place the cursor. |
| `computer_use_drag` / `computer_use_perform_secondary_action` | Drag between coordinates; invoke a named accessibility action. |

The tool executes the cross-field rules the schema cannot express: a click addresses exactly one mode, counts and pages are positive, and app/text/key/action inputs are non-empty (`set_value` may clear a field). The tool converts a caller abort into the registry's `tool call aborted` error.

## Screenshot flow

`computer_use_get_app_state` commits the captured JPEG to the durable attachment store and renders it as an image block beside the `<app_state>` envelope. The capture degrades to tree text — never fails — when the attachment store is absent, rejects JPEG, the route does not declare image input, metadata resolution fails, the capture is null, or the bytes exceed the attachment limits. The canonical value carries the attachment reference so Code Mode callers receive it programmatically, and a nested dispatch defers the rendered capture into the next model request.

## Config

| Field | Default | Purpose |
|---|---|---|
| `enableScreenshots` | `true` | Attach window screenshots when the route carries images; `false` serves tree-only captures. |

Deployment policy belongs in `tools/pre-execute`; [`@geohotstan/dsh-codex-computer-use/computer-policy`](computer-policy.md) supplies the approval gate for control actions.

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

- **No `launch_app` tool** — the macOS window API the tools mirror has no launch verb; `computer_use_get_app_state` starts the app's session, and the daemon launches a non-running app on first capture.
- **Key window only** — captures target the key window; multi-window targeting is deferred to the daemon.
- **Screenshot model gate** — a route without declared image input serves tree-only captures; there is no pixel-coordinate fallback prompt, matching the tree-first design.
