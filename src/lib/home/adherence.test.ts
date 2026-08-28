import { describe, it, expect } from 'vitest'
import { aggregatePlanAdherence, aggregateStrengthRetention } from './adherence'
import type { RecordSetRow } from './records'

const ANCHOR = new Date('2026-02-01T00:00:00Z')
const BEFORE = new Date('2026-01-15T10:00:00Z')
const AFTER = new Date('2026-02-15T10:00:00Z')

function lift(over: Partial<RecordSetRow> = {}): RecordSetRow {
  return {
    workoutId: 'w1',
    performedAt: BEFORE,
    source: 'wger',
    wgerExerciseId: 615, // canonical squat
    exerciseName: 'Squats',
    loggingType: 'weight_reps',
    reps: 5,
    weight: 100,
    durationSec: null,
    distanceM: null,
    ...over,
  }
}

describe('aggregateStrengthRetention', () => {
  it('compares the best on each side of the anchor', () => {
    const out = aggregateStrengthRetention(
      [lift({ performedAt: BEFORE, weight: 100 }), lift({ performedAt: AFTER, weight: 95 })],
      ANCHOR,
      null,
    )
    expect(out?.lifts.squat?.percent).toBe(95)
    expect(out?.percent).toBe(95)
  })

  it('counts a set performed exactly at the anchor as after it', () => {
    // The phase began at that instant, so the work belongs to it.
    const out = aggregateStrengthRetention(
      [lift({ performedAt: BEFORE, weight: 100 }), lift({ performedAt: ANCHOR, weight: 90 })],
      ANCHOR,
      null,
    )
    expect(out?.lifts.squat?.percent).toBe(90)
  })

  it('reports above 100 when a lift GREW across the phase', () => {
    // Rare during a cut, but real — clamping would hide the best news the
    // widget could carry.
    const out = aggregateStrengthRetention(
      [lift({ performedAt: BEFORE, weight: 100 }), lift({ performedAt: AFTER, weight: 110 })],
      ANCHOR,
      null,
    )
    expect(out!.lifts.squat!.percent).toBeGreaterThan(100)
  })

  it('ignores a lift with nothing on one side of the anchor', () => {
    // First trained mid-cut: there is no "before" to hold against.
    const out = aggregateStrengthRetention([lift({ performedAt: AFTER })], ANCHOR, null)
    expect(out).toBeNull()
  })

  it('weights by load, so a heavy lift is not outvoted by a light one', () => {
    const out = aggregateStrengthRetention(
      [
        // deadlift 200 -> 200 (held)
        lift({
          wgerExerciseId: 184,
          exerciseName: 'Deadlift',
          performedAt: BEFORE,
          reps: 1,
          weight: 200,
        }),
        lift({
          wgerExerciseId: 184,
          exerciseName: 'Deadlift',
          performedAt: AFTER,
          reps: 1,
          weight: 200,
        }),
        // ohp 50 -> 25 (halved)
        lift({
          wgerExerciseId: 687,
          exerciseName: 'Overhead Press',
          performedAt: BEFORE,
          reps: 1,
          weight: 50,
        }),
        lift({
          wgerExerciseId: 687,
          exerciseName: 'Overhead Press',
          performedAt: AFTER,
          reps: 1,
          weight: 25,
        }),
      ],
      ANCHOR,
      null,
    )
    // A mean of percentages would say 75%. Load-weighted says 90%, which is
    // the honest reading: 225 kg of 250 kg held.
    expect(out?.percent).toBe(90)
  })

  it('returns null when no canonical lift is present at all', () => {
    expect(
      aggregateStrengthRetention(
        [lift({ wgerExerciseId: 999999, exerciseName: 'Curl' })],
        ANCHOR,
        null,
      ),
    ).toBeNull()
  })
})

describe('aggregatePlanAdherence', () => {
  it('counts a set that met both of its targets', () => {
    expect(
      aggregatePlanAdherence([
        { prescribedLoadKg: 100, prescribedRepMin: 5, weight: 100, reps: 5 },
      ]),
    ).toEqual({ hit: 1, total: 1 })
  })

  it('counts overshooting as met — a prescription is a floor, not a ceiling', () => {
    expect(
      aggregatePlanAdherence([
        { prescribedLoadKg: 100, prescribedRepMin: 5, weight: 105, reps: 8 },
      ]),
    ).toEqual({ hit: 1, total: 1 })
  })

  it('misses when either target is short', () => {
    expect(
      aggregatePlanAdherence([
        { prescribedLoadKg: 100, prescribedRepMin: 5, weight: 95, reps: 5 },
        { prescribedLoadKg: 100, prescribedRepMin: 5, weight: 100, reps: 4 },
      ]),
    ).toEqual({ hit: 0, total: 2 })
  })

  it('judges a set on only the target it was given', () => {
    expect(
      aggregatePlanAdherence([
        { prescribedLoadKg: 100, prescribedRepMin: null, weight: 100, reps: 1 },
        { prescribedLoadKg: null, prescribedRepMin: 5, weight: 0, reps: 5 },
      ]),
    ).toEqual({ hit: 2, total: 2 })
  })

  it('does not count a set that carried no prescription', () => {
    // Not evidence about a plan nobody made.
    expect(
      aggregatePlanAdherence([
        {
          prescribedLoadKg: null,
          prescribedRepMin: null,
          weight: 100,
          reps: 5,
        },
        { prescribedLoadKg: 100, prescribedRepMin: null, weight: 100, reps: 5 },
      ]),
    ).toEqual({ hit: 1, total: 1 })
  })

  it('tolerates float drift on the stored load', () => {
    // Prescribed loads are numeric(6,2) and actuals are user-entered; an
    // exact >= would fail on 62.5 vs 62.499999.
    expect(
      aggregatePlanAdherence([
        {
          prescribedLoadKg: 62.5,
          prescribedRepMin: null,
          weight: 62.4999999,
          reps: 5,
        },
      ]),
    ).toEqual({ hit: 1, total: 1 })
  })

  it('stays silent for someone training without a program', () => {
    expect(aggregatePlanAdherence([])).toBeNull()
    expect(
      aggregatePlanAdherence([
        { prescribedLoadKg: null, prescribedRepMin: null, weight: 1, reps: 1 },
      ]),
    ).toBeNull()
  })
})
