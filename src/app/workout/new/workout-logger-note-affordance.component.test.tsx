// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withIntl } from '../../../../vitest.intl'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * The exercise header's note button, verified INTERACTIVELY (the
 * volt-budget/persist-notes jsdom idiom). The static render tests pin what the
 * rail looks like; only these pin what pressing it does — and "the roll-up is
 * a control, not inert metadata" is a claim about behaviour, so a markup
 * assertion that the count is a `<button>` cannot carry it. Reroute the
 * handler and every static test still passes.
 *
 * The second test is the one with teeth. The button is always rendered, so it
 * can be pressed while the editor below is already open — and a plain press
 * would blur the Textarea, whose onBlur closes the editor, before the click
 * handler reopens it: same words, remounted node, caret thrown to the end
 * mid-sentence. The fix is the toolbar-button pattern (preventDefault on
 * mousedown so focus never leaves the field), which is invisible in markup and
 * only provable by replaying the real event order.
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

/** One exercise, nothing noted — the state where the button is the entry. */
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
        sets: [{ id: 's1', reps: '5', weight: '100', completed: false, tag: 'working' }],
      },
    ],
  }
}

const NOTE_BUTTON = 'button[aria-label^="Add note for Squat"]'
const EDITOR = 'textarea[aria-label="Notes for Squat"]'

describe('the exercise header note button', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
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
  })

  /** The real browser order for a press: mousedown (which moves focus unless
   *  the handler prevents it), then click. `.click()` alone fires neither, so
   *  it would let the focus-steal bug pass unnoticed. */
  function press(button: Element) {
    act(() => {
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      button.dispatchEvent(down)
      if (!down.defaultPrevented) (button as HTMLElement).focus()
      ;(button as HTMLElement).click()
    })
  }

  it('opens this session’s note editor — the count is a control, not a label', () => {
    // Arrange — the editor is closed on an unnoted exercise.
    expect(document.querySelector(EDITOR)).toBeNull()
    const button = document.querySelector(NOTE_BUTTON)
    expect(button).toBeTruthy()

    // Act
    press(button!)

    // Assert
    expect(document.querySelector(EDITOR)).toBeTruthy()
  })

  it('leaves an open editor — and its caret — untouched when pressed again', () => {
    press(document.querySelector(NOTE_BUTTON)!)
    const editor = document.querySelector(EDITOR) as HTMLTextAreaElement
    act(() => editor.focus())
    expect(document.activeElement).toBe(editor)

    // Act — press the header button mid-edit.
    press(document.querySelector(NOTE_BUTTON)!)

    // Assert — the SAME node, still focused. A remount would swap the node and
    // (with autoFocus) drop the caret at the end of what was typed.
    expect(document.contains(editor)).toBe(true)
    expect(document.querySelector(EDITOR)).toBe(editor)
    expect(document.activeElement).toBe(editor)
  })
})
