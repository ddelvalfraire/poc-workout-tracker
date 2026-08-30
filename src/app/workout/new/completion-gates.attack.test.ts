/**
 * Adversarial regression tests for #206 weight-required completion + its
 * cardio parity: the reducer gate, the finish pass, draftToInput's field
 * isolation, and — at the trust boundary — parseWorkoutInput's refusal of a
 * persisted-completed set with no required metric ("Saving a set with no
 * weight should not be possible when the exercise's logging type is
 * weight+reps"). Adopted from the adversarial verification round.
 */
import { describe, it, expect } from 'vitest'
import {
  workoutDraftReducer,
  completeFilledSets,
  draftToInput,
  detailToDraft,
  isMissingRequiredMetric,
  isMissingRequiredWeight,
  type DraftExercise,
  type DraftSet,
  type WorkoutDraft,
} from './workout-draft'
import { parseWorkoutInput } from '@/lib/workout/workout-input'
import type { WorkoutDetail } from '@/db/workouts'

function set(overrides: Partial<DraftSet> = {}): DraftSet {
  return { id: 's1', reps: '', weight: '', completed: false, tag: 'working', ...overrides }
}

function exercise(overrides: Partial<DraftExercise> = {}): DraftExercise {
  return {
    id: 'ex1',
    wgerExerciseId: 73,
    source: 'wger',
    name: 'Squat',
    category: 'Legs',
    loggingType: 'weight_reps',
    notes: '',
    skipped: false,
    sets: [set()],
    ...overrides,
  }
}

function draftOf(...exercises: DraftExercise[]): WorkoutDraft {
  return { exercises, notes: '' }
}

function toggle(
  draft: WorkoutDraft,
  setIndex = 0,
  fill?: { reps?: string; weight?: string; duration?: string; distance?: string },
) {
  return workoutDraftReducer(draft, {
    type: 'TOGGLE_SET_COMPLETED',
    exerciseIndex: 0,
    setIndex,
    fill,
  })
}

describe('reducer gate (TOGGLE_SET_COMPLETED) — weight attacks', () => {
  it('refuses whitespace-only weight "   " (not a usable weight)', () => {
    const d = draftOf(exercise({ sets: [set({ reps: '5', weight: '   ' })] }))
    expect(toggle(d).exercises[0]!.sets[0]!.completed).toBe(false)
  })

  it('refuses junk weight "abc"', () => {
    const d = draftOf(exercise({ sets: [set({ reps: '5', weight: 'abc' })] }))
    expect(toggle(d).exercises[0]!.sets[0]!.completed).toBe(false)
  })

  it('accepts explicit "0" (empty-bar work) and padded " 5 "', () => {
    const zero = draftOf(exercise({ sets: [set({ reps: '5', weight: '0' })] }))
    expect(toggle(zero).exercises[0]!.sets[0]!.completed).toBe(true)
    const padded = draftOf(exercise({ sets: [set({ reps: '5', weight: ' 5 ' })] }))
    expect(toggle(padded).exercises[0]!.sets[0]!.completed).toBe(true)
  })

  it('completes via fill-only weight (ghost adoption) and adopts it', () => {
    const d = draftOf(exercise({ sets: [set({ reps: '5' })] }))
    const next = toggle(d, 0, { weight: '100' })
    expect(next.exercises[0]!.sets[0]).toMatchObject({ completed: true, weight: '100' })
  })

  it('refuses whole (no partial fill) when the fill weight is junk', () => {
    const d = draftOf(exercise({ sets: [set({ reps: '' })] }))
    const next = toggle(d, 0, { reps: '5', weight: 'abc' })
    // Neither completed nor the adoptable reps leaked in.
    expect(next.exercises[0]!.sets[0]).toMatchObject({ completed: false, reps: '' })
  })

  it('typed junk weight is NOT rescued by a valid fill weight (typed input wins)', () => {
    const d = draftOf(exercise({ sets: [set({ reps: '5', weight: 'abc' })] }))
    const next = toggle(d, 0, { weight: '100' })
    expect(next.exercises[0]!.sets[0]!.completed).toBe(false)
  })

  it('bodyweight modes are exempt: all three complete with a blank weight', () => {
    for (const loggingType of [
      'bodyweight_reps',
      'weighted_bodyweight',
      'assisted_bodyweight',
    ] as const) {
      const d = draftOf(exercise({ loggingType, sets: [set({ reps: '8' })] }))
      expect(toggle(d).exercises[0]!.sets[0]!.completed, loggingType).toBe(true)
    }
  })

  it('unchecking a legacy completed weight-less row is always allowed; re-checking is then refused', () => {
    const legacy = draftOf(exercise({ sets: [set({ reps: '15', completed: true })] }))
    const unchecked = toggle(legacy)
    expect(unchecked.exercises[0]!.sets[0]!.completed).toBe(false)
    // The corrected state cannot be re-completed without a weight.
    expect(toggle(unchecked).exercises[0]!.sets[0]!.completed).toBe(false)
  })

  it('out-of-range setIndex is a safe no-op', () => {
    const d = draftOf(exercise())
    expect(toggle(d, 9)).toEqual(d)
  })
})

describe('reducer gate — cardio parity attacks', () => {
  it('duration_distance with distance but NO duration is refused', () => {
    const d = draftOf(exercise({ sets: [set({ metricMode: 'duration_distance', distance: '5' })] }))
    expect(toggle(d).exercises[0]!.sets[0]!.completed).toBe(false)
  })

  it('duration "0:00" and junk "abc" are refused; a fill duration completes and adopts', () => {
    const zero = draftOf(exercise({ sets: [set({ metricMode: 'duration', duration: '0:00' })] }))
    expect(toggle(zero).exercises[0]!.sets[0]!.completed).toBe(false)
    const junk = draftOf(exercise({ sets: [set({ metricMode: 'duration', duration: 'abc' })] }))
    expect(toggle(junk).exercises[0]!.sets[0]!.completed).toBe(false)
    const filled = toggle(draftOf(exercise({ sets: [set({ metricMode: 'duration' })] })), 0, {
      duration: '12:30',
    })
    expect(filled.exercises[0]!.sets[0]).toMatchObject({ completed: true, duration: '12:30' })
  })

  it('the duration gate applies regardless of loggingType (bodyweight exercise, cardio set)', () => {
    const d = draftOf(
      exercise({ loggingType: 'bodyweight_reps', sets: [set({ metricMode: 'duration' })] }),
    )
    expect(toggle(d).exercises[0]!.sets[0]!.completed).toBe(false)
  })

  it('isMissingRequiredWeight itself exempts cardio sets (duration is their gate)', () => {
    const ex = exercise({ sets: [set({ metricMode: 'duration' })] })
    expect(isMissingRequiredWeight(ex, 0)).toBe(false)
    expect(isMissingRequiredMetric(ex, 0)).toBe(true)
  })
})

describe('finish pass (completeFilledSets) — parity with the reducer gate', () => {
  it('reps-without-weight weight_reps set is skipped, not auto-claimed', () => {
    const { draft, autoCompleted, skipped } = completeFilledSets(
      draftOf(exercise({ sets: [set({ reps: '15' })] })),
    )
    expect(draft.exercises[0]!.sets[0]!.completed).toBe(false)
    expect(autoCompleted).toBe(0)
    expect(skipped).toBe(1)
  })

  it('bodyweight completes on reps alone; ambiguous reps never auto-claim', () => {
    const bw = completeFilledSets(
      draftOf(exercise({ loggingType: 'bodyweight_reps', sets: [set({ reps: '8' })] })),
    )
    expect(bw.autoCompleted).toBe(1)
    for (const reps of ['5.5', '5e1', '0', ' ', '-3']) {
      const r = completeFilledSets(
        draftOf(exercise({ loggingType: 'bodyweight_reps', sets: [set({ reps })] })),
      )
      expect(r.autoCompleted, `reps=${JSON.stringify(reps)}`).toBe(0)
      expect(r.skipped).toBe(1)
    }
  })

  it('cardio: a parseable duration auto-completes; distance-only and "0:00" are skipped', () => {
    const good = completeFilledSets(
      draftOf(
        exercise({
          sets: [set({ metricMode: 'duration_distance', duration: '30', distance: '' })],
        }),
      ),
    )
    expect(good.autoCompleted).toBe(1)
    const distanceOnly = completeFilledSets(
      draftOf(exercise({ sets: [set({ metricMode: 'duration_distance', distance: '5' })] })),
    )
    expect(distanceOnly.autoCompleted).toBe(0)
    expect(distanceOnly.skipped).toBe(1)
    const zero = completeFilledSets(
      draftOf(exercise({ sets: [set({ metricMode: 'duration', duration: '0:00' })] })),
    )
    expect(zero.skipped).toBe(1)
  })

  it('a skipped exercise is neither auto-completed nor counted as skipped sets', () => {
    const r = completeFilledSets(
      draftOf(exercise({ skipped: true, sets: [set({ reps: '5', weight: '100' })] })),
    )
    expect(r.autoCompleted).toBe(0)
    expect(r.skipped).toBe(0)
    expect(r.draft.exercises[0]!.sets[0]!.completed).toBe(false)
  })
})

describe('draftToInput — cardio field isolation', () => {
  it('a stray typed rep/weight on a cardio set is nulled on the wire', () => {
    const input = draftToInput(
      draftOf(
        exercise({
          sets: [
            set({
              metricMode: 'duration_distance',
              duration: '30',
              distance: '5',
              reps: '10',
              weight: '100',
              completed: true,
            }),
          ],
        }),
      ),
    )
    expect(input.exercises[0]!.sets[0]).toMatchObject({
      reps: null,
      weight: null,
      metricMode: 'duration_distance',
      durationSec: 1800,
      distanceM: 5000,
      completed: true,
    })
  })

  it('a duration-mode set never emits a distanceM value even when a distance string leaks in', () => {
    const input = draftToInput(
      draftOf(exercise({ sets: [set({ metricMode: 'duration', duration: '30', distance: '5' })] })),
    )
    expect(input.exercises[0]!.sets[0]!.distanceM).toBeNull()
  })
})

describe('#206 at the trust boundary (legacy/stale drafts cannot re-persist the phantom fact)', () => {
  /** A persisted legacy row exactly like the live repro: reps 15, weight null, completed=true. */
  const LEGACY: WorkoutDetail = {
    id: 'w1',
    userId: 'user_123',
    name: 'Legs',
    startedAt: new Date('2026-08-10T10:00:00Z'),
    completedAt: null,
    originalRecordedAt: null,
    createdAt: new Date('2026-08-10T10:00:00Z'),
    programDayId: null,
    programWeek: null,
    importBatchId: null,
      programDaySlotKey: null,
      programDayName: null,
      programDayPosition: null,
    notes: null,
    exercises: [
      {
        id: 'ex1',
        workoutId: 'w1',
        wgerExerciseId: 99,
        source: 'wger',
        name: 'Seated Calf Raise',
        position: 0,
        loggingType: 'weight_reps',
        notes: null,
        skipped: false,
        sets: [
          {
            id: 's1',
            workoutExerciseId: 'ex1',
            setNumber: 1,
            reps: 15,
            weight: null,
            completed: true,
            setType: 'working',
            metricMode: 'reps_weight',
            durationSec: null,
            distanceM: null,
            prescribedLoadKg: null,
            prescribedRepMin: null,
            rir: null,
            rpe: null,
            prescribedRir: null,
            prescribedRpe: null,
            techniqueKind: null,
            techniqueGroup: null,
            stageIndex: null,
          },
        ],
      },
    ],
  }

  it('edit-mode restore → save without toggling cannot persist a completed weight-less weight_reps set', () => {
    const { draft } = detailToDraft(LEGACY)
    // Sanity: the restored draft really is the dangerous shape.
    expect(draft.exercises[0]!.sets[0]).toMatchObject({ completed: true, weight: '' })
    const input = draftToInput(draft)
    // #206: "Saving a set with no weight should not be possible when the
    // exercise's logging type is weight+reps." For that to hold at the trust
    // boundary, either draftToInput must drop the completion or
    // parseWorkoutInput must reject the phantom fact.
    expect(() => parseWorkoutInput(input)).toThrow()
  })

  it('a stale cross-device draft (pre-#206 client) cannot save a completed weight-less set', () => {
    const restored = workoutDraftReducer(
      { exercises: [], notes: '' },
      {
        type: 'RESTORE_DRAFT',
        draft: draftOf(exercise({ sets: [set({ reps: '15', completed: true })] })),
      },
    )
    const input = draftToInput(restored)
    expect(() => parseWorkoutInput(input)).toThrow()
  })
})
