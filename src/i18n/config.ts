/**
 * The locale seam. Everything that needs to know "which language" reads it
 * from here, so the day locale stops being hardcoded (a user-preference
 * column + cookie fallback) only `resolveLocale` in request.ts changes.
 *
 * Deliberately NOT a URL segment: locale lives on the user, not the path.
 * A `/[locale]` prefix would bake a language into the installed PWA's
 * start_url at install time, so a user who later switched language would
 * have a home-screen icon that still opened the old one — and the service
 * worker scope would have to widen to match.
 */
export const DEFAULT_LOCALE = 'en'

/**
 * Locales the UI is actually shipped in — NOT a wish list. A locale belongs
 * here only once its messages are complete enough to show a user, because
 * every entry is a language the privacy policy, the consumer-health-data
 * policy and the consent labels must also exist in (CCPA requires notices in
 * the languages a business ordinarily uses with consumers; the EDPB
 * transparency guidelines say the same under GDPR Art 12). Adding a language
 * here is a legal commitment, not just a translation task.
 */
export const SUPPORTED_LOCALES = [DEFAULT_LOCALE] as const

export type Locale = (typeof SUPPORTED_LOCALES)[number]
