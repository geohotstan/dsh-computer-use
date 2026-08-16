# @zibokapi/dsh-codex-computer-use

English | [中文](README.zh.md)

A standalone plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): desktop computer use on macOS — app listing, key-window capture as a screenshot plus model-readable accessibility tree, and synthesized mouse and keyboard input — cloned from OpenAI's Codex Computer Use window API. Input delivery is background-first like Codex's own execution model: semantic AX actions need no focus, and raw events ride the private SkyLight path (`SLEventPostToPid` with the keyboard authentication envelope, field stamps, and focus-without-raise records, ported from the MIT-licensed [trycua/cua](https://github.com/trycua/cua) project) with a public `CGEvent.postToPid` fallback per symbol, so the user's foreground never changes. It needs no OpenAI components.

The design is accessibility-tree-first: `computer_use_get_app_state` returns a numbered, tab-indented element tree; the model acts on element indexes, with window-relative coordinates as a fallback, and later captures of the same app return diffs instead of the full tree.

Everything ships in this one package: the seam, the local Swift-daemon provider, the `computer_use_*` tools, the approval policy, and a standalone MCP server. The complete feature delta against OpenAI's implementation lives in [docs/codex-parity.md](docs/codex-parity.md); that reference is the parity checklist.

## Install

This repository is a DSH bundle: the root `package.json` declares `dsh.bundle.patch` → [`cordis.patch.yml`](cordis.patch.yml), which inserts the three host rows under this package's own subpaths (`@zibokapi/dsh-codex-computer-use/*`). One install brings everything.

```sh
# 1. install the plugin into a profile
dsh plugin --profile <name> add @zibokapi/dsh-codex-computer-use

# 2. build the macOS daemon and grant it permissions (once per machine)
npx @zibokapi/dsh-codex-computer-use

# 3. (re)start the profile — the computer_use_* tools are live
dsh --profile <name> web
```

Step 2 is the only macOS-specific part. It builds the Swift helper from the `native/` directory shipped inside the installed package (Xcode Command Line Tools required — `xcode-select --install`), bundles and signs it into `~/.dsh/computer-use/dsh-computer-daemon.app`, then explicitly asks for the two permissions the daemon needs — **Accessibility** and **Screen Recording** — through the macOS system dialogs, polling until the grants land. It writes no configuration and none is needed: with `helperPath` unset, the engine falls back to that exact path.

The install location is stable on purpose. macOS TCC keys each grant on the helper's bundle id, code signature, and on-disk path; a path inside `node_modules` would change with every plugin update, so the daemon lives under the DSH home (`$DSH_HOME/computer-use`) and the grants survive plugin updates.

dsh re-asks for the grants whenever the plugin loads: a missing or revoked grant simply means computer use is not loaded until it is granted (the daemon opens the matching System Settings pane on a remembered denial). `dsh-codex-computer-use status` reports the install at any time.

The registry tarball ships `lib/`, and `lib/` is committed to git, so every install form — npm, a git URL, a packed tarball — works without running any build script (`pnpm` ≥10 blocks lifecycle scripts of git-hosted dependencies by default, so the built entries ship in the repository itself).

### Lazy path

Tell your dsh:

```
Install this plugin package: https://github.com/geohotstan/dsh-computer-use
```

then run steps 2–3 above (`npx @zibokapi/dsh-codex-computer-use`, restart the profile).

### Manual (from a checkout)

```sh
git clone https://github.com/geohotstan/dsh-computer-use
cd dsh-computer-use
pnpm install
pnpm exec dsh-codex-computer-use   # build + install the daemon, ask for permissions
pnpm run build:native              # optional: a Developer ID / self-signed build, see Permissions
cd <where you run dsh>
dsh plugin --profile <name> add ../dsh-computer-use
```

`dsh plugin add` registers the repo as a bundle layer in the profile (`dsh.profile.bundles`). The engine resolves the daemon in order: the `helperPath` config → the `DSH_COMPUTER_HELPER_PATH` environment override → the setup CLI's install location (`~/.dsh/computer-use/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon`). Set `helperPath` only to point at a custom build.

## Entries

One package, five subpath entries (plus the invariant companions under `./<entry>/invariant`):

| Entry | Role | Loader row |
|---|---|---|
| [`./computer`](docs/computer.md) | Service Definition — `ctx.computer` | registered by `computer-local` |
| [`./computer-local`](docs/computer-local.md) | Local provider — resident Swift daemon (AX tree, screenshots, CGEvent input) | `@zibokapi/dsh-codex-computer-use/computer-local` |
| [`./computer-tools`](docs/computer-tools.md) | The `computer_use_*` tools plus the `computer-use` skill | `@zibokapi/dsh-codex-computer-use/computer-tools` |
| [`./computer-policy`](docs/computer-policy.md) | Per-app approval gate + Codex-style tier guidance + `computer_use_list_granted_applications` | `@zibokapi/dsh-codex-computer-use/computer-policy` |
| [`./computer-mcp`](docs/computer-mcp.md) | Standalone MCP stdio server exposing the same surface for external MCP clients | not a loader row — a binary |

## Compose

Authoring a composition by hand uses the same subpaths:

```yaml
plugins:
  computer-engine:
    plugin: '@zibokapi/dsh-codex-computer-use/computer-local'
  computer-tools:
    plugin: '@zibokapi/dsh-codex-computer-use/computer-tools'
  computer-policy:
    plugin: '@zibokapi/dsh-codex-computer-use/computer-policy'
```

`helperPath` is optional — the engine falls back to the setup CLI's install location — and the other rows are optional too (`@zibokapi/dsh-codex-computer-use/computer-policy` needs an approval service mounted, e.g. `@deepseek-ai/dsh-user-approval`). A runnable composition lives in [`example/cordis.yml`](example/cordis.yml).

## MCP server

The `@zibokapi/dsh-codex-computer-use/computer-mcp` bin exposes the same surface — the official ten Codex Computer Use window tools plus `request_access` and the three `event_stream_*` recording tools — as a standalone MCP stdio server over the same engine, so Codex CLI, Claude Code, or any MCP client can drive the harness's computer use. The bin keeps the harness packages external like every other entry (`@deepseek-ai/dsh-subprocess-local` ships node-pty, a native module that cannot be bundled), so it runs wherever `pnpm install` has materialized the dependencies:

```sh
# after `npx @zibokapi/dsh-codex-computer-use` the daemon needs no path:
node lib/mcp.js
# an explicit path (first argument) or the environment override also work:
node lib/mcp.js /absolute/path/to/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon
DSH_COMPUTER_HELPER_PATH=/absolute/path/to/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon dsh-computer-mcp
```

The server speaks newline-delimited JSON-RPC 2.0 on stdin/stdout, answers `initialize` / `ping` / `tools/list` / `tools/call`, and mirrors the official response behavior: action tools answer with the post-action state (text plus a JPEG image block when one was captured).

## Permissions

The daemon needs two macOS grants, checked and requested at startup: **Accessibility** (tree reading and input targeting) and **Screen Recording** (window screenshots). Both are TCC permissions; the plugin never bypasses them. The setup command (`npx @zibokapi/dsh-codex-computer-use`) asks for both up front, and every plugin load re-checks: it prompts for any missing grant and opens the matching System Settings pane when macOS has already remembered a denial; while a grant is missing the plugin refuses to activate, so computer use is simply not loaded.

macOS keys each grant on the helper's bundle id, code signature, and on-disk path. The setup command installs to one fixed path (`~/.dsh/computer-use`) so grants persist; sign with a stable identity so they also survive rebuilds. Any code-signing certificate whose designated requirement is identifier-plus-certificate works — including a self-signed one created with Keychain Access (Certificate Assistant → Create a Certificate → Code Signing). Set it once:

```sh
DSH_COMPUTER_SIGN_IDENTITY="<certificate common name>" npx @zibokapi/dsh-codex-computer-use
```

The default ad-hoc signature works, but its designated requirement is the binary's cdhash, so macOS forgets the grants on every rebuild.

## Develop

```sh
pnpm install
pnpm test          # fake-daemon tests; nothing touches a live desktop
pnpm run typecheck
pnpm run build     # esbuild → lib/, tsc → lib/types
```

## Verification

- CI `check` job (Ubuntu): a clean `pnpm install` from npm — the user-facing path — then typecheck and build against the published `@deepseek-ai/*` packages.
- CI `native` job (macOS): builds and unit-tests the Swift helper daemon, runs the Node test suite — the engine is macOS-only by design (it throws a platform gate on non-darwin hosts), so the tests that boot it live here and drive a fake daemon, touching no live desktop — and exercises the setup CLI end to end (build, bundle, sign, install, status).
- CI `install` job (Ubuntu): runs the documented chains against the real CLI — `dsh plugin --profile ci add` from the checkout path, a packed tarball, and a git URL — asserts the setup binary's non-macOS guidance, then composes the profile and asserts the bundle layer registered, the three rows composed, and every `@zibokapi/dsh-codex-computer-use/*` row resolves and loads through the installed package.

## License

MIT — see [LICENSE](LICENSE).
