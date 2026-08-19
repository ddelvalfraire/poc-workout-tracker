// Dummy connection strings so the db client constructs in unit tests.
// postgres-js does not open a socket until a query runs, so these are never dialed;
// tests only build queries and assert their generated SQL.
process.env.DATABASE_URL ??= 'postgres://user:password@localhost:5432/test'
process.env.DATABASE_URL_DIRECT ??= 'postgres://user:password@localhost:5432/test'

// Unit tests must not inherit the developer's real secrets. Resolving the
// Storybook Vitest project loads Next's env config, which reads .env.local into
// process.env for the whole run — so src/lib/push.test.ts, which asserts the
// UNCONFIGURED path when VAPID keys are absent, would silently start testing
// the configured one against a real key. Clear them here so the suite is
// hermetic no matter what else populates the environment; the tests that need
// them set their own via vi.stubEnv.
for (const key of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
  delete process.env[key]
}
