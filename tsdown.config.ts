import { defineConfig } from 'tsdown'

export default defineConfig({
  workspace: ['packages/*'],
  entry: ['lib/types/{index,invariant,mcp}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  fixedExtension: false,
  clean: false,
})
