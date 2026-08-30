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
 * Detector tests for the plan-sync flow. The outperform discipline itself
 * (margin, epsilon, floor, all-or-nothing) is the engine's exported
 * `sessionAnchorLoads` — unit-tested exhaustively in autoregulate.test.ts —
 * so these tests pin the DETECTOR's contract: snapshot-driven scoring,
 * load-keyed application to plan sets (C2), the two-session up-anchor
 * confirmation (M2), exclusions, the plan-row null-load case, and
 * idempotency.
 */

function wSet(
  setNumber: number,
  reps: number | null,
  weight: number | null,
  over: Partial<PlanSyncWorkoutSet> = {},
): PlanSyncWorkoutSet {
  return {
    setNumber,
    reps,
    weight,
    completed: true,
    setType: 'working',
    // Prescribed-at-instantiation snapshot — the facts performance is scored
    // against; mirrors the default plan fixture (80 kg × 12 floor).
    prescribedLoadKg: 80,
    prescribedRepMin: 12,
    // Ordinary set by default; the technique cases set this explicitly.
    techniqueKind: null,
    ...over,
  }
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

/** A previous session that also outperformed its snapshots — the M2
 *  confirmation. */
const confirmingPrevious = () => [wEx([wSet(1, 12, 110), wSet(2, 12, 110)])]

describe('detectPlanSyncCandidates', () => {
  it('proposes the load-bucket anchor when every scorable set clears the 5% margin at the floor', () => {
    // Arrange — snapshots say 80×12; the lifter did 120 and 118 (both ≥ +5%,
    // reps ≥ floor). With no per-set identity across documents (C2), the
    // 80 kg bucket anchors at the performed load nearest the plan: 118.
    const workout = [wEx([wSet(1, 12, 120), wSet(2, 12, 118)])]
    const plan = [pEx([pSet(1, 12, 80), pSet(2, 12, 80)])]

    // Act
    const candidates = detectPlanSyncCandidates(workout, plan, confirmingPrevious())

    // Assert — every 80 kg plan set adopts the bucket, ascending setNumber.
    expect(candidates).toEqual([
      {
        exercisePosition: 0,
        name: 'Leg Extension',
        changes: [
          { setNumber: 1, currentLoadKg: 80, proposedLoadKg: 118 },
          { setNumber: 2, currentLoadKg: 80, proposedLoadKg: 118 },
        ],
      },
    ])
  })

  it('M2: an up-anchor without a previous qualifying session proposes nothing', () => {
    const workout = [wEx([wSet(1, 12, 120), wSet(2, 12, 120)])]
    const plan = [pEx([pSet(1, 12, 80), pSet(2, 12, 80)])]

    // No previous session supplied — one good day is not a trend.
    expect(detectPlanSyncCandidates(workout, plan)).toEqual([])
    // A previous session that did NOT outperform blocks it too.
    expect(
      detectPlanSyncCandidates(workout, plan, [wEx([wSet(1, 12, 80), wSet(2, 12, 80)])]),
    ).toEqual([])
  })

  it('proposes nothing under the 5% margin (micro-loading is the scheme’s job)', () => {
    const workout = [wEx([wSet(1, 12, 82)])]
    const plan = [pEx([pSet(1, 12, 80)])]

    expect(detectPlanSyncCandidates(workout, plan, confirmingPrevious())).toEqual([])
  })

  it('proposes nothing when reps fall below the floor, whatever the load', () => {
    const workout = [wEx([wSet(1, 6, 120)])]
    const plan = [pEx([pSet(1, 12, 80)])]

    expect(detectPlanSyncCandidates(workout, plan, confirmingPrevious())).toEqual([])
  })

  it('is all-or-nothing over scorable loaded sets — one set at plan blocks the exercise', () => {
    const workout = [wEx([wSet(1, 12, 120), wSet(2, 12, 80)])]
    const plan = [pEx([pSet(1, 12, 80), pSet(2, 12, 80)])]

    expect(detectPlanSyncCandidates(workout, plan, confirmingPrevious())).toEqual([])
  })

  it('C2: the bucket anchor applies to every plan set at that load, uncompleted rows included', () => {
    // The lifter completed two of three sets, both far over plan: the 80 kg
    // bucket testifies, and every 80 kg plan row adopts it — plan rows and
    // workout rows meet only through loads, never setNumbers.
    const workout = [
      wEx([wSet(1, 12, 120), wSet(2, 12, 120), wSet(3, null, null, { completed: false })]),
    ]
    const plan = [pEx([pSet(1, 12, 80), pSet(2, 12, 80), pSet(3, 12, 80)])]

    const candidates = detectPlanSyncCandidates(workout, plan, confirmingPrevious())

    expect(candidates[0]?.changes).toEqual([
      { setNumber: 1, currentLoadKg: 80, proposedLoadKg: 120 },
      { setNumber: 2, currentLoadKg: 80, proposedLoadKg: 120 },
      { setNumber: 3, currentLoadKg: 80, proposedLoadKg: 120 },
    ])
  })

  it('anchors a load-less plan set at the completed working load (first real anchor, single-session)', () => {
    const workout = [wEx([wSet(1, 10, 60, { prescribedLoadKg: null, prescribedRepMin: 8 })])]
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
    // The engine's missing-snapshot guard demands a floor, but a load-less
    // PLAN row is a real fact — its first anchor may come from any completed
    // working load whose snapshot prescribed no load.
    const workout = [wEx([wSet(1, 10, 60, { prescribedLoadKg: null, prescribedRepMin: null })])]
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

    expect(detectPlanSyncCandidates(workout, plan, confirmingPrevious())).toEqual([])
  })

  it('never proposes from a non-weight_reps exercise (weight is not a total load)', () => {
    const workout = [wEx([wSet(1, 12, 120)], { loggingType: 'bodyweight_plus' })]
    const plan = [pEx([pSet(1, 12, 80)])]

    expect(detectPlanSyncCandidates(workout, plan, confirmingPrevious())).toEqual([])
  })

  it('warm-up sets never contribute on either side', () => {
    const workout = [wEx([wSet(1, 12, 120, { setType: 'warmup' })])]
    const plan = [pEx([pSet(1, 12, 80, { setType: 'warmup' })])]

    expect(detectPlanSyncCandidates(workout, plan, confirmingPrevious())).toEqual([])
  })

  it('ignores duration plan sets — no load prescription to sync', () => {
    const workout = [wEx([wSet(1, 12, 120)])]
    const plan = [pEx([pSet(1, null, null, { metricMode: 'duration' })])]

    expect(detectPlanSyncCandidates(workout, plan, confirmingPrevious())).toEqual([])
  })

  it('is idempotent: a plan already at the performed load proposes nothing', () => {
    const workout = [wEx([wSet(1, 12, 120)])]
    const plan = [pEx([pSet(1, 12, 120)])]

    expect(detectPlanSyncCandidates(workout, plan, confirmingPrevious())).toEqual([])
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

    const candidates = detectPlanSyncCandidates(workout, plan, confirmingPrevious())

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ exercisePosition: 0, name: 'Leg Extension' })
  })

  it('an unmatched plan exercise (not in the workout) proposes nothing', () => {
    const plan = [pEx([pSet(1, 12, 80)])]

    expect(detectPlanSyncCandidates([], plan)).toEqual([])
  })

  /**
   * Intensity-technique rows never testify — the exclusion db/autoreg-history.ts
   * already applies before handing rows to the same scorer. Both consumers must
   * score the same population, or the plan chases numbers the stall rules were
   * deliberately blind to.
   */
  it('a technique stage never opens an anchor bucket a plan set at the stage load can adopt', () => {
    // Arrange — an ordinary working set at the 80 kg snapshot, outperformed
    // (120), plus a drop stage snapshotted at 60 kg and also outperformed
    // (90). The plan carries a 60 kg backoff-ish set. Every row clears the
    // margin, so the engine's all-or-nothing rule does not mask anything:
    // without the exclusion the 60 kg bucket opens at 90 and the plan's
    // 60 kg set adopts a DROP's performance as its own prescription.
    const workout = [
      wEx([
        wSet(1, 12, 120),
        wSet(2, 12, 120, { techniqueKind: 'drop-set' }),
        wSet(3, 12, 90, {
          techniqueKind: 'drop-set',
          prescribedLoadKg: 60,
          prescribedRepMin: 8,
        }),
      ]),
    ]
    const plan = [pEx([pSet(1, 12, 80), pSet(2, 8, 60)])]

    // Act
    const candidates = detectPlanSyncCandidates(workout, plan, confirmingPrevious())

    // Assert — only the plain set testifies. The 60 kg plan set finds no
    // bucket at or below its load and keeps what the plan says.
    expect(candidates).toEqual([
      {
        exercisePosition: 0,
        name: 'Leg Extension',
        changes: [{ setNumber: 1, currentLoadKg: 80, proposedLoadKg: 120 }],
      },
    ])
  })

  it('an unauthored technique stage never anchors a load-less plan set (the phantom prescription)', () => {
    // Arrange — the drop stage carries NO snapshot load (a null there means
    // "the lifter types what they dropped to"). Before the exclusion it fell
    // into the null bucket and handed the rpe-target plan set 40 kg.
    const workout = [
      wEx([
        wSet(1, 12, 100, { techniqueKind: 'drop-set' }),
        wSet(2, 10, 40, {
          techniqueKind: 'drop-set',
          prescribedLoadKg: null,
          prescribedRepMin: null,
        }),
      ]),
    ]
    const plan = [pEx([pSet(1, 12, null)])]

    // Act
    const candidates = detectPlanSyncCandidates(workout, plan, confirmingPrevious())

    // Assert
    expect(candidates).toEqual([])
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
