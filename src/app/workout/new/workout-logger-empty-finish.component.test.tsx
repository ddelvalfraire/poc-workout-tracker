// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withIntl } from '../../../../vitest.intl'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * The empty-finish guard. A program day is a real workout row from the moment
 * it is instantiated — every set pre-seeded with its prescribed load and no
 * reps — so Finish on a session nobody logged into used to persist that prefill
 * as a completed workout: plan weights recorded as performance, scoring nothing
 * while counting as done. Finish must instead offer the honest outcome.
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
import {
  getWorkoutDraftAction,
  saveWorkoutAction,
  updateWorkoutAction,
  deleteWorkoutAction,
} from '@/app/workout/actions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

window.matchMedia = (() => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

/** Exactly what `instantiateProgramDay` seeds: prescribed load, no reps,
 *  nothing checked off. The corruption's input. */
function untouchedProgramDay(): WorkoutDraft {
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
          { id: 's1', reps: '', weight: '122.47', completed: false, tag: 'working' },
          { id: 's2', reps: '', weight: '122.47', completed: false, tag: 'working' },
        ],
      },
    ],
  }
}

/** The same session after one set was actually logged. */
function partiallyLogged(): WorkoutDraft {
  const draft = untouchedProgramDay()
  draft.exercises[0].sets[0].reps = '6'
  return draft
}

describe('finishing a session with nothing logged', () => {
  let container: HTMLDivElement
  let root: Root
  // jsdom implements neither; the app's dialog idiom (session-conflict-dialog)
  // stands them in with the `open` attribute they would set.
  const originalShowModal = HTMLDialogElement.prototype.showModal
  const originalClose = HTMLDialogElement.prototype.close

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getWorkoutDraftAction).mockResolvedValue(null)
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    HTMLDialogElement.prototype.showModal = originalShowModal
    HTMLDialogElement.prototype.close = originalClose
  })

  function mount(draft: WorkoutDraft) {
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
    act(() => {
      root.render(
        withIntl(
          <QueryClientProvider client={client}>
            <WorkoutLogger
              title="Legs A"
              closeHref="/"
              workoutId="w1"
              isLive
              initialDraft={draft}
            />
          </QueryClientProvider>,
        ),
      )
    })
  }

  function clickFinish() {
    const button = Array.from(document.querySelectorAll('button')).find((b) =>
      /Finish workout/.test(b.textContent ?? ''),
    )
    expect(button).toBeTruthy()
    act(() => (button as HTMLButtonElement).click())
  }

  const dialogText = () => document.querySelector('dialog')?.textContent ?? ''

  it('does not save — it asks, naming the plan weights for what they are', () => {
    mount(untouchedProgramDay())
    clickFinish()

    expect(saveWorkoutAction).not.toHaveBeenCalled()
    expect(updateWorkoutAction).not.toHaveBeenCalled()
    expect(dialogText()).toContain('Nothing logged yet')
    expect(dialogText()).toContain('not what you lifted')
  })

  it('offers discard as the action and logging as the way out', () => {
    mount(untouchedProgramDay())
    clickFinish()

    const labels = Array.from(document.querySelectorAll('dialog button')).map((b) => b.textContent)
    expect(labels).toContain('Discard')
    expect(labels).toContain('Log my sets')
    // The skipped-sets dialog's affirmative Finish must not be reachable here:
    // there is nothing to finish.
    expect(labels).not.toContain('Finish')
  })

  it('backing out leaves the session intact — nothing saved, nothing deleted', () => {
    mount(untouchedProgramDay())
    clickFinish()

    const keep = Array.from(document.querySelectorAll('dialog button')).find(
      (b) => b.textContent === 'Log my sets',
    )
    act(() => (keep as HTMLButtonElement).click())

    expect(document.querySelector('dialog')).toBeNull()
    expect(deleteWorkoutAction).not.toHaveBeenCalled()
    expect(updateWorkoutAction).not.toHaveBeenCalled()
  })

  it('confirming discards the session rather than recording it', async () => {
    vi.mocked(deleteWorkoutAction).mockResolvedValue(undefined as never)
    mount(untouchedProgramDay())
    clickFinish()

    const discard = Array.from(document.querySelectorAll('dialog button')).find(
      (b) => b.textContent === 'Discard',
    )
    await act(async () => (discard as HTMLButtonElement).click())

    expect(deleteWorkoutAction).toHaveBeenCalledWith('w1')
    // The whole point: the prefill never reaches the database as performance.
    expect(updateWorkoutAction).not.toHaveBeenCalled()
    expect(saveWorkoutAction).not.toHaveBeenCalled()
  })

  it('speaks accurately for a quick-log session, which has no program plan', () => {
    // The gate is not program-only: an ad-hoc session whose sets were never
    // filled in reaches it too, and the copy must not claim a plan that does
    // not exist.
    mount(untouchedProgramDay())
    clickFinish()

    expect(dialogText()).toContain('Any weights already filled in are targets')
    expect(dialogText()).not.toContain('program')
  })

  it('still finishes normally once a single set carries reps', () => {
    mount(partiallyLogged())
    clickFinish()

    // One logged set, one blank: the ordinary skipped-sets warning, not the
    // abandonment gate — the session has real work in it.
    expect(dialogText()).toContain('Finish workout?')
    expect(dialogText()).not.toContain('Nothing logged yet')
  })
})
