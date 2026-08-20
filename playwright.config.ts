import { defineConfig, devices } from '@playwright/test'

// Load the same local secrets the app uses (WORKOS_* keys, DATABASE_URL_DIRECT)
// so the test-user provisioning and the DB assertions have what they need. The
// dev server started below also inherits this env (and Next re-reads .env.local).
process.loadEnvFile('.env.local')

// This suite PROVISIONS USERS AND WRITES WORKOUTS. .env.local points at the
// live Supabase instance, so running it unguarded mutates production data —
// and nothing in the config said so. Fail before the first test rather than
// after a few hundred rows.
//
// Set E2E_ALLOW_REMOTE_DB=1 to override deliberately (a disposable branch
// database, say); the check exists to make that a decision, not an accident.
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

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  // Two servers, in order: the WorkOS emulator, then the app pointed at it.
  // The emulator is what makes browser sign-in testable at all — AuthKit's
  // hosted page blocks automation with bot detection. `--interactive` serves a
  // plain login page instead of auto-redirecting.
  webServer: [
    {
      command: 'npx workos@latest emulate --port 4100 --interactive',
      url: 'http://localhost:4100/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: false,
      timeout: 120_000,
      // The app needs NO code change to talk to the emulator — authkit-nextjs
      // resolves its API host from these. Keys are the emulator's fixed
      // defaults, not secrets.
      env: {
        WORKOS_API_HOSTNAME: 'localhost',
        WORKOS_API_PORT: '4100',
        WORKOS_API_HTTPS: 'false',
        WORKOS_API_KEY: 'sk_test_default',
        WORKOS_CLIENT_ID: 'client_local_authkit',
        WORKOS_AUTHKIT_DOMAIN: 'http://localhost:4100',
        NEXT_PUBLIC_WORKOS_REDIRECT_URI: 'http://localhost:3000/callback',
      },
    },
  ],
})
