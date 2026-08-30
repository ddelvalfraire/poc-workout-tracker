import { revalidatePath } from 'next/cache'
import { getWorkoutDetail, latestCompletedWorkoutForDay } from '@/db/workouts'
import { getProgramDayDetail } from '@/db/programs'
import { syncProgramExerciseLoads } from '@/db/program-patches'
import { getWeightUnit } from '@/db/preferences'
import { detectPlanSyncCandidates, planSyncEventSummary } from '@/lib/programs/plan-sync'

/**
 * Automatic plan-sync after a workout save: when a completed
 * program-provenance session outperformed the plan's suggested loads (see
 * lib/plan-sync.ts for the detection rules), the plan silently adopts the
 * performed loads. No confirmation surface — the program change-log
 * (`program_events`, one `sync_plan_to_performance` event per exercise) is the
 * audit trail. Candidates are computed here from the stored workout and the
 * CURRENT plan; nothing client-supplied is trusted.
 *
 * Guards are silent no-ops, not throws — this runs unconditionally on every
 * save, where "nothing to sync" is the common case:
 * - no program provenance (quick logs) or not completed → return;
 * - not the LATEST completed session of its day → return (an edit to an older
 *   workout must never regress the plan to stale loads);
 * - program day deleted, or no candidates (already synced — idempotent) → return.
 *
 * The workout is the fact; the sync is derived from it. Any failure here is
 * caught and logged — it must NEVER fail the save that triggered it. Shared by
 * the web finish/edit path (workout actions) and any future MCP complete path.
 */
export async function autoSyncPlanToPerformance(userId: string, workoutId: string): Promise<void> {
  try {
    const workout = await getWorkoutDetail(userId, workoutId)
    if (!workout?.programDayId || workout.completedAt === null) return
    const [latest, previous] = await latestCompletedWorkoutForDay(userId, workout.programDayId)
    if (latest?.id !== workout.id) return
    const day = await getProgramDayDetail(userId, workout.programDayId)
    if (!day) return
    // Per-program opt-out (programs.planSync, default ON): deliberate-
    // percentage programs (5/3/1-style waves) prescribe less than the lifter
    // performs BY DESIGN — the flag rides the same day read, no extra query.
    if (!day.program.planSync) return

    // The day's PREVIOUS completed session confirms up-anchors (M2): a plan
    // load is only raised after two consecutive outperformed sessions.
    const previousWorkout = previous ? await getWorkoutDetail(userId, previous.id) : null
    const candidates = detectPlanSyncCandidates(
      workout.exercises,
      day.exercises,
      previousWorkout?.exercises,
    )
    if (candidates.length === 0) return

    const unit = await getWeightUnit(userId)
    let syncedExercises = 0
    for (const candidate of candidates) {
      // One narrow patch per exercise: per-set load writes + ONE change-log
      // event, inside the op's own transaction. A slot that vanished since the
      // workout was instantiated (concurrent edit) returns null/0 and is
      // skipped — the remaining exercises still sync.
      const result = await syncProgramExerciseLoads(
        userId,
        day.program.id,
        day.position,
        candidate.exercisePosition,
        candidate.changes.map((c) => ({ setNumber: c.setNumber, suggestedLoadKg: c.proposedLoadKg })),
        // The actor is the user finishing their own workout on a UI surface.
        'ui',
        planSyncEventSummary(candidate, unit),
      )
      if (result !== null && result.updated > 0) syncedExercises += 1
    }
    if (syncedExercises > 0) {
      revalidatePath('/programs')
      revalidatePath(`/programs/${day.program.id}`)
    }
  } catch (error) {
    // Fails soft: the save already committed and is the source of truth.
    console.error('auto plan-sync failed (workout saved; plan left unchanged)', error)
  }
}
