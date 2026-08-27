import { and, eq } from 'drizzle-orm'
import { db } from './index'
import { programDays, programs, workouts } from './schema'
import { programWeekState } from './programs'
import { NO_CASCADE, type UncompleteCascade } from '@/lib/uncomplete-cascade'

export {
  NO_CASCADE,
  hasCascade,
  type UncompleteCascade,
} from '@/lib/uncomplete-cascade'

/**
 * What un-completing one session would DRAG WITH IT.
 *
 * The un-complete itself is the thing the user just asked for; naming it back
 * to them would be "Are you sure?". The consequence they cannot predict is
 * the cascade — the block silently rolling back a week, and next session's
 * targets then being worked out again off the earlier week. That is the only
 * part worth an interruption, so this module exists to decide whether there
 * IS one. No cascade, no dialog: a modal that fires every time is a modal
 * nobody reads.
 *
 * The answer is a DRY RUN, not a prediction. `programWeekState` derives the
 * week from history with no stored counter, so it is simply re-run with the
 * target workout held out and the two answers diffed. A future change to the
 * week rule can therefore never leave this guard describing a cascade the app
 * no longer performs.
 */

/**
 * The cascade of un-completing `workoutId`, or `NO_CASCADE`.
 *
 * Returns `NO_CASCADE` rather than throwing for a workout that is missing,
 * not owned, already incomplete, or not attached to a program day: none of
 * those can move a week axis, and a guard is not the place to relitigate
 * ownership — the write path owns that check.
 */
export async function uncompleteCascade(
  userId: string,
  workoutId: string,
): Promise<UncompleteCascade> {
  const [row] = await db
    .select({
      programId: programs.id,
      mesocycleWeeks: programs.mesocycleWeeks,
      completedAt: workouts.completedAt,
    })
    .from(workouts)
    .innerJoin(programDays, eq(programDays.id, workouts.programDayId))
    .innerJoin(programs, eq(programs.id, programDays.programId))
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))

  if (!row || row.completedAt === null) return NO_CASCADE

  // The same rule twice — with the row, and without it. Sequential would be a
  // wasted round-trip: neither read depends on the other.
  const [now, without] = await Promise.all([
    programWeekState(userId, row.programId, row.mesocycleWeeks),
    programWeekState(userId, row.programId, row.mesocycleWeeks, { excludeWorkoutId: workoutId }),
  ])

  return {
    // Strictly BACKWARD. The rule clamps, and through the documented manual-
    // overshoot anomaly it can report an unchanged or even higher week
    // without the row; neither is a rollback, and calling one "your block
    // goes back to week N" would put a lie in the dialog.
    weekRollback:
      without.currentWeek < now.currentWeek
        ? { from: now.currentWeek, to: without.currentWeek }
        : null,
    blockReopens: now.blockComplete && !without.blockComplete,
  }
}
