/**
 * Pure validation and formatting helpers shared by the computer-use seam:
 * canonical spelling for directions and mouse buttons, the cross-field
 * addressing rules the tool schema cannot express, the bounded-tree
 * truncation contract, and the model-facing state envelope. Providers apply
 * the normalizations at their wire boundary and the bounds at the complete
 * result; the tool consumer applies the envelope and the request rules at
 * execute.
 * @module @zibokapi/dsh-codex-computer-use/computer/render
 */

import type {
  ClickRequest,
  ComputerApp,
  ComputerDirection,
  ComputerMouseButton,
  ScrollRequest,
  SetValueRequest,
  PerformSecondaryActionRequest,
} from './types.ts'

/** Canonical spellings the normalized direction maps to. */
export type NormalizedDirection = 'up' | 'down' | 'left' | 'right'

/** Canonical spellings the normalized mouse button maps to. */
export type NormalizedMouseButton = 'left' | 'right' | 'middle'

/** Mark appended to a tree text whose tail the provider dropped at its byte bound. */
export const TREE_TRUNCATED_MARK = '\n... (accessibility tree truncated at the capture byte limit)\n'

const DIRECTION_SPELLINGS: Readonly<Record<ComputerDirection, NormalizedDirection>> = {
  up: 'up', down: 'down', left: 'left', right: 'right',
  u: 'up', d: 'down', l: 'left', r: 'right',
}

const MOUSE_BUTTON_SPELLINGS: Readonly<Record<ComputerMouseButton, NormalizedMouseButton>> = {
  left: 'left', right: 'right', middle: 'middle',
  l: 'left', r: 'right', m: 'middle',
}

/**
 * Map a direction to its canonical spelling (`u` → `up`). Typed inputs are
 * already schema-constrained; the map exists so the provider's wire boundary
 * sends one canonical vocabulary.
 * @param direction - the accepted direction spelling.
 * @returns the canonical spelling.
 */
export function normalizeDirection(direction: ComputerDirection): NormalizedDirection {
  return DIRECTION_SPELLINGS[direction]
}

/**
 * Map a mouse button to its canonical spelling (`l` → `left`).
 * @param mouseButton - the accepted button spelling.
 * @returns the canonical spelling.
 */
export function normalizeMouseButton(mouseButton: ComputerMouseButton): NormalizedMouseButton {
  return MOUSE_BUTTON_SPELLINGS[mouseButton]
}

/**
 * Enforce the cross-field addressing rule the schema cannot express: a click
 * addresses exactly one target — an element index, or a window-relative x/y
 * pair — never both and never neither.
 * @param request - the click request to validate.
 * @throws Error naming the violation when both addressing modes or neither is present.
 */
export function assertClickAddressing(request: ClickRequest): void {
  const byIndex = request.elementIndex !== undefined
  const byX = request.x !== undefined
  const byY = request.y !== undefined
  if (byIndex === (byX || byY)) {
    throw new Error('computer: click requires exactly one addressing mode: elementIndex, or both x and y')
  }
  if (byX !== byY) {
    throw new Error('computer: click coordinates require both x and y')
  }
}

/**
 * Enforce the shared request sanity rules the schema leaves open: a non-empty
 * app identifier, a non-negative integer element index, a positive page
 * count, and a non-empty action or key label where one applies.
 * @param request - the action request to validate.
 * @throws Error naming the offending field.
 */
export function assertActionRequest(request: {
  app: string
  elementIndex?: number
  pages?: number
  action?: string
  key?: string
}): void {
  if (request.app.trim().length === 0) throw new Error('computer: app must be a non-empty string')
  if (request.elementIndex !== undefined && (!Number.isInteger(request.elementIndex) || request.elementIndex < 0)) {
    throw new Error(`computer: elementIndex must be a non-negative integer, got ${JSON.stringify(request.elementIndex)}`)
  }
  if (request.pages !== undefined && (!Number.isFinite(request.pages) || request.pages <= 0)) {
    throw new Error(`computer: pages must be a positive number, got ${JSON.stringify(request.pages)}`)
  }
  if (request.action !== undefined && request.action.trim().length === 0) {
    throw new Error('computer: action must be a non-empty string')
  }
  if (request.key !== undefined && request.key.trim().length === 0) {
    throw new Error('computer: key must be a non-empty string')
  }
}

/**
 * Cap a captured tree text at the seam's byte bound, keeping the tail-truncated
 * result model-readable. The mark tells the model the tree is incomplete, so a
 * provider must not silently present a capped tree as complete. The mark is the
 * required completeness signal: when the bound cannot even hold the full mark,
 * the result is the mark itself cut to the bound — a truncated marker prefix
 * that still cannot be read as a complete tree.
 * @param text - the full tree text from the provider.
 * @param maxBytes - the positive byte bound, including the appended mark.
 * @returns the bounded text and whether bytes were dropped.
 */
export function truncateTreeText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false }
  const markBytes = Buffer.byteLength(TREE_TRUNCATED_MARK, 'utf8')
  if (markBytes >= maxBytes) return { text: TREE_TRUNCATED_MARK.slice(0, maxBytes), truncated: true }
  const budget = maxBytes - markBytes
  let end = Math.min(text.length, budget)
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > budget) end -= 1
  return { text: text.slice(0, end) + TREE_TRUNCATED_MARK, truncated: true }
}

/**
 * Cap a captured tree text at a character bound (the official `text_limit`
 * parameter). The bound is applied by the consumer-facing engine on the
 * complete text; `truncated` reports that characters were dropped.
 * @param text - the complete tree text.
 * @param maxChars - the positive character bound.
 * @returns the bounded text and whether characters were dropped.
 */
export function truncateTreeChars(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  return { text: text.slice(0, maxChars), truncated: true }
}

/**
 * The model-facing state text for an app-state capture. The official
 * computer-use surface returns the accessibility text verbatim — no wrapper
 * envelope — with the screenshot as a sibling image block.
 * @param state - the captured state from the engine.
 * @returns the model-facing text block content.
 */
export function formatAppStateEnvelope(state: { app: string; text: string }): string {
  return state.text
}

/**
 * Render the model-facing app list in the official format: one line per app,
 * `Name — bundle.id [running, last-used=YYYY-MM-DD, uses=N]`.
 * @param apps - the canonical app entries.
 * @returns the model-facing list text.
 */
export function listAppsText(apps: ComputerApp[]): string {
  if (apps.length === 0) return 'No targetable apps found.'
  return apps.map((app) => {
    const name = app.displayName ?? app.id
    const flags: string[] = []
    if (app.isRunning === true) flags.push('running')
    if (app.lastUsedDate !== undefined) flags.push(`last-used=${app.lastUsedDate}`)
    if (app.useCount !== undefined) flags.push(`uses=${app.useCount}`)
    const suffix = flags.length > 0 ? ` [${flags.join(', ')}]` : ''
    return `${name} — ${app.id}${suffix}`
  }).join('\n')
}

/** The request types whose shared action checks {@link assertActionRequest} covers. */
export type ActionRequest = ScrollRequest | SetValueRequest | PerformSecondaryActionRequest
