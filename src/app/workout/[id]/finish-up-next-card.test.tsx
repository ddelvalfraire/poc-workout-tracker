import { describe, expect, it } from 'vitest'
import { renderStaticIntl } from '../../../../vitest.intl'
import { FinishUpNextCard } from './finish-up-next-card'
import type { NextProgramDay } from '@/db/programs'

/**
 * Copy tests for the finish card: both of its variants resolve through the
 * REAL en.json (vitest.intl feeds the shipped catalog), and both of its ICU
 * plurals are pinned at one AND at many — a plural asserted at a single
 * value looks right there and is wrong everywhere else.
 */

/** A key path leaking into the output means the catalog is missing that message. */
const UNRESOLVED = /FinishUpNextCard\.[a-zA-Z.]+/

const day = (over: Partial<NextProgramDay> = {}): NextProgramDay =>
  ({
    programId: 'p1',
    programName: 'Bridge',
    dayId: 'd1',
    dayName: 'Lower A',
    week: 3,
    weekdays: [],
    exerciseNames: ['Squat', 'RDL'],
    mesocycleWeeks: 4,
    ...over,
  }) as NextProgramDay

describe('FinishUpNextCard copy', () => {
  it('renders the block-complete variant from the catalog', () => {
    const html = renderStaticIntl(
      <FinishUpNextCard state={{ kind: 'block-complete', next: day() }} />,
    )

    expect(html).toContain('Block complete')
    expect(html).toContain('See results')
    expect(html).not.toMatch(UNRESOLVED)
  })

  it('counts mesocycle weeks in both plural branches', () => {
    const one = renderStaticIntl(
      <FinishUpNextCard state={{ kind: 'block-complete', next: day({ mesocycleWeeks: 1 }) }} />,
    )
    const many = renderStaticIntl(
      <FinishUpNextCard state={{ kind: 'block-complete', next: day({ mesocycleWeeks: 6 }) }} />,
    )

    expect(one).toContain('Every week trained · 1 week')
    expect(one).not.toContain('1 weeks')
    expect(many).toContain('Every week trained · 6 weeks')
  })

  it('renders the up-next variant, week anchor included', () => {
    const html = renderStaticIntl(
      <FinishUpNextCard state={{ kind: 'next-day', next: day({ week: 7 }) }} />,
    )

    expect(html).toContain('Up next · Week 7')
    expect(html).toContain('Start when ready')
    expect(html).not.toMatch(UNRESOLVED)
  })

  it('counts exercises in both plural branches', () => {
    const one = renderStaticIntl(
      <FinishUpNextCard state={{ kind: 'next-day', next: day({ exerciseNames: ['Squat'] }) }} />,
    )
    const many = renderStaticIntl(
      <FinishUpNextCard
        state={{ kind: 'next-day', next: day({ exerciseNames: ['Squat', 'RDL', 'Leg curl'] }) }}
      />,
    )

    expect(one).toContain('1 exercise · Bridge')
    expect(one).not.toContain('1 exercises')
    expect(many).toContain('3 exercises · Bridge')
  })
})
