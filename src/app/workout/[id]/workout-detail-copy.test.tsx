import { describe, expect, it } from 'vitest'
import { renderStaticIntl } from '../../../../vitest.intl'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

/**
 * The detail page is an async Server Component wired to five db reads, so it
 * cannot be rendered here — and it does not need to be for KEY existence:
 * next-intl's generated key types make a wrong key path a compile error, and
 * `npx tsc --noEmit` is the gate for that.
 *
 * What types cannot check is the SHAPE of a message: whether a plural covers
 * both branches, and whether a rich message still carries its tag. So these
 * replay the page's own calls — same keys, same argument names — through the
 * REAL catalog (vitest.intl feeds the shipped en.json).
 */

/** A key path leaking into the output means the catalog is missing that message. */
const UNRESOLVED = /WorkoutDetail\.[a-zA-Z.]+/

function Probe({ render }: { render: (t: ReturnType<typeof useTranslations>) => ReactNode }) {
  const t = useTranslations('WorkoutDetail')
  return <>{render(t)}</>
}

const html = (render: (t: ReturnType<typeof useTranslations>) => ReactNode) =>
  renderStaticIntl(<Probe render={render} />)

describe('WorkoutDetail plurals', () => {
  it('labels the set tile at one and at many', () => {
    expect(html((t) => t('stats.sets', { count: 1 }))).toContain('Set')
    expect(html((t) => t('stats.sets', { count: 1 }))).not.toContain('Sets')
    expect(html((t) => t('stats.sets', { count: 4 }))).toContain('Sets')
  })

  it('titles reached goals at one and at many', () => {
    expect(html((t) => t('goals.title', { count: 1 }))).toContain('Goal reached')
    expect(html((t) => t('goals.title', { count: 1 }))).not.toContain('Goals reached')
    expect(html((t) => t('goals.title', { count: 3 }))).toContain('Goals reached')
  })

  it('titles earned trophies at one and at many', () => {
    expect(html((t) => t('trophies.title', { count: 1 }))).toContain('Trophy earned')
    expect(html((t) => t('trophies.title', { count: 1 }))).not.toContain('Trophies earned')
    expect(html((t) => t('trophies.title', { count: 2 }))).toContain('Trophies earned')
  })

  it('words small PR counts and numbers larger ones', () => {
    expect(html((t) => t('headline.prs', { count: 2 }))).toContain('Two PRs.')
    expect(html((t) => t('headline.prs', { count: 5 }))).toContain('Five PRs.')
    expect(html((t) => t('headline.prs', { count: 7 }))).toContain('7 PRs.')
  })
})

describe('WorkoutDetail rich messages', () => {
  it('keeps the PR e1RM tilde inside its aria-hidden tag', () => {
    const out = html((t) =>
      t.rich('complete.prE1rm', {
        value: '142.5 kg',
        delta: 5,
        approx: (chunks) => <span aria-hidden="true">{chunks}</span>,
      }),
    )

    expect(out).toContain('<span aria-hidden="true">~</span>')
    expect(out).toContain('142.5 kg e1RM (+5)')
    expect(out).not.toMatch(UNRESOLVED)
  })

  it('renders the meta line with both of its tags around real content', () => {
    const out = html((t) =>
      t.rich('meta.summary', {
        date: 'Mon 3 Mar',
        week: 7,
        separator: (chunks) => <span aria-hidden="true">{chunks}</span>,
        weekLabel: (chunks) => <span className="week">{chunks}</span>,
      }),
    )

    expect(out).toContain('Mon 3 Mar')
    expect(out).toContain('<span aria-hidden="true">·</span>')
    expect(out).toContain('<span class="week">Week 7</span>')
    expect(out).not.toMatch(UNRESOLVED)
  })
})

describe('WorkoutDetail argument-carrying messages', () => {
  it('names the comparison and the goal-progress readout', () => {
    expect(html((t) => t('comparisonCaption', { name: 'Lower A' }))).toContain('vs last Lower A')
    expect(
      html((t) =>
        t('goalProgress.summary', { exercise: 'Bench', current: '100 kg', target: '120 kg' }),
      ),
    ).toContain('Bench · 100 kg of 120 kg')
    expect(html((t) => t('exercise.setAriaLabel', { number: 3 }))).toContain('Set 3')
    expect(html((t) => t('exercise.repsValue', { reps: 12 }))).toContain('12 reps')
    expect(html((t) => t('headline.blockClosed', { week: 7 }))).toContain('Week 7 closed.')
    expect(html((t) => t('complete.prReps', { reps: 8, delta: 2 }))).toContain('8 reps (+2)')
  })
})
