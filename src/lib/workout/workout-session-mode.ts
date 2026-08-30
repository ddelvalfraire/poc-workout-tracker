import type { WorkoutEventKind } from '@/db/workout-events'

/**
 * WHICH OF ITS TWO MODES the `/workout/[id]/edit` surface is in — and, from
 * that, WHAT its save means for the change log.
 *
 * One page hosts both a live session being logged and a post-hoc correction of
 * a finished one (`start-day-button` routes a freshly instantiated program day
 * straight here; the summary's "Edit" arrives at the same URL), so the two are
 * told apart by one discriminator. This module is that discriminator, kept
 * pure and alone so it can be pinned by a test.
 *
 * The discriminator is `originalRecordedAt` — the stamp the session-scoped
 * writes leave when a session's original record is persisted.
 *
 * It is NOT `completedAt`, and that is the whole point. `completedAt` answers
 * "does this session count as done?", and the MCP patch tools stamp it via
 * coalesce(…, now()) the first time they touch a set. So a coach patching one
 * set of a session the lifter is still logging flips `completedAt` non-null
 * mid-session; a page reading it would then hand the logger's eventual Finish
 * — that session's ORIGINAL persist — to the log as an `amendment`. The
 * clinical rule the log exists for is that a reader can trust what "corrected"
 * means, and a first record filed as a correction breaks it.
 */

/** The two workout facts this decision is allowed to see. `completedAt` is in
 *  the shape ON PURPOSE: callers pass the whole workout, and the answer must
 *  not move when it changes. */
export interface WorkoutRecordState {
  /** When the session's original record was persisted; null = never. */
  originalRecordedAt: Date | null
  /** Present so it is visibly ignored — see the module comment. */
  completedAt: Date | null
}

/**
 * True while the session has no original record yet: it is being logged now,
 * and this surface is a logger (volt Finish, session clock, home on close).
 * False once one exists: the surface is a correction desk (Save changes).
 *
 * Deliberately blind to `completedAt`, including after `uncompleteWorkout` —
 * un-completing a session to fix it does not un-record it, so the fix is still
 * a correction and the log still says so.
 */
export function isLiveSession(workout: WorkoutRecordState): boolean {
  return workout.originalRecordedAt === null
}

/**
 * What a save from this surface MEANS, declared for `WorkoutChangeContext`.
 * A live session's save is that session's first record; anything else
 * contradicts a record that already exists.
 */
export function declaredSaveKind(
  isLive: boolean,
): Extract<WorkoutEventKind, 'original' | 'amendment'> {
  return isLive ? 'original' : 'amendment'
}
