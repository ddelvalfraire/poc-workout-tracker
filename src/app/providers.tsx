'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * TanStack Query provider for client-side server state (the first consumer is
 * the logger's last-performance ghosts; the stats dashboard and
 * refetch-on-focus of MCP-driven edits build on this). Server Components keep
 * fetching directly — Query only owns state that lives in client components.
 *
 * Per the current official App Router guidance: a fresh QueryClient per
 * server render (no user data may leak between requests), a module singleton
 * in the browser (NOT useState — React would discard the client if a render
 * suspends below the provider before mounting).
 */

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Fresh-enough window so focus/remount doesn't refetch in a burst...
        staleTime: 30_000,
        // ...while a return to the tab picks up edits made elsewhere (the
        // MCP flow: Claude logs a set while the web app sits open).
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined

function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return makeQueryClient()
  browserQueryClient ??= makeQueryClient()
  return browserQueryClient
}

export function Providers({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>
}
