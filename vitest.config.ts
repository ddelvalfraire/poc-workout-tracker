import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig, configDefaults } from 'vitest/config'

const HERE = dirname(fileURLToPath(import.meta.url))
// Where Node actually resolved the dependencies from. Run from a linked
// worktree this is the primary checkout's node_modules, several levels above
// HERE — the worktree has none of its own.
const NODE_MODULES = dirname(
  dirname(createRequire(import.meta.url).resolve('storybook/package.json')),
)
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
          // AuthKit ships ESM that imports `next/cache` as a bare specifier,
          // which Node's resolver rejects for an externalized dependency.
          // Inlining hands it to Vite's resolver instead, so any module that
          // merely reaches the auth seam stays unit-testable.
          server: { deps: { inline: [/@workos-inc\/authkit-nextjs/] } },
          // e2e/**/*.spec.ts is Playwright's; .claude/ holds tooling artifacts
          // (incl. stale git worktrees whose copied tests break). Keep both out
          // of the Vitest unit run — and stories, which belong to the project
          // below. e2e/**/*.test.ts (e.g. e2e/screens/build-path.test.ts) is a
          // real Vitest unit test and stays included.
          exclude: [
            ...configDefaults.exclude,
            'e2e/**/*.spec.ts',
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
        // Chromium fetches every module from Vite's dev server, which serves
        // only what `server.fs.allow` covers — by default the Vite root, HERE.
        // The addon's own setup file lives in NODE_MODULES, so from a worktree
        // it falls outside that root and every story 404s on import before a
        // single play function runs. In a normal checkout NODE_MODULES is
        // already under the root and this adds nothing.
        server: { fs: { allow: [NODE_MODULES] } },
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
