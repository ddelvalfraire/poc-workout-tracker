import { describe, expect, test } from 'vitest'
import { createTranslator } from 'next-intl'
import en from '../../../messages/en.json'
import { renderStaticIntl } from '../../../vitest.intl'
import type { TrophyRow } from '@/db/trophies'
import { emptyEvidence, trophyContextLine, trophyHint, trophyLabel } from '@/lib/goals/trophies'
import { TROPHY_KINDS, type TrophyKind } from '@/lib/goals/trophy-kinds'
import { displayToKg } from '@/lib/units'
import { LockedTrophyRow } from './page'

/**
 * The trophy case's copy contract. The page itself is an async server
 * component (auth + db), so the row that owns the surface's only
 * INTERPOLATED string — the progress bar's accessible name — is what gets
 * rendered here, through the real catalog.
 */

const evidence = { ...emptyEvidence(), completedCount: 25 }

describe('Trophies copy', () => {
  test('the progress bar names its percent and its trophy in one message', () => {
    const html = renderStaticIntl(
      <LockedTrophyRow kind="workouts_50" evidence={evidence} unit="kg" />,
    )
    expect(html).toContain('aria-valuenow="50"')
    expect(html).toContain('aria-label="50% toward 50 Workouts"')
  })

  test('no key path leaks into the markup', () => {
    const html = renderStaticIntl(
      <LockedTrophyRow kind="workouts_50" evidence={evidence} unit="kg" />,
    )
    expect(html).not.toMatch(/Trophies\.[a-zA-Z.]+/)
  })

  test('every locked kind renders a name and a hint, no key path anywhere', () => {
    for (const kind of TROPHY_KINDS) {
      const html = renderStaticIntl(
        <LockedTrophyRow kind={kind} evidence={emptyEvidence()} unit="lb" />,
      )
      expect(html, kind).not.toMatch(/Trophies\.[a-zA-Z.]+/)
    }
  })
})

/**
 * The trophy case's words, now that lib/trophies returns descriptors. This is
 * where the English is asserted; lib/trophies.test.ts asserts only which
 * message a kind earns and with which numbers.
 */
describe('Trophies copy, rendered from descriptors', () => {
  const t = createTranslator({ locale: 'en', messages: en, namespace: 'Trophies' })
  const say = (message: { key: string; values?: object }) =>
    t(message.key as never, message.values as never)

  const row = (kind: TrophyKind, context: TrophyRow['context']): TrophyRow => ({
    id: 't1',
    kind,
    achievedAt: new Date('2026-08-01T00:00:00Z'),
    context,
  })

  test('club names keep their lb culture and their lift name', () => {
    expect(say(trophyLabel('club_squat_315'))).toBe('315 Squat Club')
    expect(say(trophyLabel('club_ohp_135'))).toBe('135 OHP Club')
    expect(say(trophyLabel('club_1000'))).toBe('1,000 lb Club')
    expect(say(trophyLabel('block_complete'))).toBe('Block Complete')
    expect(say(trophyLabel('tonnage_2m'))).toBe('2M lb Lifted')
  })

  test('the count label reads its first-workout branch and its plural one', () => {
    expect(say(trophyLabel('workouts_1'))).toBe('First Workout')
    expect(say(trophyLabel('workouts_250'))).toBe('250 Workouts')
    expect(say(trophyLabel('streak_26'))).toBe('26-Week Streak')
  })

  test('context lines keep the literal hash and both count branches', () => {
    expect(say(trophyContextLine(row('club_squat_315', { e1rmKg: 143.79 }), 'lb')!)).toBe(
      'e1RM 317 lb',
    )
    // Ungrouped on purpose: the sum-club total always printed "1003.1".
    expect(say(trophyContextLine(row('club_1000', { e1rmKg: 455 }), 'lb')!)).toBe('Total 1003.1 lb')
    expect(say(trophyContextLine(row('workouts_1', { count: 1 }), 'lb')!)).toBe(
      'First session logged',
    )
    expect(say(trophyContextLine(row('workouts_50', { count: 50 }), 'lb')!)).toBe('Workout #50')
    expect(say(trophyContextLine(row('streak_4', { weeks: 4 }), 'kg')!)).toBe('4 consecutive weeks')
    expect(say(trophyContextLine(row('streak_4', { weeks: 1 }), 'kg')!)).toBe('1 consecutive week')
  })

  test('hints group their thousands and name the missing lifts', () => {
    const at285 = {
      ...emptyEvidence(),
      bestByLift: { squat: { e1rmKg: displayToKg(285, 'lb'), workoutId: 'w1' } },
    }
    expect(say(trophyHint('club_squat_315', at285, 'lb'))).toBe('285/315 lb — 30 lb to go')
    expect(say(trophyHint('club_deadlift_495', emptyEvidence(), 'lb'))).toBe('No Deadlift e1RM yet')
    expect(say(trophyHint('club_1000', at285, 'lb'))).toBe('Needs a Bench, Deadlift e1RM')
    expect(
      say(
        trophyHint(
          'tonnage_1m',
          { ...emptyEvidence(), tonnageKg: displayToKg(612_340, 'lb') },
          'lb',
        ),
      ),
    ).toBe('612,340/1,000,000 lb lifted')
    expect(say(trophyHint('block_complete', emptyEvidence(), 'lb'))).toBe('Start a program')
    expect(
      say(trophyHint('block_complete', { ...emptyEvidence(), hasActiveProgram: true }, 'lb')),
    ).toBe("Train every day of your program's final week")
  })

  test('every zone header resolves from the family alone', () => {
    expect(t('family.club')).toBe('Plate Clubs')
    expect(t('family.sum_club')).toBe('Totals')
    expect(t('family.count')).toBe('Showing Up')
    expect(t('family.streak')).toBe('Streaks')
    expect(t('family.block')).toBe('Blocks')
    expect(t('family.tonnage')).toBe('Tonnage')
  })

  test('the push copy names the trophy inside one message', () => {
    expect(t('push.title', { name: say(trophyLabel('club_squat_315')) })).toBe(
      'Trophy: 315 Squat Club',
    )
    expect(t('push.body')).toBe('Earned — see your trophies.')
  })
})
