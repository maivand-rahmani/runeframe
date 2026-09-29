import { defineConfig } from 'vitest/config'

// Standalone consumer project: `runeframe` resolves from this project's own
// node_modules (the published 0.5.0 tarball), never from the repository root.
export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
