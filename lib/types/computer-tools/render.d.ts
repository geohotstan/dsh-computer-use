/**
 * Pure presentation helpers for the computer-use tools: the model-facing app
 * list text, the app-state content blocks (verbatim tree text plus image
 * block), the press-key selected-text line, and the pending-call cards. All
 * functions are pure projections of tool arguments or canonical values, so
 * they replay safely from the session log. The text formats mirror the
 * official Codex computer-use surface.
 * @module @zibokapi/dsh-codex-computer-use/computer-tools/render
 */
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { listAppsText } from '../computer/index.ts';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { GenericCallView } from '@deepseek-ai/dsh-tools';
/** The official app-list text format lives on the seam, shared with the MCP server. */
export { listAppsText };
/** The canonical screenshot entry of an app-state tool result. */
export interface AppStateScreenshotValue {
    attachmentId: string;
    mediaType: 'image/jpeg';
    bytes: number;
    width: number;
    height: number;
    name?: string;
}
/** The canonical value of the `computer_use_get_app_state` tool and of every post-action state return. */
export interface AppStateValue {
    app: string;
    text: string;
    truncated: boolean;
    screenshot?: AppStateScreenshotValue;
}
/** The canonical value of the `computer_use_press_key` tool: post-action state plus the selected text. */
export interface PressKeyValue extends AppStateValue {
    selected_text: string;
}
/**
 * Re-brand a canonical screenshot entry into the durable attachment reference
 * its image block carries.
 * @param screenshot - the canonical screenshot metadata from the tool result.
 * @returns the branded attachment reference.
 */
export declare function imageRefFromValue(screenshot: AppStateScreenshotValue): ImageAttachmentRef;
/**
 * Build the model-facing content blocks of an app-state capture: the tree
 * text verbatim (the official surface ships no wrapper envelope), plus the
 * image block when the canonical value carries a committed screenshot.
 * @param value - the canonical capture value.
 * @returns the content blocks the tool result renders.
 */
export declare function appStateContent(value: AppStateValue): ContentBlock[];
/**
 * Build the content blocks of a press-key result: the post-action state with
 * the official `Selected text:` line appended when something is selected.
 * @param value - the canonical press-key value.
 * @returns the content blocks the tool result renders.
 */
export declare function pressKeyContent(value: PressKeyValue): ContentBlock[];
/** Pending-call card for the app-listing tool.
 * @returns the generic search card for a listing call.
 */
export declare function presentListAppsCall(): GenericCallView;
/** Pending-call card for the app-state tool.
 * @param args - the capture arguments naming the app.
 * @returns the generic search card titled with the captured app.
 */
export declare function presentGetAppStateCall(args: {
    app: string;
}): GenericCallView;
/** Pending-call cards for the eight input tools, labeled by action and app.
 * @param action - the human action label the card title leads with.
 * @param args - the action arguments naming the app.
 * @returns the generic execute card titled with the action and app.
 */
export declare function presentActionCall(action: string, args: {
    app: string;
}): GenericCallView;
//# sourceMappingURL=render.d.ts.map