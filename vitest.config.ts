import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    // Component tests need a DOM; everything else stays on the lighter
    // 'node' environment so the existing suite's behavior (and speed) is
    // unaffected. Vitest 4 doesn't honor environmentMatchGlobs the way prior
    // majors did (confirmed empirically: "document is not defined" even with
    // it set) — each *.test.tsx opts in per-file instead, via a
    // `// @vitest-environment jsdom` docblock as its first line.
    setupFiles: ['./tests/setup/jest-dom.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
})
