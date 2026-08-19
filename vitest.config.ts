import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig, configDefaults } from 'vitest/config'

const HERE = dirname(fileURLToPath(import.meta.url))
const srcAlias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  // `server-only` throws outside RSC; stub it so server modules unit-test.
  'server-only': fileURLToPath(new URL('./vitest.server-only-stub.ts', import.meta.url)),
}

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: srcAlias },
        test: {
          name: 'unit',
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          // e2e/ is Playwright's; .claude/ holds tooling artifacts (incl. stale
          // git worktrees whose copied tests break). Keep both out of the
          // Vitest unit run — and stories, which belong to the project below.
          exclude: [
            ...configDefaults.exclude,
            'e2e/**',
            '.claude/**',
            '**/*.stories.tsx',
          ],
        },
      },
      {
        // Every story runs as a browser test: the play functions assert
        // behaviour, and addon-a11y turns `parameters.a11y.test: 'error'` into
        // a failing test. Real Chromium, because colour-contrast needs actual
        // layout and computed styles — jsdom would pass those silently.
        plugins: [storybookTest({ configDir: join(HERE, '.storybook') })],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            provider: playwright({}),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
