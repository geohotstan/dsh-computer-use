#!/usr/bin/env node
/** The parsed command line. */
export interface SetupCliArgs {
    command: 'setup' | 'status' | 'help' | 'version';
    skipPermissionPrompt: boolean;
    installDir: string | undefined;
}
/**
 * Parse the CLI argument vector into a command plus options.
 * @param argv - arguments after the binary name (e.g. `process.argv.slice(2)`).
 * @returns the parsed arguments.
 * @throws Error with usage guidance on an unknown flag or subcommand.
 */
export declare function parseSetupArgs(argv: readonly string[]): SetupCliArgs;
/** The message printed when the CLI runs on a platform the engine cannot support. */
export declare function platformError(platform: NodeJS.Platform): string;
/** Narrow the daemon's wire reply into the grant-state record. */
export declare function decodePermissionReply(line: string): {
    accessibility: boolean;
    screenRecording: boolean;
    bundled: boolean;
};
/**
 * Entry point: dispatch the parsed command. Returns the process exit code.
 * @param args - the parsed arguments.
 * @param platform - the host platform (injected for testability).
 */
export declare function runSetupCli(args: SetupCliArgs, platform?: NodeJS.Platform): Promise<number>;
//# sourceMappingURL=cli.d.ts.map