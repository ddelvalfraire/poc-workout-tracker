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
