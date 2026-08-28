// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withIntl } from '../../../../vitest.intl'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * "Use plan as written" must undo the WHOLE adjustment it labels.
 *
 * A cutting stall adjusts in two ways — it holds the load and it drops
 * working sets (lib/autoregulate.ts `partitionVolumeCut`). The escape used to
 * revert only the ghosts, so it announced "Using plan as written." over a
 * plan that was still one set short (#313 review, M1). The rows the cut
 * removed ride into the logger as `planAutoreg[key].trimmedTargets`, and
 * reverting restores them: a row per trimmed target, wearing that target's
 * ghost.
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
import { getWorkoutDraftAction } from '@/app/workout/actions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

window.matchMedia = (() => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

const KEY = 'wger:73'

/** The trimmed session: the cut left two of the plan's three working sets. */
function draft(rows = 2): WorkoutDraft {
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
        sets: Array.from({ length: rows }, (_, i) => ({
          id: `s${i + 1}`,
          reps: '',
          weight: '',
          completed: false,
          tag: 'working' as const,
        })),
      },
    ],
  }
}

/** A surviving set: held at 100, the plan wrote 102.5. */
const HELD = { repMin: 5, repMax: null, loadKg: 100, planLoadKg: 102.5, restSec: null }
/** The dropped row as the PLAN wrote it — never the held load. */
const TRIMMED = { repMin: 5, repMax: null, loadKg: 102.5, restSec: null }

describe('autoreg revert restores a cutting volume cut', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getWorkoutDraftAction).mockResolvedValue(null)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function mount(trimmedTargets?: (typeof TRIMMED)[], rows = 2) {
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
    act(() => {
      root.render(
        withIntl(
          <QueryClientProvider client={client}>
            <WorkoutLogger
              title="New Workout"
              closeHref="/"
              initialDraft={draft(rows)}
              planTargets={{ [KEY]: [HELD, HELD] }}
              planAutoreg={{
                [KEY]: {
                  reason: "Hold 100 kg — 2 sets instead of 3 while you're cutting",
                  suggestEarlyDeload: true,
                  phaseContext: 'cutting',
                  ...(trimmedTargets ? { trimmedTargets } : {}),
                },
              }}
            />
          </QueryClientProvider>,
        ),
      )
    })
  }

  const weightInputs = () =>
    [...container.querySelectorAll('input')].filter((i) =>
      (i.getAttribute('aria-label') ?? '').toLowerCase().includes('weight'),
    )

  function clickRevert() {
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Use plan as written',
    )
    expect(button).toBeDefined()
    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  it('re-adds a row per trimmed set and gives it the plan ghost', () => {
    // Arrange — the plan wrote three sets; the cut seeded two.
    mount([TRIMMED])
    expect(weightInputs()).toHaveLength(2)

    // Act
    clickRevert()

    // Assert — the plan's third set is back, and every row ghosts the plan's
    // 102.5 rather than the held 100.
    const inputs = weightInputs()
    expect(inputs).toHaveLength(3)
    expect(inputs.map((i) => i.getAttribute('placeholder'))).toEqual(['102.5', '102.5', '102.5'])
    expect(container.textContent).toContain('Using plan as written.')
  })

  it('ghosts a restored row even without the revert flag — a reload keeps rows, not state', () => {
    // The flag lives in component state; the rows it added are persisted in
    // the draft. After a reload the row is there and the flag is not, so the
    // trimmed target must ghost it anyway or the set comes back blank.
    mount([TRIMMED], 3)
    expect(weightInputs().map((i) => i.getAttribute('placeholder'))).toEqual([
      '100',
      '100',
      '102.5',
    ])
  })

  it('adds nothing when the verdict trimmed nothing (load-only adjustments)', () => {
    mount()
    clickRevert()
    expect(weightInputs()).toHaveLength(2)
    expect(container.textContent).toContain('Using plan as written.')
  })
})
