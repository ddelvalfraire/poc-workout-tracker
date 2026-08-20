// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withIntl } from '../../../../vitest.intl'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * The volt-budget contract while the note capture sheet is open, verified
 * interactively (the persist-notes jsdom idiom): with the busiest sticky-bar
 * state conceivable, opening the sheet must MUTE the bar (opacity +
 * desaturation via the data-volt-muted container) so the sheet's Save is the
 * screen's only live accent — a mechanism, not a layout coincidence. Also
 * pins the note-dot's legibility recipe (bg-primary + ring-background halo)
 * on BOTH completed and uncompleted rows.
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

const LONG_PRESS_MS = 500

/** Two sets: s1 noted + completed, s2 noted + NOT completed (the legibility pair). */
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
          {
            id: 's1',
            reps: '5',
            weight: '100',
            completed: true,
            tag: 'working',
            note: 'strong rep',
            noteClientKey: 'ck-1',
          },
          {
            id: 's2',
            reps: '',
            weight: '',
            completed: false,
            tag: 'working',
            note: 'watch the knee',
            noteClientKey: 'ck-2',
          },
        ],
      },
    ],
  }
}

const DOT_SELECTOR = '.bg-primary.ring-2.ring-background'

function pointer(type: string, target: Element, x = 50, y = 50) {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }),
  )
}

describe('note capture volt budget + dot legibility', () => {
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

  function openCaptureSheet() {
    const row = document.getElementById('set-row-s2')!
    act(() => {
      pointer('pointerdown', row)
      vi.advanceTimersByTime(LONG_PRESS_MS + 10)
    })
    act(() => pointer('pointerup', row))
    const addNote = Array.from(document.querySelectorAll('button')).find((b) =>
      /^(Add note|Note · view)$/.test(b.textContent?.trim() ?? ''),
    )!
    expect(addNote).toBeTruthy()
    act(() => addNote.click())
  }

  it('mutes the sticky bar while the sheet is open — Save is the only live volt', () => {
    // Arrange — bar unmuted at rest
    expect(document.querySelector('[data-volt-muted]')).toBeNull()

    // Act
    openCaptureSheet()

    // Assert — the bar container recedes…
    const muted = document.querySelector('[data-volt-muted]')!
    expect(muted).toBeTruthy()
    expect(muted.className).toContain('opacity-50')
    expect(muted.className).toContain('saturate-50')
    // …and the sheet (with its Save) renders OUTSIDE the muted container, so
    // its volt is the screen's only un-muted accent.
    const sheet = document.querySelector('[aria-label^="Note for"]')!
    expect(sheet).toBeTruthy()
    expect(muted.contains(sheet)).toBe(false)
  })

  it('restores the bar the moment the sheet closes (empty body = silent close)', () => {
    openCaptureSheet()
    expect(document.querySelector('[data-volt-muted]')).toBeTruthy()

    // Act — Escape with an empty body closes silently (journal semantics)
    const textarea = document.querySelector('textarea[aria-label="Note text"]')!
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
    })

    // Assert
    expect(document.querySelector('[aria-label^="Note for"]')).toBeNull()
    expect(document.querySelector('[data-volt-muted]')).toBeNull()
  })

  it('renders the note dot with its ring-background halo on completed AND uncompleted rows', () => {
    const doneRow = document.getElementById('set-row-s1')!
    const liveRow = document.getElementById('set-row-s2')!
    // The halo (ring-background) is the legibility mechanism: it separates
    // the volt dot from whatever sits behind it — the volt-filled done
    // circle and the dark live row alike.
    expect(doneRow.querySelector(DOT_SELECTOR)).toBeTruthy()
    expect(liveRow.querySelector(DOT_SELECTOR)).toBeTruthy()
  })
})
