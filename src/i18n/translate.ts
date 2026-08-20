import { createTranslator } from 'next-intl'
import type messages from '../../messages/en.json'
import { resolveLocale } from './request'

/** The namespaces reachable from outside a render — the same key space the
 *  components use, so push copy can never drift from the surface it links. */
type Namespace = keyof typeof messages

/**
 * A translator for copy that renders OUTSIDE the React tree: push
 * notification bodies and the MCP payload's goal label.
 *
 * `useTranslations` needs a render and `getTranslations` needs a request
 * scope, and neither holds for a trophy stamped during an import commit or a
 * goal push fired from a background write — so the catalog is loaded directly
 * for the resolved locale instead. Locale still comes from the ONE seam
 * (`resolveLocale`), which is what makes this a fix rather than a second
 * hardcoded 'en'.
 */
export async function getMessages(namespace: Namespace) {
  const locale = await resolveLocale()
  const loaded = (await import(`../../messages/${locale}.json`)).default as typeof messages
  return createTranslator({ locale, messages: loaded, namespace })
}
