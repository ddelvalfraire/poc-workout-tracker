/**
 * A share link was requested for a workout that is still a LIVE session
 * (completedAt null). Sharing exposes a finished summary — duration, volume,
 * PR badges — none of which exist mid-session, and a live session must never
 * be publicly viewable. Own module (not db/workout-shares.ts) for the same
 * reason as db/program-errors.ts: `instanceof` keeps a real class identity
 * even in tests that mock the shares module.
 */
export class UnfinishedWorkoutShareError extends Error {
  constructor(workoutId: string) {
    super(`Workout ${workoutId} is not completed — only finished sessions can be shared`)
    this.name = 'UnfinishedWorkoutShareError'
  }
}

/**
 * A set-level patch would leave a COMPLETED set without its required metric —
 * no weight on a weight_reps set, or no positive duration on a cardio set
 * (#206 and its cardio parity at the DB boundary). Distinct from `null` =
 * not-found: this is an INVALID edit, and the MCP tool layer surfaces the
 * message verbatim (same channel design as db/program-patches.ts'
 * ProgramPatchError). Lives here, not in db/workouts.ts, so `instanceof`
 * keeps a real class identity even in tests that mock the workouts module.
 */
export class SetCompletionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SetCompletionError'
  }
}
