/**
 * Model-facing Consumer of the `ctx.computer` capability seam: the ten
 * `computer_use_*` tools mirroring the official Codex Computer Use window-API
 * surface, plus the cross-call guidance that makes the accessibility-tree-first
 * flow work — capture once per assistant turn, act on element indexes, and
 * read the post-action state every action tool returns (the official behavior:
 * each mutation tool answers with the updated tree plus screenshot instead of
 * a bare acknowledgement). Window screenshots accompany state results as image
 * blocks when an attachment store and an image-capable model route are
 * mounted; without them the tree text alone carries the tool result.
 *
 * Deployment policy — which apps may be driven and which actions need human
 * approval — belongs in `tools/pre-execute` or a policy service, not here.
 * @module @zibokapi/dsh-codex-computer-use/computer-tools
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "tool-computer";
export declare const inject: string[];
/** Configuration for the computer-use tools. */
export interface Config {
    /** Attach window screenshots to state results when the route carries images (default true). */
    enableScreenshots?: boolean;
}
/** Runtime configuration schema for the computer-use tools plugin. */
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map