// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { withIntl } from '../../../../vitest.intl'

/**
 * The builder's WIRING, driven rather than read.
 *
 * `program-builder.test.tsx` renders to a string, which proves the copy and
 * nothing else: a control whose handler was dropped in the view rewrite still
 * renders identically. Every assertion here presses something and checks what
 * the draft did about it, so an action that stops being dispatched fails a
 * test instead of a hand-review.
 *
 * The two disclosures need this especially. Both hide their panel with the
 * `hidden` ATTRIBUTE rather than unmounting it, so the settings copy is in the
 * static markup whether the toggle works or not — only pressing the row can
 * tell the difference.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/app/programs/actions', () => ({
  saveProgramAction: vi.fn(),
  updateProgramAction: vi.fn(),
}))
// The real picker owns a TanStack query and a catalog fetch, neither of which
// this file is about. The stub keeps the ONE thing that matters — the `onAdd`
// callback the builder hands it — so ADD_EXERCISE is still dispatched from a
// real press.
vi.mock('@/app/workout/new/exercise-picker', () => ({
  ExercisePicker: ({ onAdd }: { onAdd: (exercise: PickedStub) => void }) => (
    <button
      type="button"
      onClick={() =>
        onAdd({ wgerExerciseId: 1, source: 'wger', name: 'Back Squat', category: 'Legs' })
      }
    >
      stub add exercise
    </button>
  ),
}))

import { ProgramBuilder } from './program-builder'
import {
  buildStoredProgramDraft,
  emptyProgramDraft,
  newDraftProgramDay,
  newDraftProgramExercise,
  newDraftProgramSet,
  type DraftProgramExercise,
  type DraftProgramSet,
  type ProgramDraft,
} from './program-draft'

interface PickedStub {
  wgerExerciseId: number
  source: 'wger'
  name: string
  category: string
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

// The builder persists every keystroke to localStorage and restores from it on
// mount. A per-test in-memory store keeps that path REAL (so a broken persist
// still surfaces) while stopping one test's draft from seeding the next —
// they all share the `program-draft:new` slot.
const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function render(draft: ProgramDraft = emptyProgramDraft) {
  act(() => {
    root.render(withIntl(<ProgramBuilder unit="kg" initialDraft={draft} />))
  })
}

function click(element: Element | null | undefined) {
  expect(element, 'element to click').toBeTruthy()
  act(() => {
    element!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/** Types into a controlled input the way React hears it: the native value
 *  setter, then a bubbling `input` event. Assigning `.value` alone is
 *  swallowed by React's value tracker. */
function type(element: Element | null | undefined, value: string) {
  expect(element, 'element to type into').toBeTruthy()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(element, value)
    element!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const q = (selector: string) => container.querySelector(selector)
const all = (selector: string) => [...container.querySelectorAll(selector)]

/** The single volt at the bottom of the screen. */
function saveButton(): HTMLButtonElement {
  const button = all('button').find((b) => /^Save/.test(b.textContent ?? ''))
  expect(button, 'the Save button').toBeTruthy()
  return button as HTMLButtonElement
}

function buttonNamed(pattern: RegExp): HTMLButtonElement {
  const button = all('button').find((b) => pattern.test(b.textContent ?? ''))
  expect(button, `a button matching ${pattern}`).toBeTruthy()
  return button as HTMLButtonElement
}

/** The disclosure row whose label contains `text`. */
function disclosure(text: string): HTMLElement {
  const row = all('button[aria-expanded]').find((b) => b.textContent?.includes(text))
  expect(row, `the "${text}" disclosure`).toBeTruthy()
  return row as HTMLElement
}

function panelOf(row: HTMLElement): HTMLElement {
  return document.getElementById(row.getAttribute('aria-controls')!)!
}

/** A radio inside a `ChoiceList`, found by the words on its row. */
function choice(label: string): HTMLElement {
  const radio = all('[role="radio"]').find((r) =>
    r.closest('label')?.textContent?.startsWith(label),
  )
  expect(radio, `the "${label}" choice`).toBeTruthy()
  return radio as HTMLElement
}

function draftDay(name: string, exercises: DraftProgramExercise[] = []) {
  return { ...newDraftProgramDay(name), exercises }
}

function draftExercise(sets: DraftProgramSet[] = [newDraftProgramSet('reps_weight')]) {
  return {
    ...newDraftProgramExercise({
      wgerExerciseId: 1,
      source: 'wger' as const,
      name: 'Back Squat',
      category: 'Legs',
    }),
    sets,
  }
}

/** One day, one exercise, one set — the smallest shape the server accepts. */
function completeDraft(): ProgramDraft {
  return { ...emptyProgramDraft, days: [draftDay('Lower', [draftExercise()])] }
}

describe('the Save gate mirrors the server minimums', () => {
  it('is disabled with no days at all', () => {
    render()
    expect(saveButton().disabled).toBe(true)
  })

  it('is disabled while a day holds no exercises', () => {
    render({ ...emptyProgramDraft, days: [draftDay('Lower')] })
    expect(saveButton().disabled).toBe(true)
  })

  it('is disabled while an exercise holds no sets', () => {
    render({ ...emptyProgramDraft, days: [draftDay('Lower', [draftExercise([])])] })
    expect(saveButton().disabled).toBe(true)
  })

  it('is disabled when ONE of several days is empty, not just the first', () => {
    render({
      ...emptyProgramDraft,
      days: [draftDay('Lower', [draftExercise()]), draftDay('Upper')],
    })
    expect(saveButton().disabled).toBe(true)
  })

  it('enables once every day has an exercise and every exercise a set', () => {
    render(completeDraft())
    expect(saveButton().disabled).toBe(false)
  })

  it('follows the draft live: removing the last set re-disables it', () => {
    render(completeDraft())
    expect(saveButton().disabled).toBe(false)
    click(q('button[aria-label="Remove Back Squat set 1"]'))
    expect(saveButton().disabled).toBe(true)
  })
})

describe('the settings disclosure', () => {
  it('starts closed with its panel hidden, and opens on press', () => {
    render()
    const row = disclosure('Program settings')
    const panel = panelOf(row)
    expect(row.getAttribute('aria-expanded')).toBe('false')
    // The panel is in the DOM either way — which is exactly why the copy
    // tests cannot tell a working toggle from a broken one.
    expect(panel.textContent).toContain('Deload')
    expect(panel.hasAttribute('hidden')).toBe(true)

    click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(panel.hasAttribute('hidden')).toBe(false)

    click(row)
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(panel.hasAttribute('hidden')).toBe(true)
  })
})

describe('the per-day disclosure', () => {
  it('starts open — the builder is for editing — and collapses on press', () => {
    render(completeDraft())
    const row = disclosure('Day 1')
    const panel = panelOf(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(panel.hasAttribute('hidden')).toBe(false)

    click(row)
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(panel.hasAttribute('hidden')).toBe(true)
    // Collapsed, not unmounted: a half-typed load survives a stray press.
    expect(panel.querySelector('input[aria-label="Back Squat set 1 rep min"]')).not.toBeNull()
  })
})

describe('the day / exercise / set controls dispatch', () => {
  it('adds a day, and numbers the next one after it', () => {
    render()
    expect(q('button[aria-label="Remove day 1"]')).toBeNull()

    click(buttonNamed(/Add day/))
    expect(q('button[aria-label="Remove day 1"]')).not.toBeNull()

    click(buttonNamed(/Add day/))
    expect(q('button[aria-label="Remove day 2"]')).not.toBeNull()
  })

  it('removes a day', () => {
    render(completeDraft())
    click(q('button[aria-label="Remove day 1"]'))
    expect(q('button[aria-label="Remove day 1"]')).toBeNull()
    expect(container.textContent).toContain('Add a training day to start building your program.')
  })

  it('renames a day, which retitles the row', () => {
    render({ ...emptyProgramDraft, days: [draftDay('')] })
    expect(container.textContent).toContain('Nothing in it yet')
    type(q('input[aria-label="Day 1 name"]'), 'Push')
    expect(container.textContent).toContain('Day 1 · Push')
  })

  it('toggles a weekday on and back off', () => {
    render(completeDraft())
    const monday = () => q('button[aria-label="Monday"]')!
    expect(monday().getAttribute('aria-pressed')).toBe('false')
    click(monday())
    expect(monday().getAttribute('aria-pressed')).toBe('true')
    click(monday())
    expect(monday().getAttribute('aria-pressed')).toBe('false')
  })

  it('adds an exercise from the picker, and removes it again', () => {
    render({ ...emptyProgramDraft, days: [draftDay('Lower')] })
    expect(container.textContent).toContain('Search above to add an exercise to this day.')

    click(buttonNamed(/stub add exercise/))
    expect(q('button[aria-label="Remove Back Squat"]')).not.toBeNull()
    expect(container.textContent).toContain('1 movement')

    click(q('button[aria-label="Remove Back Squat"]'))
    expect(q('button[aria-label="Remove Back Squat"]')).toBeNull()
  })

  it('adds a set and removes a set', () => {
    render(completeDraft())
    expect(q('button[aria-label="Remove Back Squat set 2"]')).toBeNull()

    click(buttonNamed(/Add set/))
    expect(q('button[aria-label="Remove Back Squat set 2"]')).not.toBeNull()

    click(q('button[aria-label="Remove Back Squat set 2"]'))
    expect(q('button[aria-label="Remove Back Squat set 2"]')).toBeNull()
  })

  it('writes a set field back into the draft', () => {
    render(completeDraft())
    type(q('input[aria-label="Back Squat set 1 rep min"]'), '5')
    expect((q('input[aria-label="Back Squat set 1 rep min"]') as HTMLInputElement).value).toBe('5')
  })

  it('changes what an exercise measures through the metric-mode select', () => {
    render(completeDraft())
    // The reps × weight columns, before the flip.
    expect(container.textContent).toContain('Rep min')
    expect(q('input[aria-label="Back Squat set 1 duration, minutes and seconds"]')).toBeNull()

    click(q('button[aria-label="Tracking mode for Back Squat"]'))
    // Base UI portals the popup out of the container, so the options are
    // looked up on the document.
    const option = [...document.querySelectorAll('[role="option"]')].find(
      (o) => o.textContent === 'Duration',
    )
    expect(option, 'the Duration option').toBeTruthy()
    // Base UI commits the choice on the POINTER sequence, not a bare click.
    act(() => {
      for (const type of ['pointerdown', 'pointerup', 'click']) {
        option!.dispatchEvent(new MouseEvent(type, { bubbles: true }))
      }
    })

    // The mode is stamped onto every set of the slot, so the row swaps its
    // rep/load inputs for the cardio ones and the column headers follow.
    expect(q('input[aria-label="Back Squat set 1 duration, minutes and seconds"]')).not.toBeNull()
    expect(container.textContent).toContain('Time')
    expect(container.textContent).not.toContain('Rep min')
  })

  it('edits the training max of a TM-bearing scheme', () => {
    const exercise = {
      ...draftExercise(),
      progression: { scheme: 'percent-1rm' as const, trainingMaxKg: 100, weekPercents: [0.7] },
      trainingMax: '100',
      trainingMaxFromE1rm: true,
    }
    render({ ...emptyProgramDraft, days: [draftDay('Lower', [exercise])] })
    const tm = 'input[aria-label="Training max (kg) for Back Squat"]'
    expect(container.textContent).toContain('from your e1RM')
    type(q(tm), '120')
    expect((q(tm) as HTMLInputElement).value).toBe('120')
    // The prefill caption clears on the first user edit.
    expect(container.textContent).not.toContain('from your e1RM')
  })
})

describe('the program-level settings dispatch', () => {
  /** Opens the settings panel — every control below lives behind it. */
  function openSettings() {
    click(disclosure('Program settings'))
  }

  it('writes the week count and the deload week', () => {
    render(completeDraft())
    openSettings()
    type(q('input[aria-label="Program length in weeks"]'), '6')
    type(q('input[aria-label="Deload week"]'), '5')
    expect((q('input[aria-label="Program length in weeks"]') as HTMLInputElement).value).toBe('6')
    expect((q('input[aria-label="Deload week"]') as HTMLInputElement).value).toBe('5')
    // The summary reports the same numbers the panel now holds.
    expect(container.textContent).toContain('6 wk · deload wk 5')
  })

  it('writes the check-in cadence', () => {
    render(completeDraft())
    openSettings()
    type(q('input#check-in-every-days'), '7')
    expect((q('input#check-in-every-days') as HTMLInputElement).value).toBe('7')
  })

  it('picks a deload mode, which the summary reports too', () => {
    render(completeDraft())
    openSettings()
    expect(choice('None').getAttribute('aria-checked')).toBe('true')

    click(choice('Reactive'))
    expect(choice('Reactive').getAttribute('aria-checked')).toBe('true')
    expect(container.textContent).toContain('reactive deload')

    click(choice('Scheduled'))
    expect(choice('Scheduled').getAttribute('aria-checked')).toBe('true')
    // Scheduled reveals its read-only shape and the timed-exercise arm.
    expect(container.textContent).toContain('85% of the load · 50% of the sets')
    expect(container.textContent).toContain('Timed exercises on the deload week?')
  })

  it('picks the timed-exercise arm under Scheduled', () => {
    render(completeDraft())
    openSettings()
    click(choice('Scheduled'))
    click(choice('Scaled'))
    expect(choice('Scaled').getAttribute('aria-checked')).toBe('true')
  })

  it('picks a diet phase', () => {
    render(completeDraft())
    openSettings()
    click(choice('Cutting'))
    expect(choice('Cutting').getAttribute('aria-checked')).toBe('true')
  })

  it('flips auto-regulation, which hides the stall policy with it', () => {
    render(completeDraft())
    openSettings()
    const autoreg = () => all('[role="switch"]')[0]
    expect(autoreg().getAttribute('aria-checked')).toBe('true')
    expect(container.textContent).toContain('When does a session count as stalled?')
    expect(container.textContent).toContain('autoreg on')

    click(autoreg())
    expect(autoreg().getAttribute('aria-checked')).toBe('false')
    expect(container.textContent).not.toContain('When does a session count as stalled?')
    expect(container.textContent).toContain('autoreg off')
  })

  it('picks the stall policy', () => {
    render(completeDraft())
    openSettings()
    click(choice('Top set decides'))
    expect(choice('Top set decides').getAttribute('aria-checked')).toBe('true')
  })

  it('flips plan sync', () => {
    render(completeDraft())
    openSettings()
    const planSync = () => all('[role="switch"]')[1]
    expect(planSync().getAttribute('aria-checked')).toBe('true')
    click(planSync())
    expect(planSync().getAttribute('aria-checked')).toBe('false')
  })
})

describe('the interrupted-build restore', () => {
  function seedStoredDraft(draft: ProgramDraft) {
    store.set('program-draft:new', buildStoredProgramDraft(draft, new Date()))
  }

  it('restores the stored draft and says so', () => {
    seedStoredDraft({ ...completeDraft(), name: 'Volume Cut' })
    render()
    expect(container.textContent).toContain('Restored your unsaved draft.')
    expect(container.textContent).toContain('Volume Cut')
    expect(saveButton().disabled).toBe(false)
  })

  it('Discard drops the restored draft back to the seeded one, and clears storage', () => {
    seedStoredDraft({ ...completeDraft(), name: 'Volume Cut' })
    render()
    click(buttonNamed(/^Discard$/))
    expect(container.textContent).not.toContain('Restored your unsaved draft.')
    expect(container.textContent).not.toContain('Volume Cut')
    expect(saveButton().disabled).toBe(true)
    expect(store.has('program-draft:new')).toBe(false)
  })

  it('Keep dismisses the notice without touching the restored draft', () => {
    seedStoredDraft({ ...completeDraft(), name: 'Volume Cut' })
    render()
    click(buttonNamed(/^Keep$/))
    expect(container.textContent).not.toContain('Restored your unsaved draft.')
    expect(container.textContent).toContain('Volume Cut')
  })
})

describe('the title', () => {
  it('opens into a field and writes the program name', () => {
    render(completeDraft())
    click(q('button[aria-label="Program name"]'))
    type(q('input[aria-label="Program name"]'), 'Volume Cut')
    expect((q('input[aria-label="Program name"]') as HTMLInputElement).value).toBe('Volume Cut')
  })
})
