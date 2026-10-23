import { describe, it, expect } from 'vitest'
import { completeFilledSets, hasLoggedWork, type WorkoutDraft } from './workout-draft'

/**
 * The abandonment gate. An instantiated program day is a full workout row from
 * the moment it starts — every set pre-seeded with the prescribed load and no
 * reps — so "finishing" one the lifter never logged into persists that prefill
 * as a complete session: plan loads masquerading as performance, scoring
 * nothing. These pin the predicate that tells the two apart.
 */

const EXERCISE = {
  wgerExerciseId: 73,
  source: 'wger' as const,
  name: 'Squat',
  category: 'Legs',
  loggingType: 'weight_reps' as const,
  notes: '',
  skipped: false,
}

function draftOf(
  sets: { reps: string; weight: string; completed: boolean }[],
  overrides: Partial<typeof EXERCISE> = {},
): WorkoutDraft {
  return {
    notes: '',
    exercises: [
      {
        id: 'ex1',
        ...EXERCISE,
        ...overrides,
        sets: sets.map((set, i) => ({ id: `s${i}`, tag: 'working' as const, ...set })),
      },
    ],
  }
}

describe('hasLoggedWork — did the lifter actually log anything?', () => {
  it('is false for an untouched instantiated session (prescribed load, no reps)', () => {
    // The exact shape src/db/prescriptions.ts seeds: weight pre-filled from the
    // prescription, reps blank, nothing checked off.
    const draft = draftOf([
      { reps: '', weight: '102.06', completed: false },
      { reps: '', weight: '102.06', completed: false },
      { reps: '', weight: '102.06', completed: false },
    ])
    expect(hasLoggedWork(completeFilledSets(draft).draft)).toBe(false)
  })

  it('is true once a single set carries reps', () => {
    const draft = draftOf([
      { reps: '8', weight: '102.06', completed: false },
      { reps: '', weight: '102.06', completed: false },
    ])
    expect(hasLoggedWork(completeFilledSets(draft).draft)).toBe(true)
  })

  it('is true for hand-checked sets that the completion pass never flipped', () => {
    // autoCompleted === 0 here, which is exactly why the gate cannot read it:
    // the pass changed nothing because the work was already checked off.
    const draft = draftOf([{ reps: '8', weight: '100', completed: true }])
    const result = completeFilledSets(draft)
    expect(result.autoCompleted).toBe(0)
    expect(hasLoggedWork(result.draft)).toBe(true)
  })

  it('does not count a skipped exercise as logged work', () => {
    const draft = draftOf([{ reps: '', weight: '100', completed: false }], { skipped: true })
    expect(hasLoggedWork(completeFilledSets(draft).draft)).toBe(false)
  })

  it('is false for a draft with no exercises at all', () => {
    expect(hasLoggedWork({ notes: '', exercises: [] })).toBe(false)
  })
})
