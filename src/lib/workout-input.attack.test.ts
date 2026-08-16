/**
 * Adversarial regression tests for the wire trust boundary (parseWorkoutInput):
 * hostile per-field values, cross-field metric exclusivity, and the #206
 * completed-set gate (weight required for weight_reps; duration for the cardio
 * modes) — adopted from the adversarial verification round.
 */
import { describe, it, expect } from 'vitest'
import { parseWorkoutInput, MAX_DISTANCE_M } from './workout-input'

function workout(
  setOverrides: Record<string, unknown>,
  exerciseOverrides: Record<string, unknown> = {},
) {
  return {
    exercises: [
      {
        wgerExerciseId: 73,
        name: 'Squat',
        loggingType: 'weight_reps',
        ...exerciseOverrides,
        sets: [{ reps: null, weight: null, ...setOverrides }],
      },
    ],
  }
}

describe('per-field bounds hold', () => {
  it('rejects float, negative, and past-ceiling durationSec', () => {
    expect(() => parseWorkoutInput(workout({ metricMode: 'duration', durationSec: 30.5 }))).toThrow()
    expect(() => parseWorkoutInput(workout({ metricMode: 'duration', durationSec: -1 }))).toThrow()
    expect(() => parseWorkoutInput(workout({ metricMode: 'duration', durationSec: 86_401 }))).toThrow()
    expect(() =>
      parseWorkoutInput(workout({ metricMode: 'duration', durationSec: 86_400 })),
    ).not.toThrow()
  })

  it('rejects NaN/Infinity/negative/past-ceiling distanceM; accepts the exact numeric(9,2) ceiling', () => {
    const base = { metricMode: 'duration_distance', durationSec: 60 }
    expect(() => parseWorkoutInput(workout({ ...base, distanceM: Number.NaN }))).toThrow()
    expect(() =>
      parseWorkoutInput(workout({ ...base, distanceM: Number.POSITIVE_INFINITY })),
    ).toThrow()
    expect(() => parseWorkoutInput(workout({ ...base, distanceM: -0.01 }))).toThrow()
    expect(() => parseWorkoutInput(workout({ ...base, distanceM: MAX_DISTANCE_M + 0.005 }))).toThrow()
    expect(() => parseWorkoutInput(workout({ ...base, distanceM: MAX_DISTANCE_M }))).not.toThrow()
    // A float distance below the ceiling is fine (numeric(9,2) rounding is the DB's).
    expect(() => parseWorkoutInput(workout({ ...base, distanceM: 1234.56 }))).not.toThrow()
  })

  it('rejects an off-whitelist metricMode and a stringly-typed durationSec', () => {
    expect(() => parseWorkoutInput(workout({ metricMode: 'swim' }))).toThrow()
    expect(() =>
      parseWorkoutInput(workout({ metricMode: 'duration', durationSec: '1800' })),
    ).toThrow()
  })

  it('null metricMode falls back to the column default silently (documented behavior)', () => {
    const parsed = parseWorkoutInput(workout({ metricMode: null }))
    expect(parsed.exercises[0]!.sets[0]!.metricMode).toBeUndefined()
  })
})

describe('cross-field exclusivity and the completed-set gate', () => {
  it('a reps_weight set carrying durationSec is rejected', () => {
    // metricMode absent → reps_weight; a duration on it is cross-field nonsense
    // the draft layer never produces, so the boundary should refuse it.
    expect(() => parseWorkoutInput(workout({ reps: 5, weight: 100, durationSec: 3600 }))).toThrow()
  })

  it('a duration set carrying reps/weight is rejected', () => {
    // draftToInput hard-nulls reps/weight for cardio sets ("a stray typed rep
    // on a timed set must not leak into scoring") — the wire should enforce
    // the same exclusivity against non-draft callers (MCP, hostile client).
    expect(() =>
      parseWorkoutInput(
        workout({ metricMode: 'duration', durationSec: 1800, reps: 10, weight: 100 }),
      ),
    ).toThrow()
  })

  it('a duration-mode set carrying distanceM is rejected (distance belongs to duration_distance)', () => {
    expect(() =>
      parseWorkoutInput(workout({ metricMode: 'duration', durationSec: 1800, distanceM: 5000 })),
    ).toThrow()
  })

  it('#206 at the wire: a completed weight-less weight_reps set is rejected', () => {
    expect(() => parseWorkoutInput(workout({ reps: 15, weight: null, completed: true }))).toThrow()
  })

  it('cardio parity of #206 at the wire: a completed duration set with no duration is rejected', () => {
    expect(() =>
      parseWorkoutInput(workout({ metricMode: 'duration', durationSec: null, completed: true })),
    ).toThrow()
  })
})
