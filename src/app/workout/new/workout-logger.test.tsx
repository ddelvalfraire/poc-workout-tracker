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
import { SessionToast } from './session-toast'
import type { WorkoutDraft } from './workout-draft'

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

function render(props: Partial<Parameters<typeof WorkoutLogger>[0]> = {}): string {
  // queries disabled: a static render must never kick off fetches.
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
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

describe('SessionToast (#210)', () => {
  const countdown = { durationMs: 8000, resetKey: 0, onExpire: () => {} }

  it('undo mode renders role=status with the message and the countdown drain', () => {
    const html = renderToStaticMarkup(
      <SessionToast open countdown={countdown}>
        <p>
          Removed <span className="font-medium">Squat</span>
        </p>
      </SessionToast>,
    )
    expect(html).toContain('role="status"')
    expect(html).toContain('Removed')
    expect(html).toContain('Squat')
    expect(html).toContain('toast-drain')
  })

  it('prompt mode renders both action labels and NO countdown element', () => {
    const html = renderToStaticMarkup(
      <SessionToast open>
        <p>Use Front Squat for the rest of the block?</p>
        <button type="button">Just today</button>
        <button type="button">Use for block</button>
      </SessionToast>,
    )
    expect(html).toContain('role="status"')
    expect(html).toContain('Just today')
    expect(html).toContain('Use for block')
    expect(html).not.toContain('toast-drain')
  })

  it('stays a hairline strip — never a card shell', () => {
    const html = renderToStaticMarkup(
      <SessionToast open countdown={countdown}>
        <p>Removed set</p>
      </SessionToast>,
    )
    expect(html).not.toContain('bg-card')
    expect(html).not.toContain('rounded-xl')
  })

  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(<SessionToast open={false}>{null}</SessionToast>)
    expect(html).toBe('')
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
