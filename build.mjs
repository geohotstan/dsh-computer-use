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
 * `lib/` is committed and this runs on demand (`pnpm run build`) and before
 * publishing (`prepublishOnly`), never as a dependency's install script —
 * pnpm ≥10 blocks those for git-hosted packages, so git installs rely on the
 * committed artifacts instead. The build must not assume a sibling checkout,
 * project references, or a type-check pass.
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
  // The setup binary (`dsh-codex-computer-use`, the `npx` entry). It bundles
  // EVERYTHING including the relative paths import — it must run standalone
  // under npx, where no profile, no peer dependency, and no harness install
  // exists, so it may import nothing beyond Node builtins and pure local files.
  // The shebang lives in the source file; esbuild keeps it at output line 1.
  {
    entry: 'src/setup/cli.ts',
    outfile: 'lib/setup.js',
    bundle: true,
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
