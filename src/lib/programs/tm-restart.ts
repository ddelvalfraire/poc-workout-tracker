import type { Progression } from '@/lib/programs/program-input'
import type { AutoregAdjustment } from '@/lib/programs/autoregulate'

/**
 * Block-restart TM carry-forward (block sequencing plan §5) — the pure half.
 * At restart/clone time each amrap-cycle exercise on a CLEAN block earns one
 * `incrementKg` bump through `setTrainingMax` (reason 'block-restart');
 * an M4-FLAGGED exercise ("TM likely set too high" — 3 straight stalls) is
 * skipped and offered a reset suggestion in the restart confirm step instead.
 * These collectors turn (days, derived prescriptions) into that plan; the io
 * half (db/restart-plan.ts) derives the prescriptions.
 *
 * Unlike collectTmResetProposals (detail-view.ts), flags here keep EVERY
 * address and never dedupe by name: the skip list must cover each occurrence
 * of a lift, not just the first.
 */

/** A 0-based (day, exercise) address, matching the patch-op addressing. */
export interface TmRestartAddress {
  dayPosition: number
  exercisePosition: number
}

/** One M4-flagged lift: no auto-increment; suggest a reset instead. */
export interface TmRestartFlag extends TmRestartAddress {
  exerciseName: string
  currentTmKg: number
}

/** One clean amrap-cycle lift stepping up for the new block. */
export interface TmIncrement extends TmRestartAddress {
  exerciseName: string
  fromKg: number
  toKg: number
}

interface ExerciseSlice {
  name: string
  progression: Progression | null
}

type DaysSlice = readonly { exercises: readonly ExerciseSlice[] }[]
type PrescriptionsSlice = readonly (readonly { autoreg: AutoregAdjustment | null }[])[]

/**
 * Every M4-flagged TM-bearing exercise (percent-1rm / amrap-cycle), by
 * address. percent-1rm flags carry no increment to skip, but they still feed
 * the restart confirm's reset suggestion, so both schemes collect.
 */
export function collectTmRestartFlags(
  days: DaysSlice,
  prescriptions: PrescriptionsSlice,
): TmRestartFlag[] {
  const flags: TmRestartFlag[] = []
  days.forEach((day, dayIndex) => {
    day.exercises.forEach((exercise, exerciseIndex) => {
      const adjustment = prescriptions[dayIndex]?.[exerciseIndex]?.autoreg ?? null
      if (adjustment === null || adjustment.action !== 'flag') return
      const progression = exercise.progression
      if (progression?.scheme !== 'percent-1rm' && progression?.scheme !== 'amrap-cycle') return
      flags.push({
        exerciseName: exercise.name,
        dayPosition: dayIndex,
        exercisePosition: exerciseIndex,
        currentTmKg: progression.trainingMaxKg,
      })
    })
  })
  return flags
}

/**
 * The increments a restart should apply: every amrap-cycle exercise with a
 * real `incrementKg` whose address is NOT flagged. `toKg` is the stored TM
 * plus ONE increment — the block-boundary bump; wave-completion bumps within
 * the old block are already folded into the stored TM by the cycle-end bank.
 */
export function collectTmIncrements(
  days: DaysSlice,
  flagged: readonly TmRestartAddress[],
): TmIncrement[] {
  const skip = new Set(flagged.map((f) => `${f.dayPosition}:${f.exercisePosition}`))
  const increments: TmIncrement[] = []
  days.forEach((day, dayIndex) => {
    day.exercises.forEach((exercise, exerciseIndex) => {
      const progression = exercise.progression
      if (progression?.scheme !== 'amrap-cycle') return
      if (!(progression.incrementKg > 0)) return
      if (skip.has(`${dayIndex}:${exerciseIndex}`)) return
      increments.push({
        exerciseName: exercise.name,
        dayPosition: dayIndex,
        exercisePosition: exerciseIndex,
        fromKg: progression.trainingMaxKg,
        toKg: progression.trainingMaxKg + progression.incrementKg,
      })
    })
  })
  return increments
}
