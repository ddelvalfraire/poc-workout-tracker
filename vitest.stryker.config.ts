import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Vitest config used only by Stryker (see stryker.config.json). Restricts the
// run to the suites that exercise the progression engine — running the whole
// app suite per mutant would be far too slow and adds no kill power for
// mutants scoped to progression/autoregulate/plan-sync.
export default defineConfig({
  resolve: {
    // mirror the tsconfig "@/*" path alias so tests resolve the same imports as the app
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/lib/progression.test.ts',
      'src/lib/autoregulate.test.ts',
      'src/lib/plan-sync.test.ts',
      'src/lib/testing/**/*.test.ts',
    ],
  },
})
