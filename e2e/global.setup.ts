import { test as setup } from '@playwright/test'

/**
 * AuthKit needs no testing-token bootstrap (Clerk did), so this project exists
 * only to fail fast and legibly: a missing key otherwise surfaces as an opaque
 * 401 from the provisioning call, or as a dev server that redirects every page
 * to a broken hosted sign-in.
 */
// WorkOS config is supplied by playwright.config.ts's webServer env (it points
// the app at the local emulator), so the only thing a human must provide is the
// database the specs assert against.
const REQUIRED = ['DATABASE_URL_DIRECT'] as const

setup('required env vars are present', () => {
  const missing = REQUIRED.filter((name) => !process.env[name])
  if (missing.length > 0) {
    throw new Error(
      `Missing env for the e2e suite: ${missing.join(', ')}. ` +
        'Add them to .env.local (playwright.config.ts loads that file).',
    )
  }
})
