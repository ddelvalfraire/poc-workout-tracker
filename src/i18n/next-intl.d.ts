import type { Locale } from './config'
import type messages from '../../messages/en.json'

/**
 * Makes English the type-level source of truth: a typo in a message key, or
 * a key that exists in no catalog, is a compile error rather than a string
 * rendered to a user at runtime. This is what lets the extraction ratchet
 * move directory-by-directory safely — a half-migrated component cannot
 * reference a key nobody added.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale
    Messages: typeof messages
  }
}
