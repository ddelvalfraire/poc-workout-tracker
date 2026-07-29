import { describe, it, expect } from 'vitest'
import {
  detectPlanSyncCandidates,
  planSyncEventSummary,
  type PlanSyncPlanExercise,
  type PlanSyncPlanSet,
  type PlanSyncWorkoutExercise,
  type PlanSyncWorkoutSet,
} from './plan-sync'

/**
 * Detector tests for the confirmed plan-sync flow. The outperform discipline
 * itself (margin, epsilon, floor, all-or-nothing) is the engine's exported
 * `sessionAnchorLoads` — unit-tested exhaustively in autoregulate.test.ts —
 * so these tests pin the DETECTOR's contract: pairing, exclusions, the
 * plan-row null-load case, per-set mapping, and idempotency.
 */

function wSet(
  setNumber: number,
  reps: number | null,
  weight: number | null,
  over: Partial<PlanSyncWorkoutSet> = {},
): PlanSyncWorkoutSet {
  return { setNumber, reps, weight, completed: true, setType: 'working', ...over }
}

function wEx(
  sets: PlanSyncWorkoutSet[],
  over: Partial<PlanSyncWorkoutExercise> = {},
): PlanSyncWorkoutExercise {
  return {
    wgerExerciseId: 73,
    source: 'wger',
    loggingType: 'weight_reps',
    skipped: false,
    sets,
    ...over,
  }
}

function pSet(
  setNumber: number,
  repMin: number | null,
  suggestedLoadKg: number | null,
  over: Partial<PlanSyncPlanSet> = {},
): PlanSyncPlanSet {
  return {
    setNumber,
    setType: 'working',
    metricMode: 'reps_weight',
    repMin,
    suggestedLoadKg,
    ...over,
  }
}

function pEx(
  sets: PlanSyncPlanSet[],
  over: Partial<PlanSyncPlanExercise> = {},
): PlanSyncPlanExercise {
  return { position: 0, wgerExerciseId: 73, source: 'wger', name: 'Leg Extension', sets, ...over }
}

describe('detectPlanSyncCandidates', () => {
  it('proposes the performed load per set when every scorable set clears the 5% margin at the floor', () => {
    // Arrange — plan says 80×12; the lifter did 120 and 118 (both ≥ +5%, reps ≥ floor).
    const workout = [wEx([wSet(1, 12, 120), wSet(2, 12, 118)])]
    const plan = [pEx([pSet(1, 12, 80), pSet(2, 12, 80)])]

    // Act
    const candidates = detectPlanSyncCandidates(workout, plan)

    // Assert — per-set mapping by setNumber, ascending.
    expect(candidates).toEqual([
      {
        exercisePosition: 0,
        name: 'Leg Extension',
        changes: [
          { setNumber: 1, currentLoadKg: 80, proposedLoadKg: 120 },
          { setNumber: 2, currentLoadKg: 80, proposedLoadKg: 118 },
        ],
      },
    ])
  })

  it('proposes nothing under the 5% margin (micro-loading is the scheme’s job)', () => {
    const workout = [wEx([wSet(1, 12, 82)])]
    const plan = [pEx([pSet(1, 12, 80)])]

    expect(detectPlanSyncCandidates(workout, plan)).toEqual([])
  })

  it('proposes nothing when reps fall below the floor, whatever the load', () => {
    const workout = [wEx([wSet(1, 6, 120)])]
    const plan = [pEx([pSet(1, 12, 80)])]

    expect(detectPlanSyncCandidates(workout, plan)).toEqual([])
  })

  it('is all-or-nothing over scorable loaded sets — one set at plan blocks the exercise', () => {
    const workout = [wEx([wSet(1, 12, 120), wSet(2, 12, 80)])]
    const plan = [pEx([pSet(1, 12, 80), pSet(2, 12, 80)])]

    expect(detectPlanSyncCandidates(workout, plan)).toEqual([])
  })

  it('leaves sets without evidence unchanged (uncompleted set is not scorable)', () => {
    const workout = [
      wEx([wSet(1, 12, 120), wSet(2, 12, 120), wSet(3, null, null, { completed: false })]),
    ]
    const plan = [pEx([pSet(1, 12, 80), pSet(2, 12, 80), pSet(3, 12, 80)])]

    const candidates = detectPlanSyncCandidates(workout, plan)

    expect(candidates[0]?.changes.map((c) => c.setNumber)).toEqual([1, 2])
  })

  it('anchors a load-less plan set at the completed working load (first real anchor)', () => {
    const workout = [wEx([wSet(1, 10, 60)])]
    const plan = [pEx([pSet(1, 8, null)])]

    expect(detectPlanSyncCandidates(workout, plan)).toEqual([
      {
        exercisePosition: 0,
        name: 'Leg Extension',
        changes: [{ setNumber: 1, currentLoadKg: null, proposedLoadKg: 60 }],
      },
    ])
  })

  it('anchors a load-less, floor-less plan set too (the rpe-only prescription)', () => {
    // Unlike a snapshot, a plan row with null repMin is a real fact — the
    // engine’s missing-snapshot guard does not apply here.
    const workout = [wEx([wSet(1, 10, 60)])]
    const plan = [pEx([pSet(1, null, null)])]

    expect(detectPlanSyncCandidates(workout, plan)).toEqual([
      {
        exercisePosition: 0,
        name: 'Leg Extension',
        changes: [{ setNumber: 1, currentLoadKg: null, proposedLoadKg: 60 }],
      },
    ])
  })

  it('never proposes from a skipped exercise', () => {
    const workout = [wEx([wSet(1, 12, 120)], { skipped: true })]
    const plan = [pEx([pSet(1, 12, 80)])]

    expect(detectPlanSyncCandidates(workout, plan)).toEqual([])
  })

  it('never proposes from a non-weight_reps exercise (weight is not a total load)', () => {
    const workout = [wEx([wSet(1, 12, 120)], { loggingType: 'bodyweight_plus' })]
    const plan = [pEx([pSet(1, 12, 80)])]

    expect(detectPlanSyncCandidates(workout, plan)).toEqual([])
  })

  it('warm-up sets never contribute on either side', () => {
    const workout = [wEx([wSet(1, 12, 120, { setType: 'warmup' })])]
    const plan = [pEx([pSet(1, 12, 80, { setType: 'warmup' })])]

    expect(detectPlanSyncCandidates(workout, plan)).toEqual([])
  })

  it('ignores duration plan sets — no load prescription to sync', () => {
    const workout = [wEx([wSet(1, 12, 120)])]
    const plan = [pEx([pSet(1, null, null, { metricMode: 'duration' })])]

    expect(detectPlanSyncCandidates(workout, plan)).toEqual([])
  })

  it('is idempotent: a plan already at the performed load proposes nothing', () => {
    const workout = [wEx([wSet(1, 12, 120)])]
    const plan = [pEx([pSet(1, 12, 120)])]

    expect(detectPlanSyncCandidates(workout, plan)).toEqual([])
  })

  it('matches by composite identity and reports only qualifying exercises', () => {
    const workout = [
      wEx([wSet(1, 12, 120)]),
      wEx([wSet(1, 12, 80)], { wgerExerciseId: 99 }),
      // Same id, different source: must not cross-match the wger slot.
      wEx([wSet(1, 12, 200)], { source: 'custom' }),
    ]
    const plan = [
      pEx([pSet(1, 12, 80)]),
      pEx([pSet(1, 12, 80)], { position: 1, wgerExerciseId: 99, name: 'Row' }),
    ]

    const candidates = detectPlanSyncCandidates(workout, plan)

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ exercisePosition: 0, name: 'Leg Extension' })
  })

  it('an unmatched plan exercise (not in the workout) proposes nothing', () => {
    const plan = [pEx([pSet(1, 12, 80)])]

    expect(detectPlanSyncCandidates([], plan)).toEqual([])
  })
})

describe('planSyncEventSummary', () => {
  it('speaks from the heaviest changed set in the display unit', () => {
    // 36.29 kg ≈ 80 lb, 54.43 kg ≈ 120 lb — the spec’s Leg Extension line.
    const summary = planSyncEventSummary(
      {
        exercisePosition: 0,
        name: 'Leg Extension',
        changes: [
          { setNumber: 1, currentLoadKg: 36.29, proposedLoadKg: 54.43 },
          { setNumber: 2, currentLoadKg: 20, proposedLoadKg: 30 },
        ],
      },
      'lb',
    )

    expect(summary).toBe('Leg Extension: 80 → 120 lb (synced to performance)')
  })

  it('names only the adopted load for a first anchor (no current load)', () => {
    const summary = planSyncEventSummary(
      {
        exercisePosition: 0,
        name: 'Cable Fly',
        changes: [{ setNumber: 1, currentLoadKg: null, proposedLoadKg: 25 }],
      },
      'kg',
    )

    expect(summary).toBe('Cable Fly: 25 kg (synced to performance)')
  })
})
