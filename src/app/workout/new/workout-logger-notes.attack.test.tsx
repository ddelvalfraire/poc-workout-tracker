import { describe, it, expect, vi } from 'vitest'
import { renderStaticIntl } from '../../../../vitest.intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * ADVERSARIAL VERIFICATION — static-markup attacks on the #211 notes IA and
 * the #207 name lock, in the workout-logger.test.tsx convention (no DOM,
 * queries disabled, cache-seeded last-performance).
 *
 * Spec claims under attack:
 * - One entry grammar (#211): the "Note" chip "renders only while the
 *   exercise has no session note"; the module's own contract
 *   (identity-note.test.ts) defines a whitespace-only value as NOT a note
 *   yet — so a "   " draft value must still offer an entry affordance.
 * - "The echo never duplicates the pinned chip" — judged by what renders.
 * - #207: live name is static, "Unnamed workout" fallback; edit mode keeps
 *   the input. isLive=false without a workoutId (an unsaved non-live render)
 *   is exercised to document which side of the lock it falls on.
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

import { WorkoutLogger } from './workout-logger'
import type { WorkoutDraft } from './workout-draft'
import type { LastPerformance } from '@/db/workouts'

function baseDraft(): WorkoutDraft {
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
          { id: 's1', reps: '5', weight: '100', completed: true, tag: 'working' },
          { id: 's2', reps: '', weight: '', completed: false, tag: 'working' },
        ],
      },
    ],
  }
}

function render(
  props: Partial<Parameters<typeof WorkoutLogger>[0]> = {},
  seedLastPerformance?: LastPerformance,
): string {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
  if (seedLastPerformance !== undefined) {
    client.setQueryData(['last-performance', 'wger', 73, null], seedLastPerformance)
  }
  return renderStaticIntl(
    <QueryClientProvider client={client}>
      <WorkoutLogger title="New Workout" closeHref="/" initialDraft={baseDraft()} {...props} />
    </QueryClientProvider>,
  )
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

describe('ATTACK: whitespace-only session note vs the one-entry grammar (#211)', () => {
  it('a "   " draft note (not a note yet, per the module contract) still offers the entry chip', () => {
    const draft = baseDraft()
    draft.exercises[0].notes = '   '
    const html = render({ initialDraft: draft })
    // identity-note.test.ts:62 pins "   " as NOT a note yet (the echo stays
    // offered). The entry grammar must agree: with no real note there must be
    // an entry affordance — otherwise the only way back into the editor is an
    // invisible whitespace-only tap target.
    expect(html).toContain('Add note for Squat')
  })

  it('a "   " draft note never leaves an invisible reopen target — the note block hides, the echo stays', () => {
    const draft = baseDraft()
    draft.exercises[0].notes = '   '
    const html = render({ initialDraft: draft }, lastPerformance({ sessionNote: 'Felt strong' }))
    // The echo (correctly, per lastSessionEcho) still shows…
    expect(html).toContain('Last time:')
    // …and the pin affordance (trim-gated) is correctly absent…
    expect(html).not.toContain('Pin note for Squat')
    // …and the note-words reopen target hides too: every gate shares the
    // trimmed definition, so a whitespace-only draft renders no invisible
    // tap target — the labelled entry chip above is the way back in.
    expect(html).not.toContain('Edit note for Squat')
    expect(html).toContain('Add note for Squat')
  })

  it('the workout-level entry chip shares the strict-empty gate: "   " retires it too', () => {
    const draft = baseDraft()
    draft.notes = '   '
    const html = render({ initialDraft: draft })
    // Same claim as the per-exercise chip: whitespace is not a note yet, so
    // the labelled entry affordance must survive. NB: the assertion must be
    // the chip's text NODE — the textarea's aria-label "Workout notes"
    // contains the bare substring and false-passes it.
    expect(html).toContain('>Workout note<')
  })
})

describe('ATTACK: echo duplication as the user sees it (#211)', () => {
  it('pinned "**Seat pin 4**" and prev-session "Seat pin 4" must not show the same words twice', () => {
    const html = render(
      {},
      lastPerformance({
        sessionNote: 'Seat pin 4',
        note: { body: '**Seat pin 4**', pinned: true },
      }),
    )
    // The chip already displays "Seat pin 4" (markdown stripped)…
    expect(html).toContain('Exercise note for Squat')
    // …so the echo rendering the identical words is the duplication the spec
    // rules out ("the echo never duplicates the pinned chip").
    expect(html).not.toContain('Last time:')
  })

  it('sanity (clean path): raw-identical pinned text suppresses the echo', () => {
    const html = render(
      {},
      lastPerformance({ sessionNote: 'Seat pin 4', note: { body: 'Seat pin 4', pinned: true } }),
    )
    expect(html).not.toContain('Last time:')
  })
})

describe('skipped-session echo label (the honest "Last time")', () => {
  it('a skipped prior instance renders "Last time (skipped):"', () => {
    const html = render(
      {},
      lastPerformance({ sessionNote: 'shoulder tweak', sessionSkipped: true }),
    )
    expect(html).toContain('Last time (skipped):')
    expect(html).toContain('shoulder tweak')
  })

  it('a performed prior instance keeps the plain label — no phantom (skipped)', () => {
    const html = render({}, lastPerformance({ sessionNote: 'Felt strong' }))
    expect(html).toContain('Last time:')
    expect(html).not.toContain('(skipped)')
  })
})

describe('ATTACK: #207 name-lock edges', () => {
  it('a whitespace-only name in a live session falls back to "Unnamed workout"', () => {
    const html = render({ isLive: true, initialName: '   ' })
    expect(html).toContain('Unnamed workout')
    expect(html).not.toContain('Optional — e.g. Lower')
  })

  it('a long (200-char) live name renders in full as static text (no input leaks in)', () => {
    const longName = 'A'.repeat(200)
    const html = render({ isLive: true, initialName: longName })
    expect(html).toContain(longName)
    expect(html).not.toContain('Optional — e.g. Lower')
  })

  it('isLive=false WITHOUT a workoutId keeps the editable input (lock keys off isLive alone)', () => {
    // The lock's contract is "active session" — isLive — not "unsaved". A
    // non-live render with no workoutId (unreachable from today's pages,
    // which always pass isLive=false WITH a workoutId) must still edit.
    const html = render({ isLive: false })
    expect(html).toContain('Optional — e.g. Lower')
    expect(html).not.toContain('Unnamed workout')
  })

  it('live session never renders the name input even when a workoutId exists (program session)', () => {
    const html = render({ isLive: true, workoutId: 'w1', initialName: 'Legs' })
    expect(html).not.toContain('Optional — e.g. Lower')
    expect(html).toContain('Legs')
  })
})
