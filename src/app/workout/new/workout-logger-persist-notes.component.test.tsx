// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withIntl } from '../../../../vitest.intl'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * The persistSetNotes CALL-ORDER contract, interactively (the
 * weight-stepper.component.test.tsx jsdom idiom): both save branches invoke
 * the batch create AFTER a server workout id exists — the create path with
 * the id saveWorkoutAction just returned, the update path with the standing
 * workoutId after updateWorkoutAction's full replace. The orchestration
 * itself (success/downgrade/replay) is unit-tested in note-capture.test.ts;
 * this file pins WHERE the logger calls it.
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
  saveWorkoutAction,
  updateWorkoutAction,
  getWorkoutDraftAction,
  putWorkoutDraftAction,
  deleteWorkoutDraftAction,
} from '@/app/workout/actions'
import { createSetNotesForWorkoutAction } from '@/app/notes/actions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

window.matchMedia = (() => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

const KEY = '01234567-89ab-cdef-0123-456789abcdef'
const SAVED_ID = 'aaaa4567-89ab-cdef-0123-456789abcdef'
const EDIT_ID = 'bbbb4567-89ab-cdef-0123-456789abcdef'

function notedDraft(): WorkoutDraft {
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
          {
            id: 's1',
            reps: '5',
            weight: '100',
            completed: true,
            tag: 'working',
            note: 'left shoulder clicked',
            noteClientKey: KEY,
          },
        ],
      },
    ],
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  vi.clearAllMocks()
  // The mount restore effect awaits this; a bare vi.fn() would crash .then.
  vi.mocked(getWorkoutDraftAction).mockResolvedValue(null)
  vi.mocked(putWorkoutDraftAction).mockResolvedValue(undefined as never)
  vi.mocked(deleteWorkoutDraftAction).mockResolvedValue(undefined as never)
  vi.mocked(createSetNotesForWorkoutAction).mockResolvedValue(undefined as never)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderLogger(props: Partial<Parameters<typeof WorkoutLogger>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
  root = createRoot(container)
  act(() => {
    root.render(
      withIntl(
        <QueryClientProvider client={client}>
          <WorkoutLogger
            title="Log Workout"
            closeHref="/"
            initialDraft={notedDraft()}
            {...props}
          />
        </QueryClientProvider>,
      ),
    )
  })
}

async function clickPrimary(label: RegExp) {
  const button = Array.from(container.querySelectorAll('button')).find((b) =>
    label.test(b.textContent ?? ''),
  )
  expect(button).toBeDefined()
  await act(async () => {
    button!.click()
  })
  // Drain the save's remaining microtasks (settle → save → notes → nav).
  await act(async () => {})
}

describe('persistSetNotes call order in the logger', () => {
  it('create path (Finish): the batch runs AFTER save, with the id the save returned', async () => {
    const order: string[] = []
    vi.mocked(saveWorkoutAction).mockImplementation(async () => {
      order.push('save')
      return { id: SAVED_ID }
    })
    vi.mocked(createSetNotesForWorkoutAction).mockImplementation(async () => {
      order.push('notes')
    })

    renderLogger()
    await clickPrimary(/Finish workout/)

    expect(order).toEqual(['save', 'notes'])
    expect(createSetNotesForWorkoutAction).toHaveBeenCalledWith(SAVED_ID, [
      expect.objectContaining({
        exercisePosition: 0,
        setNumber: 1,
        body: 'left shoulder clicked',
        clientKey: KEY,
      }),
    ])
  })

  it('update path (Save changes): the batch runs AFTER the full replace, with the standing workoutId', async () => {
    const order: string[] = []
    vi.mocked(updateWorkoutAction).mockImplementation(async () => {
      order.push('update')
      return undefined as never
    })
    vi.mocked(createSetNotesForWorkoutAction).mockImplementation(async () => {
      order.push('notes')
    })

    renderLogger({ workoutId: EDIT_ID, isLive: false })
    await clickPrimary(/Save changes/)

    expect(order).toEqual(['update', 'notes'])
    expect(saveWorkoutAction).not.toHaveBeenCalled()
    expect(createSetNotesForWorkoutAction).toHaveBeenCalledWith(EDIT_ID, [
      expect.objectContaining({ exercisePosition: 0, setNumber: 1, clientKey: KEY }),
    ])
  })
})
