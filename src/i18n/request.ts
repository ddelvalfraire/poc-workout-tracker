import { getRequestConfig } from 'next-intl/server'
import { DEFAULT_LOCALE, type Locale } from './config'

/**
 * Request-scoped i18n config, auto-wired by createNextIntlPlugin() in
 * next.config.ts.
 *
 * CRITICAL — this must not read request data (cookies(), headers(), auth()).
 * Anything request-scoped in here opts EVERY translated route out of static
 * rendering, which would silently de-static /terms, /privacy and
 * /health-privacy — the three routes that must stay static because they are
 * the consent documents whose text the ledger hashes. Locale is a constant
 * until the user-preference column lands; when it does, the read belongs
 * behind a cache boundary, not inline here.
 */
export async function resolveLocale(): Promise<Locale> {
  return DEFAULT_LOCALE
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale()

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
