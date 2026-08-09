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
