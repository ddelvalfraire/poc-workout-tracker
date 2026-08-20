import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { useTranslations } from 'next-intl'
import { renderStaticIntl } from '../../../vitest.intl'

/**
 * /body is an async server component (auth, storage signing, getTranslations),
 * so a unit test cannot render it. Two things are checked instead: every key
 * path the source asks for exists — a missing one renders as its own literal
 * path — and the messages it interpolates are resolved for real, because a
 * drifted argument name is invisible to a key-space check.
 *
 * The trend line's direction is an ICU select and its chart label an ICU
 * plural; both are exercised at every branch, since either reads correctly
 * at exactly one input and wrongly at the rest.
 */

const CATALOG = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en.json'), 'utf8'),
) as Record<string, unknown>

function resolve(path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => {
    if (typeof node !== 'object' || node === null) return undefined
    return (node as Record<string, unknown>)[part]
  }, CATALOG)
}

function requestedKeys(file: string): string[] {
  const source = readFileSync(join(process.cwd(), file), 'utf8')
  return [...source.matchAll(/\bt(?:\.rich)?\('([^']+)'/g)].map((m) => m[1])
}

function DeltaProbe({ direction }: { direction: string }) {
  const t = useTranslations('Body')
  return <p>{t('bodyweight.deltaSummary', { direction, value: 1.2, unit: 'lb', days: 30 })}</p>
}

function ChartProbe({ count }: { count: number }) {
  const t = useTranslations('Body')
  return <p>{t('bodyweight.chartLabel', { from: 82.1, to: 81.4, unit: 'kg', count })}</p>
}

function LineProbe() {
  const t = useTranslations('Body')
  return (
    <ul>
      <li>{t('bodyweight.rawReading', { value: 81.4, unit: 'kg', date: 'Jan 2' })}</li>
      <li>{t('bodyweight.showAll', { count: 12 })}</li>
      <li>{t('bodyweight.weightValue', { value: 81.4, unit: 'kg' })}</li>
    </ul>
  )
}

describe('/body copy contract', () => {
  test('asks the catalog for keys it actually has', () => {
    const missing = requestedKeys('src/app/body/page.tsx').filter(
      (key) => typeof resolve(`Body.${key}`) !== 'string',
    )
    expect(missing).toEqual([])
  })

  test('reads at least one key (the scan is not silently matching nothing)', () => {
    expect(requestedKeys('src/app/body/page.tsx').length).toBeGreaterThan(0)
  })
})

describe('Body trend messages', () => {
  test('the delta line renders every direction branch', () => {
    expect(renderStaticIntl(<DeltaProbe direction="down" />)).toContain(
      'Trending down — 1.2 lb / 30d',
    )
    expect(renderStaticIntl(<DeltaProbe direction="up" />)).toContain('Trending up — 1.2 lb / 30d')
    expect(renderStaticIntl(<DeltaProbe direction="steady" />)).toContain('Holding steady / 30d')
  })

  test('the chart label pluralises its entry count at both branches', () => {
    expect(renderStaticIntl(<ChartProbe count={1} />)).toContain(
      'Bodyweight trend, 82.1 to 81.4 kg over 1 entry',
    )
    expect(renderStaticIntl(<ChartProbe count={9} />)).toContain(
      'Bodyweight trend, 82.1 to 81.4 kg over 9 entries',
    )
  })

  test('the status and history lines fill their arguments', () => {
    const html = renderStaticIntl(<LineProbe />)
    expect(html).toContain('Last weigh-in 81.4 kg · Jan 2')
    expect(html).toContain('All weigh-ins · 12')
    expect(html).toContain('81.4 kg')
    expect(html).not.toMatch(/Body\.[a-zA-Z.]+/)
  })
})
