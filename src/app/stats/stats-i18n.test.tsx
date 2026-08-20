import { describe, expect, test } from 'vitest'
import { createTranslator, useTranslations } from 'next-intl'

import en from '../../../messages/en.json'
import { renderStaticIntl } from '../../../vitest.intl'
import { PlanBulletList } from './plan-bullet-list'
import { WindowToggle } from './window-toggle'

/**
 * Copy contract for /stats. The page itself is a Server Component behind two
 * database reads, so its messages are asserted through the REAL catalog and
 * through probe components that call the same keys the page calls — the point
 * is that the key exists, the ICU parses, and every plural has been written
 * for both categories.
 */

const t = (namespace: 'Stats' | 'PlanBulletList' | 'WindowToggle') =>
  createTranslator({ locale: 'en', messages: en, namespace })

/** Renders `lowNotice` exactly as the page does — a rich message whose copy
 *  contains a bare `<` before an argument, which must survive ICU parsing. */
function LowNoticeProbe() {
  const stats = useTranslations('Stats')
  return (
    <p>
      {stats.rich('lowNotice', {
        floor: 10,
        groups: 'Chest, Back',
        lead: (chunks) => <span className="font-semibold">{chunks}</span>,
      })}
    </p>
  )
}

describe('Stats verdict copy', () => {
  const stats = t('Stats')

  test('headlines resolve, and the muscle group stays an argument', () => {
    expect(stats('verdict.noPlanTitle')).toBe('No plan set.')
    expect(stats('verdict.onPlanTitle')).toBe('On plan.')
    expect(stats('verdict.behindTitle', { group: 'Back' })).toBe('Back is behind.')
  })

  test('the no-plan context pluralises the week total', () => {
    expect(stats('verdict.noPlanContext', { sets: 1 })).toBe('1 set this week')
    expect(stats('verdict.noPlanContext', { sets: 24 })).toBe('24 sets this week')
  })

  test('the signed no-plan variants are whole messages, both plural forms', () => {
    expect(stats('verdict.noPlanContextUp', { sets: 1, amount: 1 })).toBe(
      '1 set this week · +1 vs last week',
    )
    expect(stats('verdict.noPlanContextUp', { sets: 24, amount: 6 })).toBe(
      '24 sets this week · +6 vs last week',
    )
    expect(stats('verdict.noPlanContextDown', { sets: 1, amount: 2 })).toBe(
      '1 set this week · −2 vs last week',
    )
    expect(stats('verdict.noPlanContextDown', { sets: 12, amount: 8 })).toBe(
      '12 sets this week · −8 vs last week',
    )
  })

  test('days-left variants pluralise the day count', () => {
    expect(stats('verdict.onPlanContext')).toBe('Every planned group at its weekly target')
    expect(stats('verdict.onPlanContextDays', { days: 1 })).toBe(
      'Every planned group at its weekly target · 1 day left this week',
    )
    expect(stats('verdict.onPlanContextDays', { days: 2 })).toBe(
      'Every planned group at its weekly target · 2 days left this week',
    )
    expect(stats('verdict.behindContext', { performed: 6, planned: 12 })).toBe(
      '6 of 12 planned sets',
    )
    expect(stats('verdict.behindContextDays', { performed: 6, planned: 12, days: 1 })).toBe(
      '6 of 12 planned sets · 1 day left this week',
    )
    expect(stats('verdict.behindContextDays', { performed: 6, planned: 12, days: 3 })).toBe(
      '6 of 12 planned sets · 3 days left this week',
    )
  })
})

describe('Stats totals and notices', () => {
  const stats = t('Stats')

  test('tile labels and the two signed delta messages resolve', () => {
    expect(stats('totals.setsLabel')).toBe('Sets')
    expect(stats('totals.sessionsLabel')).toBe('Sessions')
    expect(stats('totals.cardioLabel')).toBe('Cardio')
    expect(stats('totals.cardioUnit')).toBe('min')
    expect(stats('totals.setsDeltaUp', { amount: 6 })).toBe('+6 vs last week')
    expect(stats('totals.setsDeltaDown', { amount: 8 })).toBe('−8 vs last week')
    expect(stats('totals.cardioDelta', { minutes: 45 })).toBe('vs 45 min last week')
  })

  test('the low-volume notice renders its emphasis tag and its bare "<"', () => {
    const html = renderStaticIntl(<LowNoticeProbe />)
    expect(html).toContain('<span class="font-semibold">Low this week (&lt;10 sets):</span>')
    expect(html).toContain('Chest, Back')
    expect(html).not.toMatch(/Stats\.[a-zA-Z.]+/)
  })

  test('the over-plan notice and both group hints resolve', () => {
    expect(stats('overPlanNotice', { groups: 'Chest 18 / 10' })).toBe(
      'Well over plan: Chest 18 / 10',
    )
    expect(stats('groups.hint')).toBe('Primary muscles count a full set, secondaries half.')
    expect(stats('groups.hintPlanned', { program: 'PPL' })).toContain(
      "one full pass through PPL's days",
    )
    // The planned variant repeats the base sentence whole, so a translator can
    // move it rather than receiving two glued fragments.
    expect(stats('groups.hintPlanned', { program: 'PPL' })).toContain(
      'Primary muscles count a full set, secondaries half.',
    )
  })

  test('the page-level headings and empty state resolve', () => {
    expect(stats('title')).toBe('This Week')
    expect(stats('empty')).toContain('No completed sets in the last two weeks')
    expect(stats('verdict.ariaLabel')).toBe('Week verdict')
    expect(stats('totals.ariaLabel')).toBe('Weekly totals')
    expect(stats('groups.ariaLabel')).toBe('Sets per muscle group')
    expect(stats('groups.title')).toBe('Sets per muscle group')
  })
})

describe('PlanBulletList', () => {
  const rows = [
    { group: 'Chest' as const, currentSets: 8, previousSets: 4, plannedSets: 12 },
    { group: 'Back' as const, currentSets: 3, previousSets: 0, plannedSets: 0 },
  ]

  test('rows resolve their numbers through the catalog', () => {
    const html = renderStaticIntl(<PlanBulletList rows={rows} />)
    expect(html).toContain('8 / 12 sets')
    expect(html).toContain('3 sets · no target')
  })

  test('no unresolved key path reaches the markup', () => {
    const html = renderStaticIntl(<PlanBulletList rows={rows} />)
    expect(html).not.toMatch(/PlanBulletList\.[a-zA-Z.]+/)
  })
})

describe('WindowToggle', () => {
  test('both window labels resolve at render, not at module scope', () => {
    const html = renderStaticIntl(<WindowToggle mode="rolling" />)
    expect(html).toContain('Last 7 days')
    expect(html).toContain('This week')
    expect(html).toContain('aria-label="Week window"')
  })

  test('no unresolved key path reaches the markup', () => {
    const html = renderStaticIntl(<WindowToggle mode="calendar" />)
    expect(html).not.toMatch(/WindowToggle\.[a-zA-Z.]+/)
  })
})
