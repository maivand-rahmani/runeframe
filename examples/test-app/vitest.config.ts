import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Local-source consumer: this project now runs against the repository's `src`
// entry points instead of a published `runeframe` tarball, and shares the root
// React/Ink install (no package-local copies). The regexes are anchored so only
// the exact bare specifiers are mapped and deeper subpaths are left alone.
const localRuneframe = fileURLToPath(new URL('../../src/index.ts', import.meta.url))
const localRuneframeExperimental = fileURLToPath(
  new URL('../../src/experimental/index.ts', import.meta.url),
)
const localRuneframeWindowsInput = fileURLToPath(
  new URL('../../src/input/transports/windows/index.ts', import.meta.url),
)

export default defineConfig({
  resolve: {
    alias: [
      { find: /^runeframe\/windows-input$/, replacement: localRuneframeWindowsInput },
      { find: /^runeframe\/experimental$/, replacement: localRuneframeExperimental },
      { find: /^runeframe$/, replacement: localRuneframe },
    ],
  },
  test: {
    environment: 'node',
    pool: 'forks',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
