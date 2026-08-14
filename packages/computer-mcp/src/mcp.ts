#!/usr/bin/env node
/**
 * The `dsh-computer-mcp` binary: boot the computer-use engine and serve the
 * Codex Computer Use MCP surface over stdio. The daemon path comes from the
 * first argument or `DSH_COMPUTER_HELPER_PATH`.
 */
import { createServer } from './index.ts'

const helperPath = process.argv[2]
try {
  const server = await createServer(helperPath === undefined ? {} : { helperPath })
  await server.serve()
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`dsh-computer-mcp: ${message}\n`)
  process.exit(1)
}
