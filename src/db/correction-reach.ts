import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { getBodyweightKg } from './preferences'
import {
  aggregateExerciseStats,
  exerciseStatsRows,
  type ExerciseStatsQueryRow,
} from './exercise-stats'
import { correctionReach, type CorrectionReach, type SettledDecision } from '@/lib/record-reach'

export { correctionReach } from '@/lib/record-reach'
export type { CorrectionReach, RecordReachItem, SettledDecision } from '@/lib/record-reach'

/**
 * GUARD 2, the io half — what a proposed correction would reach.
 *
 * ONE scan, aggregated TWICE. `getExerciseStats` is a single unindexed scan
 * over the exercise's history, but `aggregateExerciseStats` is pure, so the
 * rows are fetched once and folded against the stored history and against an
 * edited copy of it. Nothing is written and nothing is guessed: the "after"
 * board comes out of the same function that produced the "before" one, so the
 * disclosure cannot describe a record move the save would not make.
 *
 * Called at SAVE-INTENT — a blur or a confirm — never per keystroke. A record
 * diff on every digit is a scan per digit AND a disclosure that flickers
 * while the reader is still typing.
 */

/** The set being corrected, addressed the way the record board addresses it. */
export interface SetCorrection {
  workoutId: string
  exercisePosition: number
  setNumber: number
  /** Omitted fields are unchanged. Kg, canonical — display converts. */
  reps?: number | null
  weightKg?: number | null
}

/** Applies the correction to a COPY of the rows. Immutable throughout: the
 *  stored fold must see the original rows, and mutating in place would make
 *  the two aggregations agree by construction — a guard that is silent
 *  forever and looks like it works. */
function applyCorrection(
  rows: readonly ExerciseStatsQueryRow[],
  edit: SetCorrection,
): ExerciseStatsQueryRow[] {
  return rows.map((row) => {
    const addresses =
      row.workoutId === edit.workoutId &&
      row.exercisePosition === edit.exercisePosition &&
      row.setNumber === edit.setNumber
    if (!addresses) return row
    return {
      ...row,
      reps: edit.reps === undefined ? row.reps : edit.reps,
      weight: edit.weightKg === undefined ? row.weight : edit.weightKg,
    }
  })
}

/**
 * The reach of `edit` on this exercise's record board, or null when nothing
 * moves — the ordinary typo fix, which gets no disclosure at all.
 *
 * `settled` is supplied by the caller rather than read here: a training max
 * lives in the program's progression JSON, not in workout history, and this
 * module is deliberately about the record board.
 */
export async function correctionReachFor(
  userId: string,
  source: ExerciseSource,
  wgerExerciseId: number,
  edit: SetCorrection,
  settled: SettledDecision | null = null,
): Promise<CorrectionReach | null> {
  const [bodyweightKg, rows] = await Promise.all([
    getBodyweightKg(userId),
    exerciseStatsRows(userId, source, wgerExerciseId),
  ])
  if (rows.length === 0) return null

  // Latest non-null wins, exactly as getExerciseStats resolves it — the two
  // folds must score under the SAME logging type or the diff is noise rather
  // than a record move.
  let loggingType: ExerciseStatsQueryRow['loggingType'] = 'weight_reps'
  for (const row of rows) if (row.loggingType !== null) loggingType = row.loggingType

  const stored = aggregateExerciseStats(rows, loggingType, bodyweightKg)
  const edited = aggregateExerciseStats(applyCorrection(rows, edit), loggingType, bodyweightKg)
  return correctionReach(stored.records, edited.records, settled)
}
