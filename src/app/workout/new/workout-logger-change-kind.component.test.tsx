// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withIntl } from '../../../../vitest.intl'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * WHAT the save means, declared at the only place that knows: the logger.
 *
 * Both of the logger's update-mode saves reach the SAME server action, and
 * they mean opposite things — finishing an instantiated program day is that
 * session's ORIGINAL persist, while edit mode's "Save changes" contradicts a
 * session already on the record (an AMENDMENT). The server can tell them
 * apart from nothing in the payload, and deriving it from `completedAt` is
 * exactly the inference the change log exists to replace. So the kind rides
 * the call, and these pin it: before this, every live program finish was
 * written into the log as a correction of itself.
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

import { WorkoutLogger } from './workout-logger'
import type { WorkoutDraft } from './workout-draft'
import { getWorkoutDraftAction, updateWorkoutAction } from '@/app/workout/actions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

window.matchMedia = (() => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

/** One exercise, every set completed — the CTA saves without the skip dialog. */
function completedDraft(): WorkoutDraft {
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
        sets: [{ id: 's1', reps: '5', weight: '100', completed: true, tag: 'working' }],
      },
    ],
  }
}

describe('declared change kind', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(getWorkoutDraftAction).mockResolvedValue(null)
    vi.mocked(updateWorkoutAction).mockResolvedValue({ id: 'w1' })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  function mount(props: Partial<Parameters<typeof WorkoutLogger>[0]> = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
    act(() => {
      root.render(
        withIntl(
          <QueryClientProvider client={client}>
            <WorkoutLogger
              title="Squat Day"
              closeHref="/"
              initialDraft={completedDraft()}
              {...props}
            />
          </QueryClientProvider>,
        ),
      )
    })
  }

  /** The sticky bar's primary CTA ("Finish workout" live, "Save changes" edit). */
  function primaryCta(label: RegExp): HTMLButtonElement {
    const button = Array.from(document.querySelectorAll('button')).find((b) =>
      label.test(b.textContent ?? ''),
    )
    expect(button).toBeTruthy()
    return button as HTMLButtonElement
  }

  it("declares a live program day's finish as the session original", async () => {
    // Arrange — an instantiated program day: it already has a row, and this
    // save is its first real record of what happened.
    mount({ workoutId: 'w1', isLive: true })

    // Act
    await act(async () => {
      primaryCta(/Finish workout/).click()
    })

    // Assert
    expect(updateWorkoutAction).toHaveBeenCalledWith('w1', expect.anything(), 'original')
  })

  it('declares an edit-mode save as an amendment', async () => {
    // Arrange — the same action, reached from the correction surface.
    mount({ workoutId: 'w1', isLive: false })

    // Act
    await act(async () => {
      primaryCta(/Save changes/).click()
    })

    // Assert
    expect(updateWorkoutAction).toHaveBeenCalledWith('w1', expect.anything(), 'amendment')
  })
})
