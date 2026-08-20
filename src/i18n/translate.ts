import { createTranslator } from 'next-intl'
import type messages from '../../messages/en.json'
import { resolveLocale } from './request'

/** The namespaces reachable from outside a render — the same key space the
 *  components use, so push copy can never drift from the surface it links. */
type Namespace = keyof typeof messages

/**
 * Declared structurally rather than inferred from createTranslator. Inferring
 * it makes TypeScript instantiate every namespace's key space at each call
 * site, which exceeds the depth limit now that the catalog is app-wide —
 * these callers pass a descriptor's key anyway, which is already narrowed by
 * whichever pure function produced it.
 */
type OutsideTranslator = (key: string, values?: Record<string, string | number | Date>) => string

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
export async function getMessages(namespace: Namespace): Promise<OutsideTranslator> {
  const locale = await resolveLocale()
  const loaded = (await import(`../../messages/${locale}.json`)).default as typeof messages
  return createTranslator({ locale, messages: loaded, namespace }) as unknown as OutsideTranslator
}
