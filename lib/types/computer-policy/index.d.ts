/**
 * Approval policy for the computer-use tools, mirroring the Codex Computer
 * Use confirmation model: reads (`computer_use_list_apps`,
 * `computer_use_get_app_state`) always pass; the first control action on an
 * app asks the user, who may grant access once for the session or remember
 * it persistently (the Codex app-approval equivalent, stored as the settings
 * user layer). When no user-questions channel is mounted the ask degrades to
 * the approval seam, whose grant persists as before. Always-confirm tools
 * and destructive secondary-action labels ask on every call even for
 * approved apps; and the model receives the four-tier guidance Codex ships
 * as its SKILL.md. Without an approval service mounted, the registry's `ask`
 * resolution degrades to denial, so the gate fails closed.
 * @module @zibokapi/dsh-codex-computer-use/computer-policy
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "computer-policy";
export declare const inject: string[];
/** Settings namespace owning the persisted per-app control grants. */
export declare const COMPUTER_POLICY_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/** Configuration for the computer-use approval policy. */
export interface Config {
    /**
     * Apps the composition allows without asking (canonical bundle ids); they
     * form the settings section's base, so a user grant layers above them.
     */
    allowlistApps?: string[];
    /** Whole tool names that always ask, even for approved apps. */
    alwaysConfirmTools?: string[];
    /** Secondary-action labels that always ask, even for approved apps (case-insensitive prefixes). */
    destructiveLabels?: string[];
    /**
     * Canonical app ids where sending a message requires approval: a
     * press of Return/Enter or a newline in typed text targeting one of these
     * apps asks the user, with the app's latest captured text shown as the
     * composed message. The ask never grants — it confirms the single send.
     */
    sendApprovalApps?: string[];
}
/** Runtime configuration schema for the policy plugin. */
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map