/**
 * Shared slot builders for the template canon. Every helper returns FRESH
 * objects — no two planned sets ever share state — and every payload they
 * assemble is a plain `ProgramInputUnparsed` fragment, validated by the same
 * `parseProgramInput` boundary the app's own create paths use.
 */
import type { ProgramInputUnparsed } from '../program-input'

export type DayIn = ProgramInputUnparsed['days'][number]
export type ExerciseIn = DayIn['exercises'][number]
export type SetIn = ExerciseIn['sets'][number]
export type ProgressionIn = ExerciseIn['progression']

/** `count` identical planned sets (fresh objects — nothing shares state). */
export function setsOf(count: number, set: SetIn): SetIn[] {
  return Array.from({ length: count }, () => ({ ...set }))
}

/** Straight working sets: count × repMin–repMax with a rest. */
export function work(count: number, repMin: number, repMax: number | null, restSec: number): SetIn[] {
  return setsOf(count, { repMin, repMax, restSec })
}

/** Working sets whose LAST set is an AMRAP ("5×3+" shapes). */
export function workPlus(count: number, repMin: number, restSec: number): SetIn[] {
  return [
    ...work(count - 1, repMin, null, restSec),
    { repMin, repMax: null, restSec, setType: 'amrap' },
  ]
}

/** Timed sets — `duration` metric mode, so a planned `durationSec` is required. */
export function timed(count: number, durationSec: number, restSec: number): SetIn[] {
  return setsOf(count, { metricMode: 'duration', durationSec, restSec })
}

/** One timed + distance set (a run/ride leg): both targets planned. */
export function timedDistance(durationSec: number, distanceM: number, restSec: number): SetIn {
  return { metricMode: 'duration_distance', durationSec, distanceM, restSec }
}

export function doubleProgression(
  repMin: number,
  repMax: number,
  incrementKg: number,
): ProgressionIn {
  return { scheme: 'double-progression', repMin, repMax, incrementKg }
}

export function linear(incrementKg: number): ProgressionIn {
  return { scheme: 'linear', incrementKg }
}

/** Progresses the TARGET (reps or seconds) instead of the load. */
export function repProgression(
  opts: { reps?: number; sec?: number; maxReps?: number; maxSec?: number } = {},
): ProgressionIn {
  return {
    scheme: 'rep-progression',
    incrementReps: opts.reps ?? 0,
    incrementSec: opts.sec ?? 0,
    maxReps: opts.maxReps ?? null,
    maxSec: opts.maxSec ?? null,
  }
}

/** Volume landmarks — the engine ramps sets from MEV toward MRV across the block. */
export function weeklyVolume(mevSets: number, mrvSets: number): ProgressionIn {
  return { scheme: 'weekly-volume', mevSets, mrvSets }
}

/**
 * A percentage LADDER off a training max: `wave[weekIdx][setIdx]` is the
 * fraction of the TM for that set, `waveReps` the reps beside it, and the TM
 * grows `incrementKg` per completed wave. A single-row wave means "the same
 * ladder every week, heavier TM each time" (nSuns, Madcow, Smolov); a
 * multi-row wave cycles (5/3/1, Candito).
 */
export function ladder(
  id: number,
  name: string,
  opts: {
    trainingMaxKg: number
    incrementKg: number
    wave: number[][]
    waveReps: number[][]
    restSec: number
    /** Which set indexes (0-based) are AMRAPs — the "+" sets. */
    amrapSets?: readonly number[]
    deloadRow?: { percents: number[]; reps: number }
  },
): ExerciseIn {
  const amraps = new Set(opts.amrapSets ?? [])
  const setCount = opts.wave[0].length
  return {
    wgerExerciseId: id,
    name,
    sets: Array.from({ length: setCount }, (_, i) =>
      amraps.has(i)
        ? { repMin: opts.waveReps[0][i], repMax: null, restSec: opts.restSec, setType: 'amrap' }
        : { repMin: opts.waveReps[0][i], repMax: null, restSec: opts.restSec },
    ),
    progression: {
      scheme: 'amrap-cycle',
      trainingMaxKg: opts.trainingMaxKg,
      incrementKg: opts.incrementKg,
      wave: opts.wave,
      waveReps: opts.waveReps,
      ...(opts.deloadRow ? { deloadRow: opts.deloadRow } : {}),
      tmBumpTiming: 'after-deload',
    },
  }
}

/** An accessory slot: rep-range sets, optionally on double progression. */
export function accessory(
  id: number,
  name: string,
  count: number,
  repMin: number,
  repMax: number,
  progression: ProgressionIn = null,
): ExerciseIn {
  return { wgerExerciseId: id, name, sets: work(count, repMin, repMax, 90), progression }
}

/** A compound slot: rep-range sets driven by double progression. */
export function compound(
  id: number,
  name: string,
  count: number,
  repMin: number,
  repMax: number,
  incrementKg: number,
): ExerciseIn {
  return {
    wgerExerciseId: id,
    name,
    sets: work(count, repMin, repMax, 150),
    progression: doubleProgression(repMin, repMax, incrementKg),
  }
}

/** Straight sets of five on session-linear load — the novice-program primitive. */
export function straightSets(
  id: number,
  name: string,
  count: number,
  reps: number,
  incrementKg: number,
  restSec = 180,
): ExerciseIn {
  return {
    wgerExerciseId: id,
    name,
    sets: work(count, reps, null, restSec),
    progression: linear(incrementKg),
  }
}
