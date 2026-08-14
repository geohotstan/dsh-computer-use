/**
 * Pure presentation helpers for the computer-use tools: the model-facing app
 * list text, the app-state content blocks (verbatim tree text plus image
 * block), the press-key selected-text line, and the pending-call cards. All
 * functions are pure projections of tool arguments or canonical values, so
 * they replay safely from the session log. The text formats mirror the
 * official Codex computer-use surface.
 * @module dsh-computer-tools/render
 */

import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { formatAppStateEnvelope, listAppsText } from '../computer/index.ts'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'

/** The official app-list text format lives on the seam, shared with the MCP server. */
export { listAppsText }

/** The canonical screenshot entry of an app-state tool result. */
export interface AppStateScreenshotValue {
  attachmentId: string
  mediaType: 'image/jpeg'
  bytes: number
  width: number
  height: number
  name?: string
}

/** The canonical value of the `computer_use_get_app_state` tool and of every post-action state return. */
export interface AppStateValue {
  app: string
  text: string
  truncated: boolean
  screenshot?: AppStateScreenshotValue
}

/** The canonical value of the `computer_use_press_key` tool: post-action state plus the selected text. */
export interface PressKeyValue extends AppStateValue {
  selected_text: string
}

/**
 * Re-brand a canonical screenshot entry into the durable attachment reference
 * its image block carries.
 * @param screenshot - the canonical screenshot metadata from the tool result.
 * @returns the branded attachment reference.
 */
export function imageRefFromValue(screenshot: AppStateScreenshotValue): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(screenshot.attachmentId),
    mediaType: screenshot.mediaType,
    bytes: screenshot.bytes,
    width: screenshot.width,
    height: screenshot.height,
    ...screenshot.name === undefined ? {} : { name: screenshot.name },
  }
}

/**
 * Build the model-facing content blocks of an app-state capture: the tree
 * text verbatim (the official surface ships no wrapper envelope), plus the
 * image block when the canonical value carries a committed screenshot.
 * @param value - the canonical capture value.
 * @returns the content blocks the tool result renders.
 */
export function appStateContent(value: AppStateValue): ContentBlock[] {
  const blocks: ContentBlock[] = [{
    type: 'text',
    text: formatAppStateEnvelope({ app: value.app, text: value.text }),
  }]
  if (value.screenshot !== undefined) {
    blocks.push({ type: 'image', attachment: imageRefFromValue(value.screenshot) })
  }
  return blocks
}

/**
 * Build the content blocks of a press-key result: the post-action state with
 * the official `Selected text:` line appended when something is selected.
 * @param value - the canonical press-key value.
 * @returns the content blocks the tool result renders.
 */
export function pressKeyContent(value: PressKeyValue): ContentBlock[] {
  const blocks = appStateContent(value)
  if (value.selected_text.length === 0) return blocks
  const first = blocks[0]
  const textBlock = first !== undefined && first.type === 'text' ? first.text : ''
  return [{ type: 'text', text: `${textBlock}\nSelected text: [${value.selected_text}]` }, ...blocks.slice(1)]
}

/** Pending-call card for the app-listing tool.
 * @returns the generic search card for a listing call.
 */
export function presentListAppsCall(): GenericCallView {
  return { card: 'generic', title: 'List computer apps', kind: 'search' }
}

/** Pending-call card for the app-state tool.
 * @param args - the capture arguments naming the app.
 * @returns the generic search card titled with the captured app.
 */
export function presentGetAppStateCall(args: { app: string }): GenericCallView {
  return { card: 'generic', title: `Capture state of ${args.app}`, kind: 'search' }
}

/** Pending-call cards for the eight input tools, labeled by action and app.
 * @param action - the human action label the card title leads with.
 * @param args - the action arguments naming the app.
 * @returns the generic execute card titled with the action and app.
 */
export function presentActionCall(action: string, args: { app: string }): GenericCallView {
  return { card: 'generic', title: `${action} in ${args.app}`, kind: 'execute' }
}
