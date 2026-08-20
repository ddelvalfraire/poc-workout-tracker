import { vi } from 'vitest'
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

// next-intl resolves translations from React context that only the app's
// provider supplies, so any component calling useTranslations throws in a bare
// unit render. Rather than make every test wrap a provider, resolve against
// the REAL catalog here: tests keep asserting the copy users actually see, and
// a key deleted from messages/en.json fails the suite instead of silently
// rendering its own name.
vi.mock('next-intl', async () => {
  const messages = (await import('./messages/en.json')).default as Record<string, unknown>
  // Keys are dotted paths into nested namespaces ('visibility.label'), which is
  // how next-intl addresses them.
  const resolve = (path: string): unknown =>
    path.split('.').reduce<unknown>((node, part) => {
      return node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
    }, messages)
  const lookup = (namespace: string) => (key: string) => {
    const value = resolve(`${namespace}.${key}`)
    if (typeof value !== 'string') {
      throw new Error(`Missing translation: ${namespace}.${key} (messages/en.json)`)
    }
    return value
  }
  return {
    useTranslations: (namespace: string) => lookup(namespace),
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  }
})
