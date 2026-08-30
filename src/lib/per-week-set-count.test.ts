import { describe, it, expect } from 'vitest'
import {
  deriveWeekSets,
  applyOverride,
  type DerivedSet,
  type ProgramSetRowLike,
  type SetOverrideLike,
} from './programs/progression'

/**
 * THE PER-WEEK SET-COUNT CONTRACT (docs/specs/per-week-set-count.md).
 *
 * Set COUNT is a plan fact owned by RULES (the deload policy's setFactor, the
 * weekly-volume ramp) and by base-row edits — never by a per-week override.
 * These tests pin the four claims the decision rests on, so a future change
 * that quietly adds a second count dimension has to break one of them first.
 */

function workingSet(overrides: Partial<ProgramSetRowLike> = {}): ProgramSetRowLike {
  return {
    setNumber: 1,
    setType: 'working',
    metricMode: 'reps_weight',
    repMin: 10,
    repMax: null,
    rir: null,
    rpe: null,
    suggestedLoadKg: 60,
    tempo: null,
    durationSec: null,
    distanceM: null,
    restSec: null,
    technique: null,
    ...overrides,
  }
}

/** n working sets, numbered 1..n — the "4×10 Lat Pulldown" of the mocks. */
function workingSets(n: number): ProgramSetRowLike[] {
  return Array.from({ length: n }, (_, i) => workingSet({ setNumber: i + 1 }))
}

const NO_HISTORY = { e1rmKg: null, lastSets: null }

/** An all-null override row with the named fields pinned. */
function override(fields: Partial<SetOverrideLike> = {}): SetOverrideLike {
  return {
    repMin: null,
    repMax: null,
    rir: null,
    rpe: null,
    suggestedLoadKg: null,
    tempo: null,
    durationSec: null,
    distanceM: null,
    restSec: null,
    technique: null,
    ...fields,
  }
}

/** The caller-side merge deriveDayPrescription performs: an override row is
 *  matched to a derived row by the BASE-row index it came from. */
function mergeOverrides(
  derived: DerivedSet[],
  overridesBySourceIndex: Map<number, SetOverrideLike>,
): DerivedSet[] {
  return derived.map((s) => applyOverride(s, overridesBySourceIndex.get(s.sourceIndex)))
}

const SCHEDULED_HALF = {
  mode: 'scheduled' as const,
  shape: {
    loadFactor: 0.85,
    setFactor: 0.5,
    rpeCap: null,
    timedExercises: 'untouched' as const,
  },
}

describe('per-week set count — what can and cannot vary it', () => {
  it('CLAIM 1: an override changes field values, never the number of sets', () => {
    // Arrange — a 4×10 exercise, week 3 fully overridden on every field an
    // override row can carry.
    const sets = workingSets(4)
    const pinned = override({
      repMin: 8,
      repMax: 12,
      rir: 2,
      rpe: 8,
      suggestedLoadKg: 80,
      tempo: '3010',
      restSec: 150,
    })

    // Act
    const derived = deriveWeekSets({
      sets,
      progression: null,
      week: 3,
      mesocycleWeeks: 6,
      deloadWeek: null,
      history: NO_HISTORY,
    })
    const merged = mergeOverrides(
      derived,
      new Map([
        [0, pinned],
        [1, pinned],
        [2, pinned],
        [3, pinned],
      ]),
    )

    // Assert — the escape hatch is field-shaped: 4 sets in, 4 sets out.
    expect(derived).toHaveLength(4)
    expect(merged).toHaveLength(4)
    expect(merged.every((s) => s.derivedFrom === 'override')).toBe(true)
    // No override row can produce a 5th set: an override row exists only for
    // a base set that is already there.
    expect(merged.map((s) => s.setNumber)).toEqual([1, 2, 3, 4])
  })

  it('CLAIM 2: deloadPolicy.setFactor DOES vary the working-set count, per week and by rule', () => {
    // Arrange — 4×10, week 4 is the scheduled deload at setFactor 0.5.
    const sets = workingSets(4)
    const derive = (week: number) =>
      deriveWeekSets({
        sets,
        progression: null,
        week,
        mesocycleWeeks: 6,
        deloadWeek: 4,
        history: NO_HISTORY,
        deloadPolicy: SCHEDULED_HALF,
      })

    // Act + Assert — the count is a FUNCTION of the week, already.
    expect(derive(3)).toHaveLength(4)
    expect(derive(4)).toHaveLength(2) // ceil(4 × 0.5)
    expect(derive(5)).toHaveLength(4)
    // …and it is a rule, not a stored fact: the same policy answers for every
    // exercise and every deload week, with a floor of one working set.
    expect(
      deriveWeekSets({
        sets: workingSets(1),
        progression: null,
        week: 4,
        mesocycleWeeks: 6,
        deloadWeek: 4,
        history: NO_HISTORY,
        deloadPolicy: { ...SCHEDULED_HALF, shape: { ...SCHEDULED_HALF.shape, setFactor: 0 } },
      }),
    ).toHaveLength(1)
  })

  it('CLAIM 2b: a non-scheduled deload policy leaves the count alone — the rule is opt-in', () => {
    const sets = workingSets(4)
    for (const deloadPolicy of [{ mode: 'none' as const }, { mode: 'reactive' as const }]) {
      const derived = deriveWeekSets({
        sets,
        progression: null,
        week: 4,
        mesocycleWeeks: 6,
        deloadWeek: 4,
        history: NO_HISTORY,
        deloadPolicy,
      })
      expect(derived, deloadPolicy.mode).toHaveLength(4)
    }
  })

  it('CLAIM 3: the weekly-volume scheme ramps the count across weeks — the other rule', () => {
    // Arrange — MEV 3 → MRV 6 over a 4-week block with no deload.
    const sets = workingSets(3)
    const progression = { scheme: 'weekly-volume' as const, mevSets: 3, mrvSets: 6 }
    const counts = [1, 2, 3, 4].map(
      (week) =>
        deriveWeekSets({
          sets,
          progression,
          week,
          mesocycleWeeks: 4,
          deloadWeek: null,
          history: NO_HISTORY,
        }).length,
    )

    // Assert — a monotone ramp, derived from the scheme, not stored per week.
    expect(counts).toEqual([3, 4, 5, 6])
  })

  it('CLAIM 4: count changes happen at the TAIL, and grown rows share the tail set’s identity', () => {
    // Arrange — 3 working sets ramping to 5; the last base row is index 2.
    const sets = workingSets(3)
    const derived = deriveWeekSets({
      sets,
      progression: { scheme: 'weekly-volume', mevSets: 3, mrvSets: 5 },
      week: 3,
      mesocycleWeeks: 3,
      deloadWeek: null,
      history: NO_HISTORY,
    })

    // Assert — growth CLONES the tail row, so the extra sets carry
    // sourceIndex 2. That is why a per-week COUNT pin has no set-grain answer:
    // an override on base set 3 necessarily lands on every tail row.
    expect(derived.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 2, 2])
    const merged = mergeOverrides(derived, new Map([[2, override({ suggestedLoadKg: 50 })]]))
    expect(merged.filter((s) => s.loadKg === 50)).toHaveLength(3)

    // …and shrinking drops from the tail: the surviving rows keep their base
    // identity, so every override still lands on the set it was written for.
    const shrunk = deriveWeekSets({
      sets: workingSets(4),
      progression: null,
      week: 4,
      mesocycleWeeks: 6,
      deloadWeek: 4,
      history: NO_HISTORY,
      deloadPolicy: SCHEDULED_HALF,
    })
    expect(shrunk.map((s) => s.sourceIndex)).toEqual([0, 1])
  })

  it('CLAIM 4b: an override on a set the week dropped simply does not apply', () => {
    // Arrange — week-4 overrides pinned on all four base sets; the deload
    // keeps two.
    const derived = deriveWeekSets({
      sets: workingSets(4),
      progression: null,
      week: 4,
      mesocycleWeeks: 6,
      deloadWeek: 4,
      history: NO_HISTORY,
      deloadPolicy: SCHEDULED_HALF,
    })
    const pinned = override({ repMin: 5 })

    // Act
    const merged = mergeOverrides(
      derived,
      new Map([
        [0, pinned],
        [1, pinned],
        [2, pinned],
        [3, pinned],
      ]),
    )

    // Assert — no resurrection: the dropped sets' overrides are inert, and
    // the kept sets are still overridden. An override never restores a set.
    expect(merged).toHaveLength(2)
    expect(merged.every((s) => s.repMin === 5)).toBe(true)
  })
})
