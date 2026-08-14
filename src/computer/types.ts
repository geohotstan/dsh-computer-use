/**
 * Request and result types for the desktop computer-use seam (`ctx.computer`).
 * One engine drives one local desktop: it lists installed and running apps,
 * captures an app's key window as a screenshot plus a model-readable
 * accessibility tree, and synthesizes mouse and keyboard input into that app.
 * The request vocabulary follows the accessibility-tree-first design of
 * OpenAI's Codex Computer Use window API: element indexes address controls
 * from the latest captured tree, and window-relative coordinates are the
 * fallback for elements the tree cannot address.
 * @module @geohotstan/dsh-codex-computer-use/computer/types
 */

/** Mouse buttons accepted by click input. Long and single-letter spellings both denote one button. */
export type ComputerMouseButton = 'left' | 'right' | 'middle' | 'l' | 'r' | 'm'

/** Scroll directions accepted by scroll input. Long and single-letter spellings both denote one direction. */
export type ComputerDirection = 'up' | 'down' | 'left' | 'right' | 'u' | 'd' | 'l' | 'r'

/** Where a text selection lands relative to the matched text. */
export type ComputerSelectTextSelectionType = 'text' | 'cursor_before' | 'cursor_after'

/** App-listing sort order. */
export type ComputerAppOrder = 'usage' | 'display-name'

/**
 * Click delivery paths (the official `click_method` vocabulary): `auto` picks
 * the first path that works; `accessibility` presses the element's own AX
 * action; `app_post` and `sky_click` run the stamped background recipe
 * (SkyLight direct delivery with the public per-process fallback, no
 * activation); `global` takes the full foreground path and may move the real
 * pointer.
 */
export type ComputerClickMethod = 'auto' | 'accessibility' | 'app_post' | 'sky_click' | 'global'

/**
 * One canonical app identity for targeting. Providers accept any identifier
 * their platform can resolve — bundle id, display name, full app path, or
 * process name — and return the canonical form in results.
 */
export interface ComputerApp {
  /** Canonical app id (bundle id on macOS). */
  id: string
  /** User-visible app name when available. */
  displayName?: string
  /** Whether the app currently appears to be running. */
  isRunning?: boolean
  /** ISO 8601 timestamp for recent app usage when available. */
  lastUsedDate?: string
  /** Usage-count signal when available. */
  useCount?: number
}

/**
 * A JPEG window screenshot captured with an app state. The encoded bytes
 * cross the seam in-process; the wire boundary between a provider and its
 * native helper is that provider's own contract.
 */
export interface ComputerScreenshot {
  /** Encoded JPEG bytes. */
  data: Buffer
  /** Always `image/jpeg` — the only capture encoding this seam produces. */
  mediaType: 'image/jpeg'
  /** Width in logical pixels. */
  width: number
  /** Height in logical pixels. */
  height: number
}

/**
 * The captured state of an app's key window: the model-facing accessibility
 * text plus the window screenshot. `text` is the full serialized tree on the
 * first capture for an app and a diff of that tree on later captures, with
 * the kind announced by the diff marker lines the provider prepends (the
 * Codex `get_app_state` format). `truncated` is true when the provider dropped
 * the tail at its byte bound and appended the truncation mark — the text is
 * then incomplete, never silently complete. `screenshot` is null when the
 * provider could not capture one; the text remains usable without it.
 */
export interface ComputerAppState {
  /** Canonical app identifier the state was captured for. */
  app: string
  /** Model-facing accessibility text: full tree or a marked diff. */
  text: string
  /** Whether the provider dropped the tail of `text` at its byte bound. */
  truncated: boolean
  /** Window screenshot, or null when capture failed or was refused. */
  screenshot: ComputerScreenshot | null
}

/**
 * The grant state of the permissions computer use needs, reported by
 * `permissionStatus` and `requestPermissions`. The exact permission set is
 * provider-defined (TCC grants on macOS); `bundled` reports whether the
 * provider's helper carries the identity that makes prompts attribute to it.
 */
/**
 * One Record & Replay recording's status: whether a recording is active,
 * its timeline, and — for a finished recording — the journal file path and
 * the recorded event count. The provider caps recordings at
 * `maxDurationSec` and writes one JSON journal (metadata plus events) on
 * stop.
 */
export interface ComputerRecordStatus {
  /** Whether a recording is active right now. */
  recording: boolean
  /** Epoch seconds the active (or most recent) recording started at. */
  startTime?: number
  /** Elapsed seconds of the active recording. */
  elapsedSec?: number
  /** The recording cap in seconds (30 minutes). */
  maxDurationSec: number
  /** Journal file path of the most recent finished recording. */
  path?: string
  /** Recorded event count of the active recording. */
  eventCount?: number
}

export interface ComputerPermissionStatus {
  /** Whether the primary control permission is active. */
  accessibility: boolean
  /** Whether the screen-capture permission is active. */
  screenRecording: boolean
  /** Whether the provider helper runs from its own signed identity. */
  bundled: boolean
}

/** Common optional fields of every computer-use request. */
export interface ComputerRequestBase {
  /** Abort signal — providers stop in-flight work when it fires. */
  signal?: AbortSignal
  /** Timeout override in milliseconds (providers cap it). */
  timeoutMs?: number
}

/** A request whose defaults and caps the engine applied in {@link ComputerEngine.resolve}. */
export interface ComputerExecSpec<T extends ComputerRequestBase> {
  /** The caller's request, carried through unchanged. */
  request: T
  /** The effective per-request timeout after defaulting and capping. */
  timeoutMs: number
  /** The caller's abort signal, when one was supplied. */
  signal?: AbortSignal
}

/** List the apps the engine can target, optionally ordered. */
export interface ListAppsRequest extends ComputerRequestBase {
  /** Sort order; providers default to their most useful ordering. */
  order?: ComputerAppOrder
}

/**
 * Capture an app's key window. Callers invoke this before any interaction
 * with the app, once per assistant turn: subsequent input actions address
 * element indexes and coordinates from this capture.
 */
export interface GetAppStateRequest extends ComputerRequestBase {
  /** App identifier: bundle id, display name, full app path, or process name. */
  app: string
  /** Return the full accessibility tree instead of a diff from the previous tree. */
  disableDiff?: boolean
  /**
   * Diff against the app's initial capture instead of the previous one (a
   * dsh extension mirroring the official cumulative diff; default false).
   */
  cumulativeDiff?: boolean
  /** Maximum text characters to return; `'max'` returns the full text (default 500). */
  textLimit?: number | 'max'
  /** Maximum accessibility-tree nodes to render (default 1200). */
  maxTreeNodes?: number
  /** Maximum accessibility-tree depth to render (default 64). */
  maxTreeDepth?: number
}

/** Click an element from the latest app state, or a window-relative coordinate. */
export interface ClickRequest extends ComputerRequestBase {
  /** App identifier the click targets. */
  app: string
  /** Element index from the latest `get_app_state` tree. Mutually exclusive with {@link x}/{@link y}. */
  elementIndex?: number
  /** Window-relative X coordinate; requires {@link y}. */
  x?: number
  /** Window-relative Y coordinate; requires {@link x}. */
  y?: number
  /** Number of clicks to perform (default 1). */
  clickCount?: number
  /** Mouse button to click (default left). */
  mouseButton?: ComputerMouseButton
  /** Delivery path for the click (default `auto`); `accessibility` requires {@link elementIndex}. */
  clickMethod?: ComputerClickMethod
}

/** Type text into the current focus of the targeted app. */
export interface TypeTextRequest extends ComputerRequestBase {
  /** App identifier to type into. */
  app: string
  /** Literal text to type. */
  text: string
}

/** Press a key or `+`-separated keyboard chord in the targeted app. */
export interface PressKeyRequest extends ComputerRequestBase {
  /** App identifier the key press targets. */
  app: string
  /**
   * Key or `+`-separated chord using X Window System keysym-style names, such
   * as `a`, `space`, `Return`, `Tab`, `Control_L+a`, or `Super_L+d`; whitespace
   * around `+` is ignored and common aliases such as `Control`, `Ctrl`, `Alt`,
   * and `Shift` are accepted.
   */
  key: string
}

/** Scroll an indexed element of the targeted app. */
export interface ScrollRequest extends ComputerRequestBase {
  /** App identifier to scroll in. */
  app: string
  /** Element index from the latest `get_app_state` tree. */
  elementIndex: number
  /** Direction to scroll. */
  direction: ComputerDirection
  /** Number of pages to scroll; fractional pages are allowed (default 1). */
  pages?: number
}

/** Replace the value of an indexed editable element without keystroke synthesis. */
export interface SetValueRequest extends ComputerRequestBase {
  /** App identifier containing the editable element. */
  app: string
  /** Element index from the latest `get_app_state` tree. */
  elementIndex: number
  /** Replacement value for the editable element. */
  value: string
}

/** Locate text in an indexed editable element and select it or move the cursor beside it. */
export interface SelectTextRequest extends ComputerRequestBase {
  /** App identifier containing the editable element. */
  app: string
  /** Element index from the latest `get_app_state` tree. */
  elementIndex: number
  /** Text to locate within the editable element. */
  text: string
  /** Optional text immediately before the target to disambiguate matches. */
  prefix?: string
  /** Optional text immediately after the target to disambiguate matches. */
  suffix?: string
  /** Select the text itself, or place the cursor before or after it (default `text`). */
  selectionType?: ComputerSelectTextSelectionType
}

/** Drag between two window-relative coordinates in the targeted app. */
export interface DragRequest extends ComputerRequestBase {
  /** App identifier to drag in. */
  app: string
  /** Starting window-relative X coordinate. */
  fromX: number
  /** Starting window-relative Y coordinate. */
  fromY: number
  /** Ending window-relative X coordinate. */
  toX: number
  /** Ending window-relative Y coordinate. */
  toY: number
}

/** Invoke a named secondary accessibility action on an indexed element. */
export interface PerformSecondaryActionRequest extends ComputerRequestBase {
  /** App identifier containing the element. */
  app: string
  /** Element index from the latest `get_app_state` tree. */
  elementIndex: number
  /** Action label from the tree, such as `Raise`, `Scroll Down`, `Expand`, or `Collapse`; matching is case-insensitive. */
  action: string
}
