import { fileURLToPath } from 'node:url'
import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  resolve: {
    // mirror the tsconfig "@/*" path alias so tests resolve the same imports as the app
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // e2e/ is Playwright's; keep it out of the Vitest unit run.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
