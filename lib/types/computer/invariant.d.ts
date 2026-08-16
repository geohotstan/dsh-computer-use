/**
 * Package-owned invariant companion for the computer-use seam.
 * @module @zibokapi/dsh-codex-computer-use/computer/invariant
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis companion plugin name. */
export declare const name = "computer-invariant";
/** Service required before the companion can reserve package ownership. */
export declare const inject: string[];
/**
 * Register the computer-use invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export declare const apply: (ctx: Context) => Promise<() => void>;
//# sourceMappingURL=invariant.d.ts.map