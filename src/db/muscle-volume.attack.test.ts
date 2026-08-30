import { describe, it, expect } from 'vitest'
import {
  aggregateMuscleVolume,
  type MuscleVolumeRow,
  type MuscleResolver,
} from './muscle-volume'
import { volumeWindows } from '@/lib/stats/volume-window'

/**
 * ADVERSARIAL VERIFICATION of cardio v1 slice 3 (#219 / PR #242) — weekly
 * cardio minutes inside the muscle-volume aggregate. Spec claims under attack:
 *  - duration-mode rows sum seconds into currentCardioSec/previousCardioSec
 *    and NEVER count as sets, sessions, or muscle credits;
 *  - reps_weight rows with a stray durationSec never leak into cardio seconds;
 *  - the window split (current vs previous vs out-of-horizon) is honored for
 *    cardio seconds exactly as for sets, boundary instants included.
 * Pure-aggregate fixtures only; evidence, never fixes.
 */

const NOW = new Date('2026-08-12T12:00:00Z') // a Wednesday
const windows = volumeWindows('rolling', NOW)

const chestResolver: MuscleResolver = () => ({ primary: ['Chest'], secondary: [] })

function cardioRow(overrides: Partial<MuscleVolumeRow> = {}): MuscleVolumeRow {
  return {
    workoutId: 'w1',
    startedAt: new Date('2026-08-11T10:00:00Z'), // inside current rolling week
    wgerExerciseId: 1,
    source: 'wger',
    metricMode: 'duration',
    durationSec: 600,
    ...overrides,
  }
}

const liftRow = (overrides: Partial<MuscleVolumeRow> = {}): MuscleVolumeRow =>
  cardioRow({ metricMode: 'reps_weight', durationSec: null, ...overrides })

describe('ATTACK: cardio seconds never masquerade as sets or muscle credit', () => {
  it('duration rows add seconds but zero sets, zero sessions, zero group credit', () => {
    const result = aggregateMuscleVolume(
      [cardioRow({ durationSec: 1200 }), cardioRow({ durationSec: 600 })],
      chestResolver,
      windows,
    )
    expect(result.totals.currentCardioSec).toBe(1800)
    expect(result.totals.currentSets).toBe(0)
    expect(result.totals.currentSessions).toBe(0) // a cardio-only workout is not a "session" in the set counter
    const chest = result.groups.find((g) => g.group === 'Chest')
    expect(chest?.currentSets).toBe(0)
  })

  it('duration_distance rows count into cardio seconds the same as duration rows', () => {
    const result = aggregateMuscleVolume(
      [cardioRow({ metricMode: 'duration_distance', durationSec: 900 })],
      chestResolver,
      windows,
    )
    expect(result.totals.currentCardioSec).toBe(900)
    expect(result.totals.currentSets).toBe(0)
  })

  it('a duration row with NULL durationSec contributes 0, never NaN', () => {
    const result = aggregateMuscleVolume(
      [cardioRow({ durationSec: null }), cardioRow({ durationSec: 300 })],
      chestResolver,
      windows,
    )
    expect(result.totals.currentCardioSec).toBe(300)
    expect(Number.isNaN(result.totals.currentCardioSec)).toBe(false)
  })

  it('a reps_weight row with a STRAY durationSec counts as a set — never as cardio seconds', () => {
    const result = aggregateMuscleVolume(
      [liftRow({ durationSec: 3600 })],
      chestResolver,
      windows,
    )
    expect(result.totals.currentCardioSec).toBe(0)
    expect(result.totals.currentSets).toBe(1)
    expect(result.groups.find((g) => g.group === 'Chest')?.currentSets).toBe(1)
  })

  it('a mixed workout splits cleanly: lifting rows to sets/credits, timed rows to seconds', () => {
    const result = aggregateMuscleVolume(
      [
        liftRow({ workoutId: 'w1' }),
        liftRow({ workoutId: 'w1' }),
        cardioRow({ workoutId: 'w1', durationSec: 600 }),
      ],
      chestResolver,
      windows,
    )
    expect(result.totals.currentSets).toBe(2)
    expect(result.totals.currentSessions).toBe(1)
    expect(result.totals.currentCardioSec).toBe(600)
    expect(result.groups.find((g) => g.group === 'Chest')?.currentSets).toBe(2)
  })
})

describe('ATTACK: window discipline for cardio seconds', () => {
  it('previous-window cardio lands in previousCardioSec, not current', () => {
    const result = aggregateMuscleVolume(
      [cardioRow({ startedAt: new Date('2026-08-03T10:00:00Z'), durationSec: 500 })],
      chestResolver,
      windows,
    )
    expect(result.totals.currentCardioSec).toBe(0)
    expect(result.totals.previousCardioSec).toBe(500)
  })

  it('the current-window START instant is inclusive (rolling: exactly 7×24h ago)', () => {
    const boundary = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000)
    const result = aggregateMuscleVolume(
      [cardioRow({ startedAt: boundary, durationSec: 111 })],
      chestResolver,
      windows,
    )
    expect(result.totals.currentCardioSec).toBe(111)
    expect(result.totals.previousCardioSec).toBe(0)
  })

  it('cardio before the previous window is dropped entirely (horizon over-fetch tolerance)', () => {
    const result = aggregateMuscleVolume(
      [cardioRow({ startedAt: new Date('2026-07-01T10:00:00Z'), durationSec: 999 })],
      chestResolver,
      windows,
    )
    expect(result.totals.currentCardioSec).toBe(0)
    expect(result.totals.previousCardioSec).toBe(0)
  })

  it('a just-logged future-skewed cardio session still counts as CURRENT (open upper edge)', () => {
    const result = aggregateMuscleVolume(
      [cardioRow({ startedAt: new Date(NOW.getTime() + 5 * 60 * 1000), durationSec: 240 })],
      chestResolver,
      windows,
    )
    expect(result.totals.currentCardioSec).toBe(240)
  })

  it('calendar-mode Monday boundary splits cardio at the client-local week edge', () => {
    // Client at UTC (offset 0). NOW is Wed 2026-08-12; week starts Mon 2026-08-10T00:00Z.
    const cal = volumeWindows('calendar', NOW, 0)
    const result = aggregateMuscleVolume(
      [
        cardioRow({ startedAt: new Date('2026-08-10T00:00:00Z'), durationSec: 100 }), // first instant of this week
        cardioRow({ startedAt: new Date('2026-08-09T23:59:59Z'), durationSec: 200 }), // last second of previous week
      ],
      chestResolver,
      cal,
    )
    expect(result.totals.currentCardioSec).toBe(100)
    expect(result.totals.previousCardioSec).toBe(200)
  })
})
