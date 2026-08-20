import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './config'

/**
 * Guards the catalog contract the extraction ratchet leans on: every shipped
 * locale has a parseable catalog, and English defines the key space (its keys
 * are what next-intl.d.ts turns into compile-time types).
 *
 * The parity check is tested against synthetic catalogs rather than only
 * looping over SUPPORTED_LOCALES — with one shipped locale that loop has no
 * iterations, so it would pass green while asserting nothing. The logic has
 * to be exercised directly to be worth having before the second locale lands.
 */
function readCatalog(locale: string): Record<string, Record<string, string>> {
  const path = join(process.cwd(), 'messages', `${locale}.json`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** [dotted path, message] for every leaf, so guards can read both. */
function flattenEntries(
  catalog: Record<string, unknown>,
  prefix = '',
): Array<[string, string]> {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null
      ? flattenEntries(value as Record<string, unknown>, path)
      : ([[path, String(value)]] as Array<[string, string]>)
  })
}

function flattenKeys(catalog: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null
      ? flattenKeys(value as Record<string, unknown>, path)
      : [path]
  })
}

/** Keys present in the reference catalog but absent from the candidate. */
function missingKeys(
  reference: Record<string, unknown>,
  candidate: Record<string, unknown>,
): string[] {
  const candidateKeys = new Set(flattenKeys(candidate))
  return flattenKeys(reference).filter((key) => !candidateKeys.has(key))
}

describe('locale config', () => {
  it('ships the default locale', () => {
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE)
  })
})

describe('key-space parity', () => {
  it('flags keys the candidate locale is missing, including nested ones', () => {
    const reference = { Common: { appName: 'Workout Tracker', greeting: 'Hi' } }
    const candidate = { Common: { appName: 'Registro de entrenamiento' } }

    expect(missingKeys(reference, candidate)).toEqual(['Common.greeting'])
  })

  it('treats a whole missing namespace as missing keys, not as an empty diff', () => {
    const reference = { Common: { appName: 'Workout Tracker' }, Logger: { save: 'Save' } }
    const candidate = { Common: { appName: 'Registro de entrenamiento' } }

    expect(missingKeys(reference, candidate)).toEqual(['Logger.save'])
  })

  it('ignores extra keys the candidate has beyond the reference', () => {
    const reference = { Common: { appName: 'Workout Tracker' } }
    const candidate = { Common: { appName: 'Registro', stale: 'Obsoleto' } }

    expect(missingKeys(reference, candidate)).toEqual([])
  })
})

describe('message catalogs', () => {
  it('every shipped locale has a parseable catalog', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(() => readCatalog(locale)).not.toThrow()
    }
  })

  it('English defines a non-empty key space', () => {
    expect(flattenKeys(readCatalog(DEFAULT_LOCALE)).length).toBeGreaterThan(0)
  })

  it('every non-default locale covers the English key space', () => {
    // No-op until a second locale ships — the parity logic itself is covered
    // above so this stays honest about what it proves today.
    const english = readCatalog(DEFAULT_LOCALE)

    for (const locale of SUPPORTED_LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
      expect(missingKeys(english, readCatalog(locale)), `${locale} is missing keys`).toEqual([])
    }
  })

  it('has no key derived from its own message text', () => {
    // Content-derived keys drift: rewording the copy makes the key a lie, and
    // translators read the key as context. See docs/I18N-KEYS.md.
    const offenders: string[] = []
    for (const locale of SUPPORTED_LOCALES) {
      for (const [path, value] of flattenEntries(readCatalog(locale))) {
        const leaf = path.split('.').pop() ?? ''
        const words = leaf.split(/(?=[A-Z])/).map((w) => w.toLowerCase())
        // Three words, not two: at two this flags legitimate action names
        // whose label naturally matches them ('importAnother' → "Import
        // another"). A gate that blocks correct names costs more than the
        // narrow miss it would catch, which naming review covers.
        if (words.length < 3) continue
        const haystack = value.toLowerCase()
        let cursor = 0
        const derived = words.every((word) => {
          const at = haystack.indexOf(word, cursor)
          if (at === -1) return false
          cursor = at + word.length
          return true
        })
        if (derived) offenders.push(`${path} = "${value.slice(0, 40)}…"`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('has no HTML entities in message values', () => {
    // JSX renders &rsquo; as a character; a JSON message does not — it ships
    // the raw entity to the user. Catalog values carry real characters.
    const offenders: string[] = []
    for (const locale of SUPPORTED_LOCALES) {
      for (const [path, value] of flattenEntries(readCatalog(locale))) {
        if (/&[a-z]+;/i.test(value)) offenders.push(`${path} = "${value}"`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('has no empty message values', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [path, value] of flattenEntries(readCatalog(locale))) {
        expect(value.trim(), `${locale}: ${path} is empty`).not.toBe('')
      }
    }
  })
})
