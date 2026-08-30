import { describe, expect, test } from 'vitest'
import { createTranslator } from 'next-intl'

import en from '../../../messages/en.json'
import { goalLabel, paceVsDeadline, type GoalLabelMessage } from '@/lib/goals/goal-progress'

/**
 * The goals surface's words, now that lib/goal-progress returns DESCRIPTORS.
 * goal-progress.test.ts asserts which message a goal earns and with what
 * numbers; this file is the other half — the same descriptors resolved
 * against the REAL catalog, the only place a missing key, a renamed argument
 * or an unpluralised branch actually shows itself.
 *
 * The page is an async Server Component behind auth and four database reads,
 * so it cannot be rendered here; the copy it interpolates can.
 */
const t = createTranslator({ locale: 'en', messages: en, namespace: 'Goals' })

const say = (message: GoalLabelMessage) => t(message.key as never, message.values as never)

describe('goal labels, rendered from descriptors', () => {
  test('each kind reads as one sentence in the display unit', () => {
    expect(
      say(goalLabel({ kind: 'strength', target: { e1rmKg: 142.88 }, exerciseName: 'Squat' }, 'lb')),
    ).toBe('Squat 315 lb')
    expect(
      say(
        goalLabel(
          { kind: 'bodyweight', target: { weightKg: 80, direction: 'down' }, exerciseName: null },
          'kg',
        ),
      ),
    ).toBe('Bodyweight 80 kg')
    expect(
      say(
        goalLabel(
          {
            kind: 'consistency',
            target: { targetWeeks: 8, allowedMissesPerWeek: 1 },
            exerciseName: null,
          },
          'kg',
        ),
      ),
    ).toBe('8-week streak')
  })

  test('the exercise name is an argument, so a custom name passes through whole', () => {
    expect(
      say(
        goalLabel({ kind: 'strength', target: { e1rmKg: 100 }, exerciseName: 'Nordic Curl' }, 'kg'),
      ),
    ).toBe('Nordic Curl 100 kg')
    expect(
      say(goalLabel({ kind: 'strength', target: { e1rmKg: 100 }, exerciseName: null }, 'kg')),
    ).toBe('Exercise 100 kg')
  })

  test('a corrupt pairing renders the quiet fallback, not a key path', () => {
    const rendered = say(
      goalLabel(
        {
          kind: 'strength',
          target: { targetWeeks: 8, allowedMissesPerWeek: 1 },
          exerciseName: null,
        },
        'kg',
      ),
    )
    expect(rendered).toBe('Goal')
    expect(rendered).not.toMatch(/Goals\.[a-zA-Z.]+/)
  })
})

describe('the pace sentence, rendered from the verdict', () => {
  const projected = new Date(2026, 9, 12) // Oct 12, local midnight
  const date = 'Oct 12, 2026'

  /** Mirrors the page's paceSentence: one whole message, never a suffix. */
  function paceSentence(deadline: string | null): string {
    const verdict = paceVsDeadline(projected, deadline)
    return verdict === null ? t('pace', { date }) : t(verdict.key, { date, ...verdict.values })
  }

  test('reads the plain sentence when there is no deadline to judge against', () => {
    expect(paceSentence(null)).toBe('On pace for Oct 12, 2026')
    expect(paceSentence('2026-10-15')).toBe('On pace for Oct 12, 2026')
  })

  test('promotes to early at one week and at several', () => {
    expect(paceSentence('2026-10-19')).toBe('On pace for Oct 12, 2026 — 1 week early')
    expect(paceSentence('2026-11-02')).toBe('On pace for Oct 12, 2026 — 3 weeks early')
  })

  test('promotes to late at one week and at several', () => {
    expect(paceSentence('2026-10-05')).toBe('On pace for Oct 12, 2026 — 1 week late')
    expect(paceSentence('2026-09-14')).toBe('On pace for Oct 12, 2026 — 4 weeks late')
  })

  test('no pace sentence can leak a key path', () => {
    const all = ['2026-10-19', '2026-09-14', '2026-10-15', null].map(paceSentence).join(' ')
    expect(all).not.toMatch(/Goals\.[a-zA-Z.]+/)
  })
})

describe('the rest of the goals copy that carries numbers', () => {
  test('the best-e1RM line and the trend chart name resolve', () => {
    expect(t('bestValue', { value: 142.5, unit: 'kg' })).toBe('Best 142.5 kg')
    expect(t('trendChartAriaLabel', { count: 1, target: 80, unit: 'kg' })).toBe(
      'Bodyweight trend over 1 entry against the 80 kg target',
    )
    expect(t('trendChartAriaLabel', { count: 30, target: 80, unit: 'kg' })).toBe(
      'Bodyweight trend over 30 entries against the 80 kg target',
    )
  })

  test('the push copy names the goal inside one message', () => {
    const name = say(
      goalLabel({ kind: 'strength', target: { e1rmKg: 142.88 }, exerciseName: 'Squat' }, 'lb'),
    )
    expect(t('push.title', { name })).toBe('Goal reached: Squat 315 lb')
    expect(t('push.body')).toBe('Target hit — see your goals.')
  })
})
