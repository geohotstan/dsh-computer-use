/**
 * Service Definition for the `ctx.computer` capability seam: one engine
 * drives one local desktop — listing targetable apps, capturing an app's key
 * window as a screenshot plus model-readable accessibility tree, and
 * synthesizing mouse and keyboard input into that app. The seam is stateful
 * by design: consecutive captures of one app return diffs of the previous
 * tree, so providers keep a resident capture session (the Codex Computer Use
 * two-process layout: a resident service behind a short-lived frontend).
 * Execution policy and model-facing rendering belong to consumers.
 * @module dsh-computer
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {
  ClickRequest,
  ComputerApp,
  ComputerAppState,
  ComputerExecSpec,
  ComputerPermissionStatus,
  ComputerRecordStatus,
  ComputerRequestBase,
  DragRequest,
  GetAppStateRequest,
  ListAppsRequest,
  PerformSecondaryActionRequest,
  PressKeyRequest,
  ScrollRequest,
  SelectTextRequest,
  SetValueRequest,
  TypeTextRequest,
} from './types.ts'

/**
 * Settings namespace of this capability, owned here rather than by a provider
 * because it names the capability, not an implementation: a host composes
 * exactly one provider of `ctx.computer` (mounting two fails loud on the
 * duplicate service registration), and a settings document carried between
 * machines keeps resolving under the one name.
 */
export const COMPUTER_SETTINGS_NAMESPACE = settingsNamespace('computer')

export type {
  ClickRequest,
  ComputerApp,
  ComputerAppOrder,
  ComputerAppState,
  ComputerClickMethod,
  ComputerDirection,
  ComputerExecSpec,
  ComputerMouseButton,
  ComputerPermissionStatus,
  ComputerRecordStatus,
  ComputerRequestBase,
  ComputerScreenshot,
  ComputerSelectTextSelectionType,
  DragRequest,
  GetAppStateRequest,
  ListAppsRequest,
  PerformSecondaryActionRequest,
  PressKeyRequest,
  ScrollRequest,
  SelectTextRequest,
  SetValueRequest,
  TypeTextRequest,
} from './types.ts'
export {
  TREE_TRUNCATED_MARK,
  assertActionRequest,
  assertClickAddressing,
  formatAppStateEnvelope,
  listAppsText,
  normalizeDirection,
  normalizeMouseButton,
  truncateTreeChars,
  truncateTreeText,
} from './render.ts'
export type { ActionRequest, NormalizedDirection, NormalizedMouseButton } from './render.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    computer: ComputerEngine
  }
}

/**
 * Abstract desktop computer-use engine. Subclass, implement the abstract
 * methods, and load the subclass as a plugin — it registers as
 * `ctx.computer` (one implementation per context; loading a second throws,
 * which is cordis' standard duplicate-service behavior).
 *
 * Implementations must honor these semantics:
 * - Every method rejects only for infrastructure, protocol, or policy
 *   failures; a completed input action resolves with no value except
 *   `pressKey`, which resolves with the target app's selected text.
 * - `getAppState` captures the targeted app's key window. The first capture
 *   for an app returns the full serialized accessibility tree; later captures
 *   return a diff of the previous tree unless the caller disables diffing.
 * - Input actions resolve the `app` identifier the same way captures do, so
 *   an action follows the capture session of its app.
 * - `resolve` is the single defaulting and capping step: methods receive an
 *   explicit {@link ComputerExecSpec} and never re-default its fields.
 * - A provider's resident capture session is provider-owned state: disposing
 *   the engine ends the session and releases platform resources.
 */
export abstract class ComputerEngine extends Service {
  constructor(ctx: Context) {
    super(ctx, 'computer')
  }

  /**
   * Apply implementation-owned defaults and caps to a request before execution.
   * @param request - the caller's request; the timeout field gets the
   *   implementation's default and cap, all other fields carry through.
   * @returns the fully-specified spec to hand to the operation methods.
   */
  abstract resolve<T extends ComputerRequestBase>(request: T): ComputerExecSpec<T>

  /**
   * List the apps this engine can target.
   * @param spec - a resolved spec from {@link resolve}.
   * @returns the canonical app entries, ordered per the request.
   */
  abstract listApps(spec: ComputerExecSpec<ListAppsRequest>): Promise<ComputerApp[]>

  /**
   * Capture the targeted app's key window: screenshot plus accessibility text.
   * Callers invoke this once per assistant turn before interacting with the
   * app; later input actions address element indexes from this capture.
   * @param spec - a resolved spec carrying the app identifier.
   * @returns the captured state; the screenshot is null when capture failed.
   */
  abstract getAppState(spec: ComputerExecSpec<GetAppStateRequest>): Promise<ComputerAppState>

  /**
   * Click an indexed element from the latest capture or a window-relative
   * coordinate in the targeted app.
   * @param spec - a resolved spec carrying exactly one addressing mode.
   * @returns completion after the click was synthesized.
   */
  abstract click(spec: ComputerExecSpec<ClickRequest>): Promise<void>

  /**
   * Type literal text into the targeted app's current focus.
   * @param spec - a resolved spec carrying the text.
   * @returns completion after the text was synthesized.
   */
  abstract typeText(spec: ComputerExecSpec<TypeTextRequest>): Promise<void>

  /**
   * Press a key or `+`-separated chord in the targeted app.
   * @param spec - a resolved spec carrying the keysym-style chord.
   * @returns the targeted app's selected text after the press (the official
   *   `Selected text:` signal, '' when nothing is selected).
   */
  abstract pressKey(spec: ComputerExecSpec<PressKeyRequest>): Promise<string>

  /**
   * Scroll an indexed element of the targeted app.
   * @param spec - a resolved spec carrying the element and direction.
   * @returns completion after the scroll was synthesized.
   */
  abstract scroll(spec: ComputerExecSpec<ScrollRequest>): Promise<void>

  /**
   * Replace the value of an indexed editable element directly, without
   * keystroke synthesis.
   * @param spec - a resolved spec carrying the element index and value.
   * @returns completion after the value was applied.
   */
  abstract setValue(spec: ComputerExecSpec<SetValueRequest>): Promise<void>

  /**
   * Locate text in an indexed editable element and select it or place the
   * cursor beside it.
   * @param spec - a resolved spec carrying the element and match.
   * @returns completion after the selection was applied.
   */
  abstract selectText(spec: ComputerExecSpec<SelectTextRequest>): Promise<void>

  /**
   * Drag between two window-relative coordinates in the targeted app.
   * @param spec - a resolved spec carrying both endpoints.
   * @returns completion after the drag was synthesized.
   */
  abstract drag(spec: ComputerExecSpec<DragRequest>): Promise<void>

  /**
   * Invoke a named secondary accessibility action on an indexed element.
   * @param spec - a resolved spec carrying the element and action label.
   * @returns completion after the action was performed.
   */
  abstract performSecondaryAction(spec: ComputerExecSpec<PerformSecondaryActionRequest>): Promise<void>

  /**
   * Read the current grant state of the permissions computer use needs,
   * without prompting the user.
   */
  abstract permissionStatus(): Promise<ComputerPermissionStatus>

  /**
   * Request the permissions computer use needs — prompting the user through
   * the system dialogs — and report the resulting grant state.
   */
  abstract requestPermissions(): Promise<ComputerPermissionStatus>

  /** Start recording the user's actions; an active recording returns its live status. */
  abstract recordStart(): Promise<ComputerRecordStatus>

  /** The active recording's status, or the most recent finished recording's summary. */
  abstract recordStatus(): Promise<ComputerRecordStatus>

  /** Stop the active recording, write its journal file, and return its summary. */
  abstract recordStop(): Promise<ComputerRecordStatus>
}

export default ComputerEngine
