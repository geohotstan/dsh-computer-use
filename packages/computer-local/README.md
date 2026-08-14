# dsh-computer-local

English | [中文](README.zh.md)

Local Service Provider for the computer-use seam: `LocalComputerEngine` drives a resident macOS helper daemon (`dsh-computer-daemon`, Swift sources in [`native/`](native/)) over newline-delimited JSON-RPC 2.0 on the spawned process's pipes. The daemon owns the capture session — per-app accessibility trees, diffs, retained element indexes — while the engine owns daemon lifetime: eager start at load so its TCC preflight runs during startup, restart after a crash, tree-scoped termination at disposal through the harness subprocess seam.

## What the daemon does

Built with `pnpm run build:native`, which compiles `native/` with `swift build -c release` and then bundles the binary into the signed app at `native/.build/dsh-computer-daemon.app` (`native/scripts/bundle.sh` owns the layout and signing). `helperPath` must point at the executable inside that bundle — `native/.build/dsh-computer-daemon.app/Contents/MacOS/dsh-computer-daemon` — whose bundle identity is what makes macOS attribute the TCC prompts to the helper. It prefers public macOS APIs (Accessibility, ScreenCaptureKit, CGEvent) and adds a private SkyLight fast path for background input delivery, resolved dynamically with a public fallback per symbol:

- App listing: `NSWorkspace` running apps merged with Spotlight-installed bundles.
- Capture: the macOS Accessibility (AX) tree serialized into the numbered, tab-indented, trait-annotated element-index format, plus a `ScreenCaptureKit` window screenshot (JPEG) with a brief highlight overlay. Consecutive captures return the diff marker lines.
- Input: background-first delivery (the Codex execution model) — semantic operations ride the element's own AX actions (`AXPress`, page scrolls, value/selection writes) and need no focus at all; raw mouse/keyboard events (coordinate clicks, typing, chords, drags, the wheel) are posted directly into the target app's process through the private SkyLight path (`SLEventPostToPid` with the keyboard authentication envelope, Chromium window-routing field stamps, and the focus-without-raise record post, ported from the MIT-licensed trycua/cua project), falling back to the public `CGEvent.postToPid` per symbol — no activation, no raise, the user's foreground never changes, and the real cursor never moves. Left clicks additionally run the stamped recipe: a mouseMoved primer, Chromium's off-screen (-1,-1) primer click, and the target pairs under one click-group id. Text goes per-scalar unicode, or pasteboard-and-paste (⌘V, clipboard saved and restored) for non-ASCII and Electron-family apps; the paste chord rides the no-envelope path so NSMenu dispatch sees it. Apps that reject background delivery must be pinned via `foregroundApps` to the full foreground path (raise + activate + global event tap) — that path is never entered automatically. App launches are background launches (`activates: false`), and dedicated browser launches suppress the Chromium self-activation flash.

The daemon requires the macOS **Accessibility** and **Screen Recording** TCC grants. At load it prompts for any missing grant through the macOS dialog and, when macOS has already remembered a denial, opens the matching System Settings pane so the user never navigates Settings manually. The engine refuses to activate while a grant is still missing — the `[Service.init]` preflight throws, which unloads `ctx.computer` and leaves the `computer_use_*` tools unregistered. It also exposes `permissionStatus()` (the daemon's `permission_status` method).

## Config

| Field | Default | Purpose |
|---|---|---|
| `helperPath` | (required) | Absolute path to the daemon executable inside the bundled `.app`; `DSH_COMPUTER_HELPER_PATH` is the environment override. Missing at load fails loud. |
| `helperArgs` | `[]` | Extra argv entries appended after the daemon path. |
| `timeoutMs` | `15_000` | Default per-request timeout. |
| `maxTimeoutMs` | `120_000` | Cap for per-request timeout overrides. |
| `maxTreeBytes` | `256_000` | Byte bound for every captured tree text; overflow truncates with the completeness mark. |
| `maxScreenshotBytes` | `2_097_152` | Byte bound for every screenshot; a larger capture fails the request. |
| `graceMs` | `3_000` | Daemon termination grace period. |
| `foregroundApps` | `[]` | Canonical app ids that must receive input through the foreground path (raised window, global event tap) because they reject background delivery; unlisted apps get SkyLight background delivery with the public fallback, and the foreground path is never entered automatically. |
| `browserIsolation` | `false` | Isolate browser targets from the user's browser: when true, Chromium-family browsers launch in a fresh instance with their own temporary user-data directory instead of driving the user's logged-in profile (Safari cannot be isolated). |
| `browserUrlAllow` | `[]` | URL prefixes (scheme, optionally with host and port) the browser may be driven on. Absent, every URL is allowed except `browserUrlDeny`; present, a URL must start with one of the prefixes or the capture fails with the browser-URL denial. |
| `browserUrlDeny` | `[]` | URL prefixes always refused, even when `browserUrlAllow` matches. |
| `deniedApps` | `[]` | Canonical app ids blocked outright with the organization-policy denial; captures and actions against them fail. |

The config registers a settings section under the seam's `computer` namespace, so every field is user-overridable at runtime.

## Lifecycle and failure behavior

- One resident daemon per engine, shared by concurrent requests; a per-request fused deadline rejects with `timed out after <ms>` or `aborted`, classified by first cause.
- A crashed daemon rejects its in-flight calls with `daemon exited unexpectedly` plus the retained stderr tail, and the next request spawns a fresh daemon.
- Wire payloads are validated field by field at the boundary; malformed daemon output fails the connection loud instead of timing out silently.

## Model Experience

Indirectly, through the model-facing tools of `dsh-computer-tools`; the provider backend registers no prompt, schema, or result of its own.

#### KV Cache effect

No direct effect: provider-owned capture text and screenshots reach the model only through the consumer's rendered results.

## Known Limitations and Deferred Work

- **macOS only** — the engine rejects non-darwin hosts at load; the daemon targets macOS 14+ (arm64/x64).
- **Native build requirement** — the daemon is built and bundled from `native/` sources; no prebuilt artifact is published. Package installation does not run `swift build` or the bundling step.
- **TCC grant persistence** — macOS keys each grant on the bundle id, code signature, and on-disk path. Rebuilds with the default ad-hoc signature (or a moved checkout) reset the grants; sign with a stable identity (`DSH_COMPUTER_SIGN_IDENTITY`) and keep the checkout path fixed to avoid re-prompting.
- **Background delivery is app-dependent** — apps that ignore directly-posted events need `foregroundApps`; background delivery now uses the private SkyLight path (with the public per-process fallback per symbol), which depends on private APIs that can change across macOS releases — a missing symbol degrades to the public path instead of failing.
- **One window per app** — capture targets one window and stays anchored to the retained window while it exists, so concurrent human use of the same app does not re-target the session; multi-window targeting and per-window identifiers are deferred (the Codex `window2` API is the reference design).
- **Usage metadata** — `listApps` reads Spotlight `kMDItemUseCount`/`kMDItemLastUsedDate` through `MDItem`; apps without indexed usage still appear while running, and the fields stay optional on the seam.
- **Locked screen** — captures and actions wait out the lock screen (bounded at 30 s each) before proceeding, with no visible overlay; the Codex overlay presentation is not replicated.
