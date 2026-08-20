import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator, NextIntlClientProvider } from 'next-intl'
import messages from './messages/en.json'
import type { Message } from './src/lib/message'

/**
 * A translator over the REAL catalog, for the pure functions that return
 * message descriptors instead of sentences (docs/I18N-KEYS.md §9). Their own
 * tests assert the decision; this is what lets the same test also assert what
 * the decision actually READS as, without standing up a component.
 *
 * next-intl's own `createTranslator` on purpose: it gives genuine ICU
 * behaviour (plural branches, date skeletons, nested selects), so a message
 * that would render wrong in the app renders wrong here too.
 */
export function catalogTranslator(namespace: string) {
  return createTranslator({ locale: 'en', messages, namespace } as Parameters<
    typeof createTranslator
  >[0]) as unknown as (key: string, values?: Record<string, string | number | Date>) => string
}

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

/**
 * Renders a message DESCRIPTOR through the REAL catalog, the way a component
 * would — for the pure view-models and formatters that return `{ key, values }`
 * instead of a sentence (I18N-KEYS §9).
 *
 * A view-model's own test asserts the DECISION (`{ key: 'statusLine.week' }`);
 * this is the second half — proof that the key it decided on exists and that
 * its arguments satisfy the message. Without it a descriptor test passes
 * happily against a key nobody ever added to en.json.
 *
 * The namespace is a runtime string here on purpose: a test that walks every
 * branch of a view-model cannot name each namespace as a literal, and the
 * catalog assertion is exactly what proves the key resolves.
 */
export function renderMessageIn(namespace: string, message: Message): string {
  const t = createTranslator({ locale: 'en', messages, namespace } as Parameters<
    typeof createTranslator
  >[0])
  return (t as unknown as (key: string, values?: Record<string, unknown>) => string)(
    message.key,
    message.values,
  )
}
