import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { useTranslations } from 'next-intl'

/**
 * Guards the test harness itself (vitest.setup.ts), not app code.
 *
 * The harness mocks next-intl so components render without a provider. An
 * earlier version was a bare key lookup: it returned the raw ICU pattern
 * instead of the formatted string and had no `t.rich`, so a test asserting on
 * translated copy could pass or fail for reasons unrelated to the component
 * under test — and the first person to test an interpolated component would
 * have burned an afternoon on it. These pin what made that dangerous.
 */

function Interpolated() {
  const t = useTranslations('GoalCreate')
  return <span>{t('bodyweightLabel', { unit: 'kg' })}</span>
}

function Plural({ target }: { target: number }) {
  const t = useTranslations('ConsistencyProgress')
  return <span>{t('progressSummary', { completed: 1, target })}</span>
}

function HasRich() {
  const t = useTranslations('Common')
  return <span>{typeof t.rich === 'function' ? 'has-rich' : 'no-rich'}</span>
}

describe('next-intl test harness', () => {
  test('interpolates values instead of returning the raw ICU pattern', () => {
    // Arrange / Act
    const html = renderToStaticMarkup(<Interpolated />)

    // Assert — a lookup stub renders the literal "{unit}".
    expect(html).toContain('kg')
    expect(html).not.toContain('{unit}')
  })

  test('selects the right plural branch', () => {
    // Arrange / Act
    const one = renderToStaticMarkup(<Plural target={1} />)
    const many = renderToStaticMarkup(<Plural target={3} />)

    // Assert — real ICU picks one/other; a stub returns the same pattern twice.
    expect(one).not.toEqual(many)
    expect(one).not.toContain('plural,')
  })

  test('exposes t.rich, which several components use for embedded markup', () => {
    // A bare (key) => string stub has no .rich, and those components throw.
    expect(renderToStaticMarkup(<HasRich />)).toContain('has-rich')
  })
})
