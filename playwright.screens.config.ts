import { defineConfig, devices } from '@playwright/test'
import { readdirSync } from 'node:fs'
import { APP_ORIGIN, APP_PORT } from './e2e/app-origin'
import type { ScreensFixtures } from './e2e/screens/fixtures'

/**
 * Dedicated config for the "screens rig" (`npm run screens`) — a separate
 * gallery-style Playwright run that walks every seeded persona's screens and
 * attaches a full-page screenshot per route to the HTML report. Kept fully
 * separate from playwright.config.ts (the real e2e suite) on purpose: same
 * host guard, same webServer pair, zero shared state, so `npm run test:e2e`
 * is provably unaffected by anything here.
 */
process.loadEnvFile('.env.local')

// Same guard as playwright.config.ts — the screens rig is part of the same
// e2e surface, not a separate safety domain, so it gets the same fail-closed
// check against a live/prod database.
const directUrl = process.env.DATABASE_URL_DIRECT ?? ''
const isLocalDb = /@(localhost|127\.0\.0\.1|host\.docker\.internal|db):/.test(directUrl)
if (directUrl && !isLocalDb && process.env.E2E_ALLOW_REMOTE_DB !== '1') {
  const host = directUrl.replace(/^.*@/, '').replace(/[/?].*$/, '')
  throw new Error(
    `Refusing to run e2e against a non-local database (${host}).\n` +
      'This suite creates users and writes workouts. Point DATABASE_URL_DIRECT at a\n' +
      'local or disposable database, or set E2E_ALLOW_REMOTE_DB=1 if you mean it.',
  )
}

// Persona discovery is filesystem-only — no `@/db/*` (or anything that
// transitively imports it, like scripts/persona/registry.ts or
// scripts/persona/actions.ts) may be imported at config-eval time. Config
// files run before any per-test guard would, so importing a module that
// connects to DATABASE_URL at import time would reintroduce the exact
// prod-write risk the guard above exists to prevent.
function discoverPersonaSlugs(): string[] {
  try {
    return readdirSync('e2e/.state')
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

const personaSlugs = discoverPersonaSlugs()
if (process.env.SCREENS_TARGET_USER) personaSlugs.push('user')

export default defineConfig<ScreensFixtures>({
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: APP_ORIGIN,
    trace: 'on-first-retry',
  },
  projects: personaSlugs.flatMap((slug) => [
    {
      name: `setup:${slug}`,
      testDir: './e2e/screens',
      testMatch: /setup\.spec\.ts/,
      use: { personaSlug: slug },
    },
    {
      name: `capture:${slug}`,
      testDir: './e2e/screens',
      testMatch: /capture\.spec\.ts/,
      dependencies: [`setup:${slug}`],
      use: {
        ...devices['Desktop Chrome'],
        storageState: `playwright/.auth/${slug}.json`,
        personaSlug: slug,
        reducedMotion: 'reduce',
      },
    },
  ]),
  // Same emulator + dev server pair as playwright.config.ts, copied rather
  // than imported/re-exported — keeps the two configs independently
  // readable, matching the project's existing tolerance for this kind of
  // duplication (also duplicated, in a different shape, in
  // scripts/persona/guard.ts).
  webServer: [
    {
      command: 'npx workos@latest emulate --port 4100 --interactive',
      url: 'http://localhost:4100/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `npm run dev -- --port ${APP_PORT}`,
      url: APP_ORIGIN,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        WORKOS_API_HOSTNAME: 'localhost',
        WORKOS_API_PORT: '4100',
        WORKOS_API_HTTPS: 'false',
        WORKOS_API_KEY: 'sk_test_default',
        WORKOS_CLIENT_ID: 'client_local_authkit',
        WORKOS_AUTHKIT_DOMAIN: 'http://localhost:4100',
        NEXT_PUBLIC_WORKOS_REDIRECT_URI: `${APP_ORIGIN}/callback`,
      },
    },
  ],
})
