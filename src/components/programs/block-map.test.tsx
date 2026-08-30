import { describe, expect, test } from 'vitest'
import { renderStaticIntl } from '../../../vitest.intl'
import { BlockMap } from './block-map'
import type { BlockWeek } from './block-weeks'

/**
 * The segment label is ONE ICU message with five `select` arguments, not a
 * list of English fragments joined with ", ". These pin every branch: a
 * translator who reorders or re-punctuates the clauses must still be able to,
 * and a dropped argument would silently shorten the only accessible name a
 * week segment has.
 */

const week = (over: Partial<BlockWeek> = {}): BlockWeek => ({
  week: 3,
  dayCountDone: 2,
  dayCountTotal: 4,
  isDeload: false,
  isCurrent: false,
  ...over,
})

describe('BlockMap copy', () => {
  test('names the week and its day progress', () => {
    const html = renderStaticIntl(<BlockMap weeks={[week()]} />)

    expect(html).toContain('Week 3, 2 of 4 days done')
  })

  test('drops the day clause when the week has no days planned', () => {
    const html = renderStaticIntl(<BlockMap weeks={[week({ dayCountTotal: 0 })]} />)

    expect(html).toContain('aria-label="Week 3"')
    expect(html).not.toContain('days done')
  })

  test('appends the deload and current-week clauses only when they apply', () => {
    const plain = renderStaticIntl(<BlockMap weeks={[week()]} />)
    const marked = renderStaticIntl(
      <BlockMap weeks={[week({ isDeload: true, isCurrent: true })]} />,
    )

    expect(plain).not.toContain('deload')
    expect(plain).not.toContain('current week')
    expect(marked).toContain('deload')
    expect(marked).toContain('current week')
  })

  test('marks the browsed week as selected', () => {
    const html = renderStaticIntl(
      <BlockMap weeks={[week()]} selectedWeek={3} hrefForWeek={(w) => `?week=${w}`} />,
    )

    expect(html).toContain('selected')
  })

  test('renders the deload badge at the default size', () => {
    const html = renderStaticIntl(<BlockMap weeks={[week({ isDeload: true })]} size="default" />)

    expect(html).toContain('DL')
  })

  test('resolves every key it references', () => {
    const html = renderStaticIntl(
      <BlockMap weeks={[week({ isDeload: true, isCurrent: true })]} size="default" />,
    )

    expect(html).not.toMatch(/BlockMap\.[a-zA-Z.]+/)
  })
})
