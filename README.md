# dsh-computer-use

English | [中文](README.zh.md)

A standalone plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): desktop computer use on macOS — app listing, key-window capture as a screenshot plus model-readable accessibility tree, and synthesized mouse and keyboard input — cloned from OpenAI's Codex Computer Use window API. Input delivery is background-first like Codex's own execution model: semantic AX actions need no focus, and raw events ride the private SkyLight path (`SLEventPostToPid` with the keyboard authentication envelope, field stamps, and focus-without-raise records, ported from the MIT-licensed [trycua/cua](https://github.com/trycua/cua) project) with a public `CGEvent.postToPid` fallback per symbol, so the user's foreground never changes. It needs no OpenAI components.

The design is accessibility-tree-first: `computer_use_get_app_state` returns a numbered, tab-indented element tree; the model acts on element indexes, with window-relative coordinates as a fallback, and later captures of the same app return diffs instead of the full tree.

The complete feature delta against OpenAI's implementation lives in [docs/codex-parity.md](docs/codex-parity.md); that reference is the parity checklist.

## Packages

| Package | Role | Loader row |
|---|---|---|
| [`dsh-computer`](packages/computer/README.md) | Service Definition — `ctx.computer` | `computer-local` registers it |
| [`dsh-computer-local`](packages/computer-local/README.md) | Local provider — resident Swift daemon (AX tree, screenshots, CGEvent input) | `plugin: dsh-computer-local` |
| [`dsh-computer-tools`](packages/computer-tools/README.md) | The `computer_use_*` tools plus the `computer-use` skill | `plugin: dsh-computer-tools` |
| [`dsh-computer-policy`](packages/computer-policy/README.md) | Per-app approval gate + Codex-style tier guidance + `computer_use_list_granted_applications` | `plugin: dsh-computer-policy` |
| [`dsh-computer-mcp`](packages/computer-mcp/README.md) | Standalone MCP stdio server exposing the same surface for external MCP clients | not a loader row — a binary |

## Install

The plugin depends on the published harness packages (`@deepseek-ai/dsh-*`, `@deepseek-ai/cordis`, `@deepseek-ai/schemastery`). Publish the four packages (or install them from a checkout that joins this folder as an extra workspace), then:

```sh
pnpm add dsh-computer-local dsh-computer-tools dsh-computer-policy
```

Build the native helper (once per release; Xcode command-line tools required). This builds the Swift binary **and** bundles it into a signed `.app`, which is what makes macOS attribute the TCC permission prompts to the helper instead of the terminal hosting the harness:

```sh
pnpm run build:native
# helper: packages/computer-local/native/.build/dsh-computer-daemon.app
```

`helperPath` must point at the executable **inside** the bundle: `packages/computer-local/native/.build/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon`.

## Compose

Add the rows to a harness composition (`cordis.yml` or a profile patch). `helperPath` must point at the bundled daemon executable; the other rows are optional (`dsh-computer-policy` needs an approval service mounted, e.g. `@deepseek-ai/dsh-user-approval`).

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

A runnable composition lives in [`example/cordis.yml`](example/cordis.yml).

## MCP server

`dsh-computer-mcp` exposes the same surface — the official ten Codex Computer Use window tools plus `request_access` and the three `event_stream_*` recording tools — as a standalone MCP stdio server over the same engine, so Codex CLI, Claude Code, or any MCP client can drive the harness's computer use:

```sh
# from this checkout, after `pnpm run build`
node packages/computer-mcp/lib/mcp.js /absolute/path/to/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon
# or with the environment override
DSH_COMPUTER_HELPER_PATH=/absolute/path/to/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon dsh-computer-mcp
```

The server speaks newline-delimited JSON-RPC 2.0 on stdin/stdout, answers `initialize` / `ping` / `tools/list` / `tools/call`, and mirrors the official response behavior: action tools answer with the post-action state (text plus a JPEG image block when one was captured).

## Permissions

The daemon needs two macOS grants, checked and requested at startup: **Accessibility** (tree reading and input targeting) and **Screen Recording** (window screenshots). Both are TCC permissions; the plugin never bypasses them. At load it prompts for any missing grant and opens the matching System Settings pane when macOS has already remembered a denial; while a grant is missing the plugin refuses to activate, so computer use is simply not loaded.

macOS keys each grant on the helper's bundle id, code signature, and on-disk path. Keep the checkout at a fixed path, and sign with a stable identity so grants survive rebuilds. Any code-signing certificate whose designated requirement is identifier-plus-certificate works — including a self-signed one created with Keychain Access (Certificate Assistant → Create a Certificate → Code Signing). Set it once:

```sh
DSH_COMPUTER_SIGN_IDENTITY="<certificate common name>" pnpm run build:native
```

The default ad-hoc signature works, but its designated requirement is the binary's cdhash, so macOS forgets the grants on every rebuild.

## Develop

```sh
pnpm install
pnpm test          # fake-daemon tests; nothing touches a live desktop
pnpm run typecheck
pnpm run build     # emits lib/ for all four packages
```

## License

MIT — see [LICENSE](LICENSE).
