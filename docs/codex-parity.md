# Codex Computer Use parity reference

This reference records the comparison between `@geohotstan/dsh-codex-computer-use` and OpenAI's Codex Computer Use plugin: the observation base, the delivery architecture, and the API-parity table. Every behavior gap catalogued from the pinned observation below is implemented; entries that closed over time left this document. All Codex behavior is stated in dsh's own words; the Codex plugin is proprietary, so none of its text is imported verbatim (see [Licensing stance](#licensing-stance)).

## Observation base

The statements about Codex behavior come from three pinned artifacts, not from disassembly output distributed here:

- The bundled plugin at `~/.codex/plugins/cache/openai-bundled/computer-use/1.0.1000633`: `plugin.json`, `.mcp.json`, the launcher script, and `skills/computer-use/SKILL.md` (the model-facing API and confirmations policy).
- The installed desktop apps the launcher execs: `SkyComputerUseClient` (MCP server, approval UI, recording, presence overlay) and `SkyComputerUseService` (accessibility capture, input synthesis, screenshots, app indexing) under `~/.codex/computer-use/Codex Computer Use.app`.
- Exportable symbol and string tables of both binaries, which name the mechanisms the prose below attributes to them (settle waits, invalidation refetch, denylist entries, private-window detection).

## Delivery architecture

| Piece | Codex | dsh |
|---|---|---|
| Model-facing API | `node_repl` importing `@oai/sky`, whose ten window operations the SKILL.md documents | The `computer_use_*` tools over `ctx.computer` |
| Engine | `SkyComputerUseService` resident process | Resident Swift daemon (`dsh-computer-daemon`) over stdio JSON-RPC |
| Screenshot | ScreenCaptureKit window capture written to a file; the model reads the `file://` URL and emits the image itself | ScreenCaptureKit window capture attached as an image block when the model route carries images |
| App index | Spotlight query over all application bundles, 14-day last-used window | Global Spotlight query over every application bundle, 14-day window |
| External MCP surface | The plugin's own MCP server | `@geohotstan/dsh-codex-computer-use/computer-mcp` stdio server |
| Approval UX | Client-side app picker with session or persistent approval, send-approval for composed messages | `@geohotstan/dsh-codex-computer-use/computer-policy` ask-per-app gate; grants persist through the settings user layer |

## API parity

| Operation | Codex params | dsh tool | Delta |
|---|---|---|---|
| `click` | `app`, `element_index?`, `x?/y?`, `mouse_button?`, `click_count?` | `computer_use_click` | dsh adds `click_method` (auto/accessibility/app_post/sky_click/global) |
| `drag` | `app`, `from_x`, `from_y`, `to_x`, `to_y` | `computer_use_drag` | match |
| `get_app_state` | `app`, `disableDiff?` | `computer_use_get_app_state` | dsh adds `text_limit`, `max_tree_nodes`, `max_tree_depth` |
| `list_apps` | none | `computer_use_list_apps` | dsh adds `order` |
| `perform_secondary_action` | `app`, `element_index`, `action` | `computer_use_perform_secondary_action` | match |
| `press_key` | `app`, `key` | `computer_use_press_key` | dsh additionally returns `selected_text` |
| `scroll` | `app`, `element_index`, `direction`, `pages?` | `computer_use_scroll` | match |
| `select_text` | `app`, `element_index`, `text`, `prefix?`, `suffix?`, `selection_type?` | `computer_use_select_text` | match |
| `set_value` | `app`, `element_index`, `value` | `computer_use_set_value` | match |
| `type_text` | `app`, `text` | `computer_use_type_text` | match |
| — (permissions) | client-driven permission window | `computer_use_request_access` | dsh only |
| — (approval list) | client app picker state | `computer_use_list_granted_applications` | dsh only |
| Action results | `void`; the model calls `get_app_state` next | post-action state in every action result | dsh exceeds |

## Gap catalog

Every gap catalogued from the observation base is closed: capture and timing (settle wait, invalidation refetch, diff markers, cumulative diff, selected-text and per-app notes), safety (denylist and dynamic security-process refusal, private-window and URL policy, organization policy, once/always grants, send approval, confirmations policy, lock-screen pause), presence (action banner, Esc-to-cancel, software cursor), and Record & Replay (`event_stream_start` / `event_stream_status` / `event_stream_stop` over the same seam, tools, and MCP surfaces).

## What dsh already exceeds

These exist in dsh only; parity work must not regress them:

- Every action tool returns the post-action state, while Codex actions return `void` and the model re-fetches.
- Capture controls: `text_limit`, `max_tree_nodes`, `max_tree_depth`, and the `cumulative_diff` baseline switch.
- Click delivery selection: `click_method` with `sky_click`/`app_post` running the stamped background recipe and `global` as the explicit, config-gated foreground escape hatch.
- Permission tools: `computer_use_request_access`, `computer_use_list_granted_applications`.
- Typing robustness: pasteboard strategy with clipboard restore for non-ASCII text and Electron-family apps.
- Screenshots attached directly to tool results as image blocks instead of a `file://` URL the model must read and re-emit.

## Licensing stance

The Codex plugin and its desktop apps are proprietary. Parity work reimplements the behavior catalogued here; it never imports Codex text, icons, or code. The SkyLight background-delivery bridge ports its mechanism from the MIT-licensed [trycua/cua](https://github.com/trycua/cua) project (`libs/cua-driver/rust/crates/platform-macos/src/input/`), which reimplements the same private-API recipe permissively; the port carries the MIT attribution in `native/Sources/dsh-computer-daemon/SkyLight.swift` and `FocusStealPreventer.swift`. Model-facing prose — the skill, tier guidance, and any future confirmations policy — is written by dsh and expresses the same rules, not the same words.
