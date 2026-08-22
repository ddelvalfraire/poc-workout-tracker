import { vi } from 'vitest'
import { DEFAULT_LOCALE } from './src/i18n/config'
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
for (const key of [
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  // The RevenueCat adapter is env-gated everywhere (webhook auth, API client,
  // reconcile, sync action) — with real keys inherited from .env.local the
  // "unconfigured" paths would silently stop being tested and the reconcile
  // rider would sweep against the REAL RC API from inside unit tests.
  'RC_API_V2_KEY',
  'RC_PROJECT_ID',
  'RC_WEBHOOK_AUTH_TOKEN',
  'RC_WEBHOOK_HMAC_SECRET',
  'RC_WEBHOOK_HMAC_SECRET_OLD',
  'RC_EXPECTED_ENVIRONMENT',
  'NEXT_PUBLIC_RC_WEB_BILLING_KEY',
]) {
  delete process.env[key]
}

// next-intl resolves translations from React context that only the app's
// provider supplies, so any component calling useTranslations throws in a bare
// unit render. Rather than make every test wrap a provider, back the mock with
// next-intl's OWN createTranslator over the real messages/en.json.
//
// Using the real translator rather than a hand-rolled key lookup is the whole
// point: it gives genuine ICU behaviour — `{seconds}s` interpolates, plurals
// pick the right branch, and `t.rich` exists. A lookup stub silently returns
// the raw ICU pattern instead of the formatted string, so an assertion could
// pass or fail for reasons that have nothing to do with the component under
// test. A key missing from the catalog still fails loudly.
vi.mock('next-intl', async (importActual) => {
  const actual = await importActual<typeof import('next-intl')>()
  const messages = (await import('./messages/en.json')).default

  return {
    ...actual,
    // The namespace is whatever the component asked for; createTranslator types
    // it against the catalog, which a generic harness cannot satisfy statically.
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: 'en', messages, namespace } as Parameters<
        typeof actual.createTranslator
      >[0]),
    // Dates, numbers and units are Intl's, not the catalog's, so components
    // read the resolved locale alongside their translator. The mock has to
    // answer that too — `useLocale` is context-backed like `useTranslations`,
    // and the no-op provider below supplies no context.
    useLocale: () => DEFAULT_LOCALE,
    // The provider is a no-op here: the hooks above are already bound to the
    // catalog, so tests need not wrap anything.
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  }
})
