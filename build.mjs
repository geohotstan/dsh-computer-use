/**
 * Single-package build for @zibokapi/dsh-codex-computer-use.
 *
 * Two artifact families:
 *
 * - Host entries (`index`, `computer{,/invariant}`, `computer-local{,...}`,
 *   `computer-tools`, `computer-policy`, `computer-mcp`): plain Node ESM.
 *   Cross-area imports (relative paths into `src/`) are bundled in — the
 *   package is one unit, exactly like the interconnect plugin — while every
 *   `@deepseek-ai/*` package stays external: the harness profile provides
 *   them at runtime (the profile mirror resolves them for installed bundles).
 * - The MCP server binary (`lib/mcp.js`, the `@zibokapi/dsh-codex-computer-use/computer-mcp` bin): a
 *   standalone stdio server, so it bundles EVERYTHING including the
 *   @deepseek-ai/* packages and schemastery; only Node builtins stay
 *   external. It must run on a machine with just Node, no harness install.
 *
 * `prepare` runs this after a git install, so it must not assume a sibling
 * checkout, project references, or a type-check pass.
 *
 * Type declarations are emitted separately by `tsc -p tsconfig.build.json`
 * into `lib/types` (esbuild strips types), mirroring the published shape the
 * exports map points at.
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

mkdirSync('lib', { recursive: true })

/** Packages the harness (or the npm-installed profile) provides at runtime. */
const HOST_EXTERNAL = ['@deepseek-ai/*']

const AREAS = ['computer', 'computer-local', 'computer-tools', 'computer-policy', 'computer-mcp']

const targets = [
  // Root re-export of the seam surface.
  { entry: 'src/index.ts', outfile: 'lib/index.js', bundle: true, external: HOST_EXTERNAL },
  // One entry per capability area, plus its invariant companion.
  ...AREAS.flatMap(area => [
    { entry: `src/${area}/index.ts`, outfile: `lib/${area}/index.js`, bundle: true, external: HOST_EXTERNAL },
    { entry: `src/${area}/invariant.ts`, outfile: `lib/${area}/invariant.js`, bundle: true, external: HOST_EXTERNAL },
  ]),
  // The MCP stdio server binary (`@zibokapi/dsh-codex-computer-use/computer-mcp`). It shares the harness
  // externals with the plugin entries: `@deepseek-ai/dsh-subprocess-local`
  // pulls node-pty, a native module whose `.node` binaries cannot be bundled,
  // so inlining @deepseek-ai/* is off the table — the runtime dependencies
  // resolve from node_modules exactly like every other entry.
  {
    entry: 'src/computer-mcp/mcp.ts',
    outfile: 'lib/mcp.js',
    bundle: true,
    external: HOST_EXTERNAL,
  },
]

for (const { entry, outfile, bundle, external, banner } of targets) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle,
    format: 'esm',
    platform: 'node',
    target: ['node22'],
    external,
    banner,
    logLevel: 'info',
  })
}

// Type declarations for the exports.types entries.
execFileSync(
  process.execPath,
  [fileURLToPath(import.meta.resolve('typescript/bin/tsc')), '-p', 'tsconfig.build.json'],
  { stdio: 'inherit' },
)
