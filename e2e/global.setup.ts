import { test as setup } from '@playwright/test'

/**
 * AuthKit needs no testing-token bootstrap (Clerk did), so this project exists
 * only to fail fast and legibly: a missing key otherwise surfaces as an opaque
 * 401 from the provisioning call, or as a dev server that redirects every page
 * to a broken hosted sign-in.
 */
const REQUIRED = [
  'WORKOS_API_KEY', // provisions + deletes the disposable test users
  'WORKOS_CLIENT_ID', // the app's AuthKit client
  'WORKOS_COOKIE_PASSWORD', // seals the session cookie the sign-in flow sets
  'NEXT_PUBLIC_WORKOS_REDIRECT_URI', // where AuthKit hands the browser back
  'DATABASE_URL_DIRECT', // the specs assert their rows straight in Postgres
] as const

setup('required env vars are present', () => {
  const missing = REQUIRED.filter((name) => !process.env[name])
  if (missing.length > 0) {
    throw new Error(
      `Missing env for the e2e suite: ${missing.join(', ')}. ` +
        'Add them to .env.local (playwright.config.ts loads that file).',
    )
  }
})
