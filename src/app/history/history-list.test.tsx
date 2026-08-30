import { describe, expect, test, vi } from 'vitest'
import { renderStaticIntl } from '../../../vitest.intl'
import type { WorkoutSummary } from '@/db/workouts'
import { HistoryList } from './history-list'

/**
 * The row's meta line and the Repeat control's accessible name are the copy
 * this list owns. The set count used to be `${w.setCount} set${... ? '' : 's'}`
 * — two hard-coded forms — so it is asserted at one AND at many, separately.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}))

function workout(over: Partial<WorkoutSummary> = {}): WorkoutSummary {
  return {
    id: 'w1',
    name: 'Push A',
    startedAt: new Date('2026-03-04T10:00:00Z'),
    completedAt: new Date('2026-03-04T11:00:00Z'),
    exerciseCount: 2,
    setCount: 3,
    completedSetCount: 3,
    volumeKg: 1000,
    ...over,
  }
}

const render = (w: WorkoutSummary) =>
  renderStaticIntl(<HistoryList workouts={[w]} unit="kg" guardSession={null} />)

describe('HistoryList copy', () => {
  test('reads the singular set form on a one-set session', () => {
    const html = render(workout({ setCount: 1 }))

    expect(html).toContain('1 set')
    expect(html).not.toContain('1 sets')
  })

  test('reads the plural set form on a multi-set session', () => {
    expect(render(workout({ setCount: 3 }))).toContain('3 sets')
  })

  test('names the Repeat control after the session it repeats', () => {
    expect(render(workout())).toContain('aria-label="Repeat Push A"')
  })

  test('falls back to the untitled-workout name in the row and its label', () => {
    expect(render(workout({ name: null }))).toContain('aria-label="Repeat Workout"')
  })

  test('resolves every key it references', () => {
    expect(render(workout())).not.toMatch(/HistoryList\.[a-zA-Z.]+/)
  })
})
