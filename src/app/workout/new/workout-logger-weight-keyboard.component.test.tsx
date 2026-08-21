// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withIntl } from '../../../../vitest.intl'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Arrow-key stepping on the weight input — the ± rail's keyboard equal.
 *
 * Why this exists as its own contract rather than as coverage of the rail:
 * the rail is UNREACHABLE by keyboard, structurally. It is focus-gated on
 * the weight input, so the first Tab away unmounts it before focus could
 * land; and it docks in the sticky bar, nowhere near this field in DOM
 * order. Its buttons are still reachable by AT on touch (explore, then
 * double-tap, which the rail's pointerdown preventDefault survives), so they
 * are not dead — but a keyboard user had no way to step at all until these
 * arrows existed.
 *
 * The load-bearing part is that both paths call the SAME stepWeightValue.
 * These tests pin the shared semantics from the keyboard side — the 0 floor,
 * the step-from-empty, the refusal to clobber non-numeric text — so the two
 * cannot drift into stepping differently.
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

/** kg so the step is the kg step (2.5); the app's own default is lb. */
function draft(weight: string): WorkoutDraft {
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
        sets: [{ id: 's1', reps: '', weight, completed: false, tag: 'working' }],
      },
    ],
  }
}

describe('weight input arrow stepping', () => {
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

  function mount(weight: string): HTMLInputElement {
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
    act(() => {
      root.render(
        withIntl(
          <QueryClientProvider client={client}>
            <WorkoutLogger
              title="New Workout"
              closeHref="/"
              initialDraft={draft(weight)}
              unit="kg"
            />
          </QueryClientProvider>,
        ),
      )
    })
    const input = container.querySelector('#weight-input-s1')
    if (!(input instanceof HTMLInputElement)) throw new Error('weight input not found')
    return input
  }

  const press = (input: HTMLInputElement, key: string) =>
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })

  it('ArrowUp steps a typed weight up by the unit step', () => {
    const input = mount('100')
    press(input, 'ArrowUp')
    expect(input.value).toBe('102.5')
  })

  it('ArrowDown steps back down, so the pair round-trips', () => {
    const input = mount('100')
    press(input, 'ArrowUp')
    press(input, 'ArrowDown')
    expect(input.value).toBe('100')
  })

  it('steps from zero when the field is empty and there is no ghost to adopt', () => {
    const input = mount('')
    press(input, 'ArrowUp')
    expect(input.value).toBe('2.5')
  })

  it('floors at 0 rather than going negative', () => {
    const input = mount('2.5')
    press(input, 'ArrowDown')
    expect(input.value).toBe('0')
    press(input, 'ArrowDown')
    expect(input.value).toBe('0')
  })

  it('refuses to clobber non-numeric text', () => {
    // stepWeightValue returns null here; the keystroke must be a no-op rather
    // than replacing what the user typed with a number.
    const input = mount('bodyweight')
    press(input, 'ArrowUp')
    expect(input.value).toBe('bodyweight')
  })

  it('announces the shortcut, which is its only discoverability', () => {
    const input = mount('100')
    expect(input.getAttribute('aria-keyshortcuts')).toBe('ArrowUp ArrowDown')
  })

  it('keeps the rail out of the tab sequence but not out of the a11y tree', () => {
    // The spinbutton split: the input is the keyboard control, the rail is the
    // pointer half. tabIndex={-1} states that rather than leaving it to the
    // focus gating to enforce by accident — and it must NOT become
    // aria-hidden, because AT on touch still reaches these by explore-then-
    // double-tap, and the labels are what make that usable.
    const input = mount('100')
    act(() => input.focus())
    const rail = Array.from(document.querySelectorAll('[aria-label]')).filter((el) =>
      /^(increase|decrease) set 1/i.test(el.getAttribute('aria-label') ?? ''),
    )
    expect(rail).toHaveLength(2)
    for (const control of rail) {
      expect(control.getAttribute('tabindex')).toBe('-1')
      expect(control.closest('[aria-hidden="true"]')).toBeNull()
    }
  })

  it('still hands Enter back to the blur-to-dismiss path', () => {
    // Enter shares the handler with the arrows; the early return for it must
    // survive them.
    const input = mount('100')
    input.focus()
    expect(document.activeElement).toBe(input)
    press(input, 'Enter')
    expect(document.activeElement).not.toBe(input)
    expect(input.value).toBe('100')
  })
})
