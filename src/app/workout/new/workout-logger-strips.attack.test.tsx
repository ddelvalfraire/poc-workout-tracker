// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * ADVERSARIAL VERIFICATION — jsdom interaction attacks (the
 * weight-stepper.component.test.tsx idiom) on:
 *
 * - the undo stack's behavioral contracts that predate SessionToast (#234's
 *   "stacking semantics, Undo (n), restore order unchanged" claim):
 *   REPLACE-then-REMOVE of the same slot, LIFO restore, count honesty;
 * - pendingRemember's no-timer persistence and block/undo coexistence;
 * - pin-as-promotion seeding (#211): "opens QuickCapture seeded from the
 *   session text" (PR #235) — attacked with and without an existing identity
 *   note;
 * - the echo's tap-to-copy while the editor is ALREADY open.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

window.matchMedia = (() => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

// All async server actions resolve harmlessly: the mount-time draft restore
// gets null (nothing to restore), autosave puts succeed silently.
vi.mock('@/app/workout/actions', () => ({
  saveWorkoutAction: vi.fn(async () => ({ id: 'w1' })),
  updateWorkoutAction: vi.fn(async () => undefined),
  deleteWorkoutAction: vi.fn(async () => undefined),
  getLastPerformanceAction: vi.fn(async () => null),
  getExerciseBestAction: vi.fn(async () => null),
  substitutePlanTargetsAction: vi.fn(async () => null),
  rememberSwapAction: vi.fn(async () => undefined),
  getWorkoutDraftAction: vi.fn(async () => null),
  putWorkoutDraftAction: vi.fn(async () => undefined),
  deleteWorkoutDraftAction: vi.fn(async () => undefined),
}))

vi.mock('@/app/exercises/actions', () => ({
  upsertExerciseNoteAction: vi.fn(async () => ({ body: 'saved', pinned: true })),
  deleteExerciseNoteAction: vi.fn(async () => undefined),
}))

// The QuickCapture sheet loads via next/dynamic; the mock records the props
// the logger seeds it with — the promotion contract under attack.
const quickCaptureProps: Array<Record<string, unknown>> = []
vi.mock('@/components/editor/quick-capture-sheet', () => ({
  QuickCaptureSheet: (props: Record<string, unknown>) => {
    quickCaptureProps.push(props)
    return <div data-testid="quick-capture-sheet" />
  },
}))

import { WorkoutLogger } from './workout-logger'
import { PENDING_PICK_KEY } from './pending-pick'
import type { WorkoutDraft } from './workout-draft'
import type { LastPerformance } from '@/db/workouts'

/** Squat with two UNCOMPLETED sets — replace must not trip the logged-work guard. */
function cleanDraft(): WorkoutDraft {
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
          { id: 's1', reps: '', weight: '', completed: false, tag: 'working' },
          { id: 's2', reps: '', weight: '', completed: false, tag: 'working' },
        ],
      },
    ],
  }
}

function lastPerformance(overrides: Partial<LastPerformance> = {}): LastPerformance {
  return {
    performedAt: new Date('2026-08-01T12:00:00Z'),
    sets: [],
    note: null,
    sessionNote: null,
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  quickCaptureProps.length = 0
  window.sessionStorage.clear()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

async function renderLogger(
  props: Partial<Parameters<typeof WorkoutLogger>[0]> = {},
  seedLastPerformance?: LastPerformance,
) {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
  if (seedLastPerformance !== undefined) {
    client.setQueryData(
      ['last-performance', 'wger', 73, props.workoutId ?? null],
      seedLastPerformance,
    )
  }
  root = createRoot(container)
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <WorkoutLogger
          title="New Workout"
          closeHref="/"
          initialDraft={cleanDraft()}
          {...props}
        />
      </QueryClientProvider>,
    )
  })
}

function click(label: string) {
  const el = container.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  if (!el) throw new Error(`no element labeled "${label}"`)
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

function clickText(text: string) {
  const el = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  )
  if (!el) throw new Error(`no button with text "${text}"`)
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

function has(label: string): boolean {
  return container.querySelector(`[aria-label="${label}"]`) !== null
}

/** Seed the #218 return-leg instruction: mount consumes it and performs the swap. */
function seedSwapPick(targetId: string, name = 'Front Squat', id = 99) {
  window.sessionStorage.setItem(
    PENDING_PICK_KEY,
    JSON.stringify({
      mode: 'swap',
      targetId,
      exercise: { wgerExerciseId: id, source: 'wger', name, category: 'Legs' },
    }),
  )
}

describe('ATTACK: undo stack across REPLACE then REMOVE of the same slot', () => {
  it('LIFO restores the replacement first, then the original — with an honest count', async () => {
    seedSwapPick('ex1')
    await renderLogger()

    // The swap happened on mount: Front Squat holds the slot, toast says so.
    expect(has('Replace Front Squat')).toBe(true)
    expect(has('Replace Squat')).toBe(false)
    expect(container.textContent).toContain('Replaced')

    // Now remove the replacement — stack depth 2.
    click('Remove Front Squat')
    expect(container.textContent).toContain('Undo (2)')
    expect(container.textContent).toContain('Removed')

    // Undo #1 must bring back FRONT SQUAT (the removal), not Squat.
    clickText('Undo (2)')
    expect(has('Replace Front Squat')).toBe(true)
    expect(has('Replace Squat')).toBe(false)
    // Count decays honestly to the bare label.
    expect(container.textContent).not.toContain('Undo (2)')

    // Undo #2 unwinds the replace: Squat back, Front Squat gone.
    clickText('Undo')
    expect(has('Replace Squat')).toBe(true)
    expect(has('Replace Front Squat')).toBe(false)
  })

  it('set-then-exercise removals restore in LIFO order with the set landing back home', async () => {
    await renderLogger()

    click('Remove set 1')
    expect(container.textContent).toContain('set 1 · Squat')
    click('Remove Squat')
    expect(container.textContent).toContain('Undo (2)')

    // Undo #1: the exercise returns (with its one remaining set).
    clickText('Undo (2)')
    expect(has('Replace Squat')).toBe(true)
    expect(container.querySelectorAll('[aria-label="Remove set 1"]').length).toBe(1)
    expect(container.querySelectorAll('[aria-label="Remove set 2"]').length).toBe(0)

    // Undo #2: the removed set slots back at its index — two rows again.
    clickText('Undo')
    expect(has('Remove set 2')).toBe(true)
  })
})

describe('ATTACK: pendingRemember (block prompt) contracts', () => {
  const rememberProps = {
    workoutId: 'w1',
    planTargets: {
      'wger:73': [{ repMin: 5, repMax: 5, loadKg: 100, restSec: null, rir: null, rpe: null }],
    },
  }

  it('prompt and undo toast coexist after a plan-slot swap', async () => {
    seedSwapPick('ex1')
    await renderLogger(rememberProps)

    // Both strips at once: the block question AND the replace's undo.
    expect(container.textContent).toContain('for the rest of the block?')
    expect(container.textContent).toContain('Just today')
    expect(container.textContent).toContain('Use for block')
    expect(container.textContent).toContain('Replaced')
    expect(container.textContent).toContain('Undo')
  })

  it('undoing the swap withdraws its remember question', async () => {
    seedSwapPick('ex1')
    await renderLogger(rememberProps)

    clickText('Undo')
    expect(has('Replace Squat')).toBe(true)
    // The strips stale-cache their content through the exit animation (240ms
    // backstop in jsdom, where animationend never fires) — wait it out before
    // asserting the prompt is truly withdrawn, not just exiting.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    expect(container.textContent).not.toContain('for the rest of the block?')
    expect(container.textContent).not.toContain('Use for block')
  })

  it('the prompt has NO timer: it outlives the undo window by minutes', async () => {
    vi.useFakeTimers()
    seedSwapPick('ex1')
    await renderLogger(rememberProps)
    expect(container.textContent).toContain('for the rest of the block?')
    expect(container.textContent).toContain('Replaced')

    // jsdom never fires CSS animationend, so the undo window closes via the
    // leak guard (8s + 1s grace) — the prompt must survive far past it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    // Undo toast expired (exit plays, then unmounts past the 240ms backstop)…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(container.textContent).not.toContain('Replaced')
    expect(container.textContent).not.toContain('Undo (')

    // …while the prompt persists a full minute in.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(container.textContent).toContain('for the rest of the block?')
    expect(container.textContent).toContain('Use for block')
  })
})

describe('ATTACK: pin-as-promotion seeding (#211)', () => {
  it('with no identity note, the sheet opens seeded from the session text, pinned', async () => {
    const draft = cleanDraft()
    draft.exercises[0].notes = 'felt heavy today'
    await renderLogger({ initialDraft: draft })

    click('Pin note for Squat')
    // next/dynamic resolves the (mocked) chunk in a microtask.
    await act(async () => {})

    expect(quickCaptureProps.length).toBeGreaterThan(0)
    const seeded = quickCaptureProps[quickCaptureProps.length - 1]
    expect(seeded.initialBody).toBe('felt heavy today')
    expect(seeded.initialPinned).toBe(true)
  })

  it('with an identity note ALREADY present, promotion still seeds the SESSION text being promoted', async () => {
    // PR #235: the pin beside a session note "opens QuickCapture seeded from
    // the session text" — that is the promotion promise the control makes.
    // With an identity note in history, the seed silently switches to the OLD
    // pinned body and the session text the user tapped "Pin" on never arrives.
    const draft = cleanDraft()
    draft.exercises[0].notes = 'felt heavy today'
    await renderLogger(
      { initialDraft: draft },
      lastPerformance({ note: { body: 'Seat pin 4', pinned: true } }),
    )

    click('Pin note for Squat')
    await act(async () => {})

    expect(quickCaptureProps.length).toBeGreaterThan(0)
    const seeded = quickCaptureProps[quickCaptureProps.length - 1]
    expect(seeded.initialBody).toBe('felt heavy today')
  })
})

describe('ATTACK: echo tap-to-copy with the editor already open (#211)', () => {
  it('the echo persists beside an empty open editor and its tap fills the textarea', async () => {
    await renderLogger({}, lastPerformance({ sessionNote: 'Felt strong, add 2.5' }))

    // Open the editor first (entry chip) — the echo must remain offered while
    // the draft note is still empty.
    click('Add note for Squat')
    expect(has("Copy last session's note for Squat")).toBe(true)

    click("Copy last session's note for Squat")
    const textarea = container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Notes for Squat"]',
    )
    expect(textarea).not.toBeNull()
    expect(textarea?.value).toBe('Felt strong, add 2.5')
    // Copying retires the echo (this session now has a note).
    expect(has("Copy last session's note for Squat")).toBe(false)
  })
})
