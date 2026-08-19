import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isSupportedLocale } from './config'

/**
 * Guards the catalog contract the extraction ratchet leans on: every shipped
 * locale has a parseable catalog, and English defines the key space (its keys
 * are what next-intl.d.ts turns into compile-time types).
 */
function readCatalog(locale: string): Record<string, Record<string, string>> {
  const path = join(process.cwd(), 'messages', `${locale}.json`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function flattenKeys(catalog: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null
      ? flattenKeys(value as Record<string, unknown>, path)
      : [path]
  })
}

describe('locale config', () => {
  it('ships the default locale', () => {
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE)
  })

  it('narrows unknown locale strings', () => {
    expect(isSupportedLocale(DEFAULT_LOCALE)).toBe(true)
    expect(isSupportedLocale('xx')).toBe(false)
  })
})

describe('message catalogs', () => {
  it('every shipped locale has a parseable catalog', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(() => readCatalog(locale)).not.toThrow()
    }
  })

  it('every non-default locale covers the English key space', () => {
    // English is the source of truth; a key missing elsewhere would render as
    // a raw key path to a user, so it fails here instead.
    const englishKeys = flattenKeys(readCatalog(DEFAULT_LOCALE))
    expect(englishKeys.length).toBeGreaterThan(0)

    for (const locale of SUPPORTED_LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
      const localeKeys = new Set(flattenKeys(readCatalog(locale)))
      const missing = englishKeys.filter((key) => !localeKeys.has(key))
      expect(missing, `${locale} is missing keys`).toEqual([])
    }
  })

  it('has no empty message values', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = readCatalog(locale)
      for (const [namespace, messages] of Object.entries(catalog)) {
        for (const [key, value] of Object.entries(messages)) {
          expect(value.trim(), `${locale}: ${namespace}.${key} is empty`).not.toBe('')
        }
      }
    }
  })
})
