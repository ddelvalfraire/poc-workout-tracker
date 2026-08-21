// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withIntl } from '../../../../vitest.intl'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Wiring contract for the rest-over notification's CANCEL path (the module's
 * own behavior is unit-tested in rest-over-alert.test.ts; here the alert
 * module is mocked): the logger must retire a posted notification at both
 * moments the rest period ends by action — Skip on the pill, and the next
 * set's check-off — so a stale "Rest over" never lingers on the lock screen
 * while the user is already lifting again.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/app/workout/actions', () => ({
  saveWorkoutAction: vi.fn(),
  updateWorkoutAction: vi.fn(),
  deleteWorkoutAction: vi.fn(),
  getLastPerformanceAction: vi.fn(),
  getExerciseBestAction: vi.fn(),
  substitutePlanTargetsAction: vi.fn(),
  rememberSwapAction: vi.fn(),
  getWorkoutDraftAction: vi.fn(),
  putWorkoutDraftAction: vi.fn(),
  deleteWorkoutDraftAction: vi.fn(),
}))

vi.mock('@/app/notes/actions', () => ({
  createNoteAction: vi.fn(),
  createFallbackSetNoteAction: vi.fn(),
  createSetNotesForWorkoutAction: vi.fn(),
}))

vi.mock('./rest-over-alert', () => ({
  fireRestOverAlert: vi.fn(),
  clearRestOverNotification: vi.fn(),
}))

import { WorkoutLogger } from './workout-logger'
import type { WorkoutDraft } from './workout-draft'
import { getWorkoutDraftAction } from '@/app/workout/actions'
import { clearRestOverNotification } from './rest-over-alert'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

window.matchMedia = (() => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

/** One exercise, two filled uncompleted sets — the weight guard must pass so
 *  a circle tap actually completes and starts a rest period. */
function draft(): WorkoutDraft {
  return {
    notes: '',
    exercises: [
      {
        id: 'ex1',
        wgerExerciseId: 73,
        source: 'wger',
        name: 'Squat',
        category: 'Legs',
        loggingType: 'weight_reps',
        notes: '',
        skipped: false,
        sets: [
          { id: 's1', reps: '5', weight: '100', completed: false, tag: 'working' },
          { id: 's2', reps: '5', weight: '100', completed: false, tag: 'working' },
        ],
      },
    ],
  }
}

function checkOffFirstSet() {
  const circle = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Mark set 1 complete"]',
  )!
  expect(circle).toBeTruthy()
  act(() => circle.click())
}

describe('rest-over notification cancel wiring', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(getWorkoutDraftAction).mockResolvedValue(null)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
    act(() => {
      root.render(
        withIntl(
          <QueryClientProvider client={client}>
            <WorkoutLogger title="New Workout" closeHref="/" initialDraft={draft()} />
          </QueryClientProvider>,
        ),
      )
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('a set check-off (the next set starting) retires the posted notification', () => {
    // Arrange — nothing retired yet
    expect(clearRestOverNotification).not.toHaveBeenCalled()

    // Act
    checkOffFirstSet()

    // Assert — the check-off path cleared (and started the new rest period:
    // the pill is up, proving this was the completion branch, not a no-op).
    expect(clearRestOverNotification).toHaveBeenCalledTimes(1)
    expect(document.querySelector('button[aria-label="Skip rest"]')).toBeTruthy()
  })

  it('skipping rest retires it too', () => {
    // Arrange — a running rest period (its check-off cleared once already)
    checkOffFirstSet()
    const skip = document.querySelector<HTMLButtonElement>('button[aria-label="Skip rest"]')!
    expect(skip).toBeTruthy()

    // Act
    act(() => skip.click())

    // Assert — the skip path cleared again, and the period ended (pill gone).
    expect(clearRestOverNotification).toHaveBeenCalledTimes(2)
    expect(document.querySelector('button[aria-label="Skip rest"]')).toBeNull()
  })

  it('unchecking a set is a correction — it does not touch the notification', () => {
    // Arrange
    checkOffFirstSet()
    vi.mocked(clearRestOverNotification).mockClear()

    // Act — tap the same circle back off
    const circle = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Mark set 1 incomplete"]',
    )!
    expect(circle).toBeTruthy()
    act(() => circle.click())

    // Assert
    expect(clearRestOverNotification).not.toHaveBeenCalled()
  })
})
