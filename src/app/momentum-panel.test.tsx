import { describe, expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from 'next-intl'
import messages from '../../messages/en.json'
import { MomentumPanel, type MomentumPanelProps } from './momentum-panel'

/**
 * The panel is a self-fetching async Server Component, so its readers are
 * stubbed and its element is awaited before rendering. What these pin is the
 * copy: the set unit and the goal heading were both `count === 1 ? … : …`
 * ternaries, which have no correct translation in a language with more than
 * two plural forms — each is asserted at one AND at many, separately.
 *
 * `next-intl/server` is mocked the same way `vitest.setup.ts` mocks the
 * client entry: next-intl's OWN createTranslator over the REAL en.json, so a
 * key missing from the catalog still fails loudly.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace?: string) =>
    createTranslator({ locale: 'en', messages, namespace } as Parameters<
      typeof createTranslator
    >[0]),
}))

vi.mock('@/db/workouts', () => ({ listWorkoutSummaries: async () => [] }))
vi.mock('@/db/preferences', () => ({ getWeightUnit: async () => 'kg' }))
vi.mock('@/lib/goal-progress', () => ({
  goalLabel: () => 'Squat 140 kg',
  weeklyStreak: () => 0,
}))

let weekSets = 1
let previousWeekSets = 0
let weekSessions = 1
let activeGoalCount = 0

vi.mock('@/db/muscle-volume', () => ({
  getRollingVolumeTotals: async () => ({
    currentSets: weekSets,
    previousSets: previousWeekSets,
    currentSessions: weekSessions,
    currentCardioSec: 0,
    previousCardioSec: 0,
  }),
}))

vi.mock('@/lib/goals', () => ({
  getGoalsHomeSummary: async () =>
    activeGoalCount === 0
      ? null
      : { activeCount: activeGoalCount, topGoal: { kind: 'strength' }, streak: null },
}))

async function render(over: {
  sets: number
  previous?: number
  sessions?: number
  goals?: number
  size?: MomentumPanelProps['size']
}) {
  weekSets = over.sets
  previousWeekSets = over.previous ?? 0
  weekSessions = over.sessions ?? 1
  activeGoalCount = over.goals ?? 1
  const element = await MomentumPanel({ userId: 'user_123', nowMs: 0, size: over.size ?? 'md' })
  return renderToStaticMarkup(element)
}

describe('MomentumPanel copy', () => {
  test('reads the singular set form on a one-set week', async () => {
    const html = await render({ sets: 1 })

    expect(html).toContain('>set<')
    expect(html).not.toContain('>sets<')
  })

  test('reads the plural set form on a multi-set week', async () => {
    expect(await render({ sets: 12 })).toContain('>sets<')
  })

  test('reads the singular goal heading with one active goal', async () => {
    const html = await render({ sets: 12, goals: 1 })

    expect(html).toContain('>Goal<')
    expect(html).not.toContain('Goals ·')
  })

  test('counts the goals in the heading once there is more than one', async () => {
    expect(await render({ sets: 12, goals: 3 })).toContain('Goals · 3')
  })

  test('invites a session instead of showing a hollow zero', async () => {
    expect(await render({ sets: 0 })).toContain('The week is wide open — log a session.')
  })

  // The sessions subline and the week-over-week line are DECIDED in
  // lib/home-status.ts as descriptors and rendered here.
  test('counts the sessions in the week at one and at many', async () => {
    expect(await render({ sets: 12 })).toContain('1 session this week')
    expect(await render({ sets: 12, sessions: 3 })).toContain('3 sessions this week')
  })

  test('states the week-over-week direction on the large panel', async () => {
    expect(await render({ sets: 20, previous: 12, size: 'lg' })).toContain('Up 8 on last week')
    expect(await render({ sets: 9, previous: 12, size: 'lg' })).toContain('Down 3 on last week')
    expect(await render({ sets: 12, previous: 12, size: 'lg' })).toContain('Level with last week')
  })

  test('stays silent about last week when last week logged nothing', async () => {
    expect(await render({ sets: 20, previous: 0, size: 'lg' })).not.toContain('on last week')
  })

  test('resolves every key it references', async () => {
    expect(await render({ sets: 12, goals: 2 })).not.toMatch(/MomentumPanel\.[a-zA-Z.]+/)
    expect(await render({ sets: 20, previous: 12, size: 'lg' })).not.toMatch(
      /MomentumPanel\.[a-zA-Z.]+/,
    )
  })
})
