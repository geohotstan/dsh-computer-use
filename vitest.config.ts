import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// Resolution facade: tsconfig.base.json has no include, which
// vite-tsconfig-paths treats as match-all, so its paths map applies to every
// test file. paths must win over package exports so built lib/ never loads a
// second module-singleton copy.
const pathsPlugin = (): ReturnType<typeof tsconfigPaths> => tsconfigPaths({ projects: ['./tsconfig.base.json'] })

export default defineConfig({
  plugins: [pathsPlugin()],
  test: {
    include: ['packages/*/tests/**/*.spec.ts'],
    pool: 'forks',
  },
})
