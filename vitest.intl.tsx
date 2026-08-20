import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import messages from './messages/en.json'

/**
 * Client components call useTranslations, which throws without a provider —
 * in a test that reads as "context from NextIntlClientProvider was not
 * found", not as a missing translation.
 *
 * Deliberately feeds the REAL en.json rather than a stub: the assertions in
 * these tests are about user-visible copy, so a stub would let a component
 * reference a key the catalog never got and still pass.
 */
export function renderStaticIntl(node: ReactNode): string {
  return renderToStaticMarkup(withIntl(node))
}

/**
 * The same provider as an ELEMENT, for tests that bring their own renderer —
 * Testing Library's `render`, or a static render already wrapped in other
 * providers (QueryClientProvider and friends).
 */
export function withIntl(node: ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>
  )
}
