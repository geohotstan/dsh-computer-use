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
import type { ClickRequest, ComputerApp, ComputerDirection, ComputerMouseButton, ScrollRequest, SetValueRequest, PerformSecondaryActionRequest } from './types.ts';
/** Canonical spellings the normalized direction maps to. */
export type NormalizedDirection = 'up' | 'down' | 'left' | 'right';
/** Canonical spellings the normalized mouse button maps to. */
export type NormalizedMouseButton = 'left' | 'right' | 'middle';
/** Mark appended to a tree text whose tail the provider dropped at its byte bound. */
export declare const TREE_TRUNCATED_MARK = "\n... (accessibility tree truncated at the capture byte limit)\n";
/**
 * Map a direction to its canonical spelling (`u` → `up`). Typed inputs are
 * already schema-constrained; the map exists so the provider's wire boundary
 * sends one canonical vocabulary.
 * @param direction - the accepted direction spelling.
 * @returns the canonical spelling.
 */
export declare function normalizeDirection(direction: ComputerDirection): NormalizedDirection;
/**
 * Map a mouse button to its canonical spelling (`l` → `left`).
 * @param mouseButton - the accepted button spelling.
 * @returns the canonical spelling.
 */
export declare function normalizeMouseButton(mouseButton: ComputerMouseButton): NormalizedMouseButton;
/**
 * Enforce the cross-field addressing rule the schema cannot express: a click
 * addresses exactly one target — an element index, or a window-relative x/y
 * pair — never both and never neither.
 * @param request - the click request to validate.
 * @throws Error naming the violation when both addressing modes or neither is present.
 */
export declare function assertClickAddressing(request: ClickRequest): void;
/**
 * Enforce the shared request sanity rules the schema leaves open: a non-empty
 * app identifier, a non-negative integer element index, a positive page
 * count, and a non-empty action or key label where one applies.
 * @param request - the action request to validate.
 * @throws Error naming the offending field.
 */
export declare function assertActionRequest(request: {
    app: string;
    elementIndex?: number;
    pages?: number;
    action?: string;
    key?: string;
}): void;
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
export declare function truncateTreeText(text: string, maxBytes: number): {
    text: string;
    truncated: boolean;
};
/**
 * Cap a captured tree text at a character bound (the official `text_limit`
 * parameter). The bound is applied by the consumer-facing engine on the
 * complete text; `truncated` reports that characters were dropped.
 * @param text - the complete tree text.
 * @param maxChars - the positive character bound.
 * @returns the bounded text and whether characters were dropped.
 */
export declare function truncateTreeChars(text: string, maxChars: number): {
    text: string;
    truncated: boolean;
};
/**
 * The model-facing state text for an app-state capture. The official
 * computer-use surface returns the accessibility text verbatim — no wrapper
 * envelope — with the screenshot as a sibling image block.
 * @param state - the captured state from the engine.
 * @returns the model-facing text block content.
 */
export declare function formatAppStateEnvelope(state: {
    app: string;
    text: string;
}): string;
/**
 * Render the model-facing app list in the official format: one line per app,
 * `Name — bundle.id [running, last-used=YYYY-MM-DD, uses=N]`.
 * @param apps - the canonical app entries.
 * @returns the model-facing list text.
 */
export declare function listAppsText(apps: ComputerApp[]): string;
/** The request types whose shared action checks {@link assertActionRequest} covers. */
export type ActionRequest = ScrollRequest | SetValueRequest | PerformSecondaryActionRequest;
//# sourceMappingURL=render.d.ts.map