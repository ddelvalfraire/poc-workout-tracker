import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import messages from './messages/en.json'

/**
 * Client components call useTranslations, which throws without a provider —
 * in a test that reads as "context from NextIntlClientProvider was not
 * found", not as a missing translation.
 *
 * Both helpers deliberately feed the REAL en.json rather than a stub: these
 * assertions are about user-visible copy, and a stub would let a component
 * reference a key the catalog never received and still pass.
 */

/**
 * The provider as an ELEMENT, for tests that bring their own renderer —
 * createRoot, Testing Library's `render`, or a static render already wrapped
 * in other providers.
 */
export function withIntl(node: ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>
  )
}

/** Static markup in one call, for tests that only read the output HTML. */
export function renderStaticIntl(node: ReactNode): string {
  return renderToStaticMarkup(withIntl(node))
}
