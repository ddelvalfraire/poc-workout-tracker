import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { useTranslations } from 'next-intl'
import { renderStaticIntl } from '../../../vitest.intl'

/**
 * The settings surfaces that hold the most copy are async server components
 * (auth + db + getTranslations), so a unit test cannot render them. What CAN
 * be checked — and is exactly the failure this backfill is about — is that
 * every key path those files ask for exists in the catalog: a key that was
 * never added renders as its own literal path on the page.
 *
 * The interpolated Settings messages are rendered for real below, because an
 * argument name that drifts is invisible to the key-space check.
 */

const CATALOG = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en.json'), 'utf8'),
) as Record<string, unknown>

/** Namespace per file — the `useTranslations`/`getTranslations` argument. */
const SURFACES: ReadonlyArray<[file: string, namespace: string]> = [
  ['src/app/settings/page.tsx', 'Settings'],
  ['src/app/settings/delete-account/page.tsx', 'DeleteAccount'],
  ['src/app/settings/home/page.tsx', 'CustomizeHome'],
  ['src/app/settings/import/page.tsx', 'Import'],
  ['src/app/trophies/page.tsx', 'Trophies'],
]

function resolve(path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => {
    if (typeof node !== 'object' || node === null) return undefined
    return (node as Record<string, unknown>)[part]
  }, CATALOG)
}

/** Every `t('…')` / `t.rich('…')` key a source file asks for. */
function requestedKeys(file: string): string[] {
  const source = readFileSync(join(process.cwd(), file), 'utf8')
  return [...source.matchAll(/\bt(?:\.rich)?\('([^']+)'/g)].map((m) => m[1])
}

describe.each(SURFACES)('%s copy contract', (file, namespace) => {
  test('asks the catalog for keys it actually has', () => {
    const missing = requestedKeys(file).filter(
      (key) => typeof resolve(`${namespace}.${key}`) !== 'string',
    )
    expect(missing).toEqual([])
  })

  test('reads at least one key (the scan is not silently matching nothing)', () => {
    expect(requestedKeys(file).length).toBeGreaterThan(0)
  })
})

describe('Settings interpolated messages', () => {
  function Probe() {
    const t = useTranslations('Settings')
    return (
      <ul>
        <li>{t('version', { sha: 'f4be5e7' })}</li>
        <li>{t('versionLocal', { version: '0.1.0' })}</li>
        <li>{t('body.value', { value: 82.5, unit: 'kg' })}</li>
        <li>{t('body.valueUnset')}</li>
      </ul>
    )
  }

  test('the version and bodyweight readouts fill their arguments', () => {
    const html = renderStaticIntl(<Probe />)
    expect(html).toContain('Build f4be5e7')
    expect(html).toContain('v0.1.0')
    expect(html).toContain('82.5 kg')
    expect(html).toContain('Not set')
    expect(html).not.toMatch(/Settings\.[a-zA-Z.]+/)
  })
})

describe('catalog values ship real characters', () => {
  test('no HTML entity survives in any message', () => {
    // next-intl hands the message to React as text — an entity left in a
    // value renders as "&rsquo;", literally, to the user.
    const values = JSON.stringify(CATALOG)
    expect(values).not.toMatch(/&(?:rsquo|lsquo|mdash|ndash|amp|quot|apos|nbsp|#\d+);/)
  })
})
