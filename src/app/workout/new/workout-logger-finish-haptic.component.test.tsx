// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withIntl } from '../../../../vitest.intl'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * The finish moment's haptic (the volt-budget jsdom idiom): saving a LIVE
 * session fires SESSION_COMPLETE_VIBRATION on handleSave's success path —
 * and only there. Edit-mode "Save changes" is paperwork (silent), and a
 * failed save must stay silent too: a buzz is a receipt, never a hope.
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
import { SESSION_COMPLETE_VIBRATION } from './haptics'
import type { WorkoutDraft } from './workout-draft'
import {
  getWorkoutDraftAction,
  saveWorkoutAction,
  updateWorkoutAction,
} from '@/app/workout/actions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

window.matchMedia = (() => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

/** One exercise, every set completed — Finish saves without the skip dialog. */
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

describe('finish haptic', () => {
  let container: HTMLDivElement
  let root: Root
  let vibrateSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(getWorkoutDraftAction).mockResolvedValue(null)
    vibrateSpy = vi.fn(() => true)
    // jsdom has no navigator.vibrate; installing one makes haptics.vibrate's
    // feature detection pass so the call is observable.
    Object.defineProperty(navigator, 'vibrate', { value: vibrateSpy, configurable: true })
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
              title="New Workout"
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

  it('buzzes the session pattern when a live finish saves successfully', async () => {
    vi.mocked(saveWorkoutAction).mockResolvedValue({ id: 'w-new' })
    mount()
    await act(async () => {
      primaryCta(/Finish workout/).click()
    })
    expect(vibrateSpy).toHaveBeenCalledWith(SESSION_COMPLETE_VIBRATION)
  })

  it('stays silent when the save fails', async () => {
    vi.mocked(saveWorkoutAction).mockRejectedValue(new Error('offline'))
    mount()
    await act(async () => {
      primaryCta(/Finish workout/).click()
    })
    expect(vibrateSpy).not.toHaveBeenCalled()
  })

  it('stays silent for an edit-mode "Save changes" — corrections are not a finish', async () => {
    vi.mocked(updateWorkoutAction).mockResolvedValue({ id: 'w1' })
    mount({ workoutId: 'w1', isLive: false })
    await act(async () => {
      primaryCta(/Save changes/).click()
    })
    expect(vibrateSpy).not.toHaveBeenCalled()
  })
})
