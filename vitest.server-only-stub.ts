/**
 * Vitest stand-in for the `server-only` package, which throws on import
 * outside a React Server environment. Aliased in vitest.config.ts so server
 * modules (e.g. src/lib/analytics.ts) stay importable from unit tests; the
 * real guard still runs everywhere outside the test resolver.
 */
export {}
