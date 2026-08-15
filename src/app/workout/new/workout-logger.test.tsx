import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Render-level parity contract for the effort feature (the back-link.test.tsx
 * static-markup convention): with the show rule FALSE — no prescribed effort
 * target, preference off — the logger's markup must contain zero effort UI.
 * The interactive chip flow itself is a post-completion state change (jsdom
 * territory); what a static render CAN prove is the two things the spec makes
 * hard rules: opted-out sessions render no effort surface at all, and logged
 * values resurface as words.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

// The logger's server actions all live behind user interaction or effects;
// a static render only needs them importable, never callable.
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

import { WorkoutLogger } from './workout-logger'
import type { WorkoutDraft } from './workout-draft'
import type { LastPerformance } from '@/db/workouts'

/** One exercise, first set completed (the moment the chip row would appear). */
function draftWithCompletedSet(effort: { rir?: string; rpe?: string } = {}): WorkoutDraft {
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
          { id: 's1', reps: '5', weight: '100', completed: true, tag: 'working', ...effort },
          { id: 's2', reps: '', weight: '', completed: false, tag: 'working' },
        ],
      },
    ],
  }
}

function render(
  props: Partial<Parameters<typeof WorkoutLogger>[0]> = {},
  // Seeded straight into the cache (queries stay disabled) so the static
  // render can exercise the last-performance ride-alongs without a fetch.
  seedLastPerformance?: LastPerformance,
): string {
  // queries disabled: a static render must never kick off fetches.
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
  if (seedLastPerformance !== undefined) {
    client.setQueryData(['last-performance', 'wger', 73, null], seedLastPerformance)
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <WorkoutLogger
        title="New Workout"
        closeHref="/"
        initialDraft={draftWithCompletedSet()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('WorkoutLogger effort-row parity', () => {
  it('renders NO effort UI when the show rule is false (no targets, pref off)', () => {
    const html = render()
    expect(html).not.toContain('RIR')
    expect(html).not.toContain('RPE')
  })

  it('renders NO effort UI by default even with a plan lacking effort targets', () => {
    const html = render({
      planTargets: {
        'wger:73': [
          { repMin: 5, repMax: 5, loadKg: 100, restSec: null, rir: null, rpe: null },
          { repMin: 5, repMax: 5, loadKg: 100, restSec: null, rir: null, rpe: null },
        ],
      },
    })
    expect(html).not.toContain('RIR')
    expect(html).not.toContain('RPE')
  })

  it('resurfaces a logged RIR as words on the completed set when opted in', () => {
    const html = render({
      rpeLoggingEnabled: true,
      initialDraft: draftWithCompletedSet({ rir: '2' }),
    })
    expect(html).toContain('RIR 2')
  })

  it('keeps logged effort words visible via the prescribed-target arm alone (pref off)', () => {
    const html = render({
      initialDraft: draftWithCompletedSet({ rpe: '8.5' }),
      planTargets: {
        'wger:73': [
          { repMin: 5, repMax: 5, loadKg: 100, restSec: null, rir: 2, rpe: null },
          { repMin: 5, repMax: 5, loadKg: 100, restSec: null, rir: 2, rpe: null },
        ],
      },
    })
    expect(html).toContain('RPE 8.5')
  })
})

describe('WorkoutLogger name lock (#207)', () => {
  it('live session renders the name as static text, never an input', () => {
    const html = render({ initialName: 'Legs', isLive: true })
    expect(html).toContain('Legs')
    // The name input's placeholder is the tell for the editable field.
    expect(html).not.toContain('Optional — e.g. Lower')
  })

  it('live session with no name shows the muted fallback', () => {
    const html = render({ isLive: true })
    expect(html).toContain('Unnamed workout')
  })

  it('edit mode (finished workout) keeps the editable name input', () => {
    const html = render({ workoutId: 'w1', isLive: false, initialName: 'Legs' })
    expect(html).toContain('Optional — e.g. Lower')
    expect(html).not.toContain('Unnamed workout')
  })
})

describe('WorkoutLogger identity-note parity', () => {
  it('renders NO note chip when the exercise has no identity note', () => {
    // The sticky chip follows the effort-row discipline: with no pinned note
    // (here: no last-performance data at all, queries disabled) the logger's
    // markup contains zero note-chip UI — the fast path is byte-identical.
    const html = render()
    expect(html).not.toContain('Exercise note')
  })
})

/** A prior performance for wger #73, with per-field overrides. */
function lastPerformance(overrides: Partial<LastPerformance> = {}): LastPerformance {
  return {
    performedAt: new Date('2026-08-01T12:00:00Z'),
    sets: [],
    note: null,
    sessionNote: null,
    ...overrides,
  }
}

describe('WorkoutLogger notes three-tier IA (#211)', () => {
  it('renders the "Note" entry chip while the exercise has no session note', () => {
    const html = render()
    expect(html).toContain(`Add note for Squat`)
    expect(html).toContain('>Note<')
  })

  it('renders the note words as the tap target once a session note exists', () => {
    // Open-OR-has-notes invariant, new grammar: a non-empty note is never
    // hidden — it renders as muted words that reopen the editor; the entry
    // chip retires.
    const draft = draftWithCompletedSet()
    draft.exercises[0].notes = 'felt heavy today'
    const html = render({ initialDraft: draft })
    expect(html).toContain('felt heavy today')
    expect(html).toContain('Edit note for Squat')
    expect(html).not.toContain('Add note for Squat')
  })

  it('a session note carries the pin-as-promotion affordance', () => {
    const draft = draftWithCompletedSet()
    draft.exercises[0].notes = 'felt heavy today'
    const html = render({ initialDraft: draft })
    expect(html).toContain('Pin note for Squat')
  })

  it('the workout-level entry keeps its label on the chip skin', () => {
    const html = render()
    expect(html).toContain('Workout note')
  })

  it("echoes last session's note when this session has none", () => {
    const html = render({}, lastPerformance({ sessionNote: 'Felt strong, add 2.5' }))
    expect(html).toContain('Last time:')
    expect(html).toContain('Felt strong, add 2.5')
  })

  it('retires the echo once a session note exists', () => {
    const draft = draftWithCompletedSet()
    draft.exercises[0].notes = 'new note this session'
    const html = render(
      { initialDraft: draft },
      lastPerformance({ sessionNote: 'Felt strong, add 2.5' }),
    )
    expect(html).not.toContain('Last time:')
    expect(html).not.toContain('Felt strong, add 2.5')
  })

  it('suppresses the echo when the pinned chip already shows the same text', () => {
    const html = render(
      {},
      lastPerformance({
        sessionNote: 'Seat pin 4',
        note: { body: 'Seat pin 4', pinned: true },
      }),
    )
    // The pinned chip owns the text; the echo must not duplicate it.
    expect(html).toContain('Exercise note for Squat')
    expect(html).not.toContain('Last time:')
  })

  it('the skipped fold still echoes the session note', () => {
    const draft = draftWithCompletedSet()
    draft.exercises[0].skipped = true
    draft.exercises[0].notes = 'shoulder tweak'
    const html = render({ initialDraft: draft })
    expect(html).toContain('shoulder tweak')
    expect(html).toContain('Skipped')
  })
})
