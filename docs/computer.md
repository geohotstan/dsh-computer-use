# @zibokapi/dsh-codex-computer-use/computer

English | [中文](README.zh.md)

Service Definition for the desktop computer-use seam (`ctx.computer`): one engine drives one local desktop — listing targetable apps, capturing an app's key window as a screenshot plus model-readable accessibility tree, and synthesizing mouse and keyboard input into that app. The design follows the accessibility-tree-first model of OpenAI's Codex Computer Use: element indexes address controls from the latest capture, window-relative coordinates are the fallback, and consecutive captures of one app return diffs of the previous tree.

## Service

`ComputerEngine` (abstract, registers as `ctx.computer`) exposes `resolve()` plus ten operations:

| Method | Purpose |
|---|---|
| `resolve(request)` | Apply the implementation's timeout default and cap; every method receives the resolved `ComputerExecSpec`. |
| `listApps(spec)` | List targetable apps (bundle id, display name, running flag, optional usage metadata). |
| `getAppState(spec)` | Capture the key window: accessibility text (full tree or marked diff) plus an optional JPEG screenshot. |
| `click(spec)` | Click an indexed element or a window-relative x/y pair, with count and button variants. |
| `typeText(spec)` / `pressKey(spec)` | Type literal text; press a keysym-style key chord. |
| `scroll(spec)` | Scroll an indexed element by pages. |
| `setValue(spec)` / `selectText(spec)` | Replace an editable value directly; locate text and select it or place the cursor. |
| `drag(spec)` / `performSecondaryAction(spec)` | Drag between coordinates; invoke a named accessibility action. |

Semantics every implementation honors:

- Methods reject only for infrastructure, protocol, or policy failures; a completed input action resolves with no value.
- The first capture for an app returns the full serialized tree; later captures return a diff unless `disableDiff` is set. A provider must mark a tree it truncated at its byte bound with `TREE_TRUNCATED_MARK` and report `truncated: true` — never present a capped tree as complete.
- `resolve` is the single defaulting and capping step: methods never re-default a resolved spec.
- The capture session is provider-owned state; disposing the engine ends it.

## Shared helpers

The package also owns the pure cross-role vocabulary shared by providers and the tool consumer: canonical direction and mouse-button spellings, the click addressing rule (`element_index` xor `x`/`y`), action-request sanity checks, byte-bounded tree truncation, and the `<app_state>` model envelope.

## Design notes

The seam is stateful by design, mirroring Codex's two-process layout: the resident side keeps the per-app tree and diff state alive between captures, so the frontend tools translate a protocol instead of owning state. Screenshots are confirmation, never the carrier: `getAppState` returns `screenshot: null` when capture failed or was refused, and the tree text remains usable alone.

## Model Experience

Indirectly, through the model-facing tools of `@zibokapi/dsh-codex-computer-use/computer-tools`; this service interface registers no prompt, schema, or result of its own.

#### KV Cache effect

No direct effect: the engine's request and result types reach the model only through the consumer's tool schemas and renderers, whose reuse behavior `@zibokapi/dsh-codex-computer-use/computer-tools` owns.

## Known Limitations and Deferred Work

- **Single-engine composition** — exactly one `ctx.computer` provider can mount per context (cordis duplicate-service behavior); multi-desktop or remote-desktop targeting would need a registry-shaped seam instead of one engine.
- **Capture state is per-engine, not durable** — a restart loses the previous tree, so the first capture after a restart is a full tree again. Durably persisted per-app trees are deferred.
