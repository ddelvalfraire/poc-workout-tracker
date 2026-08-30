import { isDraftPayload, DRAFT_TTL_MS } from '@/app/workout/new/draft-payload'

/**
 * Derives the home screen's "workout in progress" banner from the user's
 * `workout_drafts` rows — a fresh draft IS the active session (the logger
 * autosaves one on every change and the save actions delete it). Pure so the
 * projection unit-tests as a plain function; the home Server Component feeds
 * it rows and `now`.
 */

export interface ActiveSession {
  /** Draft surface: 'new' (/workout/new) or a workout uuid (edit mode). */
  key: string
  /** Trimmed workout name, or null for the card's fallback label. */
  name: string | null
  exerciseCount: number
  setCount: number
  completedSetCount: number
  openedAt: Date
}

/**
 * The freshest restorable draft projected into banner data, or null when
 * nothing is in progress. Rows past the TTL are abandoned sessions, and
 * malformed payloads are untrusted storage — both are skipped rather than
 * risking a banner that leads nowhere.
 */
export function pickActiveSession(
  rows: { key: string; payload: unknown; updatedAt: Date }[],
  now: Date,
): ActiveSession | null {
  const candidates = rows
    .filter((row) => now.getTime() - row.updatedAt.getTime() <= DRAFT_TTL_MS)
    .filter((row) => isDraftPayload(row.payload))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())

  const freshest = candidates[0]
  if (!freshest || !isDraftPayload(freshest.payload)) return null

  const { name, openedAt, draft } = freshest.payload
  const sets = draft.exercises.flatMap((exercise) => exercise.sets)
  return {
    key: freshest.key,
    name: name.trim() || null,
    exerciseCount: draft.exercises.length,
    setCount: sets.length,
    completedSetCount: sets.filter((set) => set.completed).length,
    openedAt: new Date(openedAt),
  }
}

/**
 * The logger URL an active session resumes into. `'new'` is the quick-log
 * surface (/workout/new restores its own draft); any other key is a workout
 * uuid whose live edit lives on the edit route. One function so the resume
 * banner and the session-conflict dialog can never disagree about where
 * "continue" goes.
 */
export function activeSessionHref(key: string): string {
  return key === 'new' ? '/workout/new' : `/workout/${key}/edit`
}

/** A workout summary row, as the session projection needs it. */
export interface WorkoutSessionRow {
  id: string
  name: string | null
  startedAt: Date
  completedAt: Date | null
  exerciseCount: number
  setCount: number
  completedSetCount: number
}

/**
 * The freshest started-but-unfinished workout projected into banner data, or
 * null. Covers the draft blind spot: starting a program day creates a real
 * workout row immediately, but the logger only autosaves a draft on the first
 * EDIT — an untouched session has no draft and would otherwise be invisible
 * to the banner (while wrongly reading as done elsewhere). Shares the draft
 * TTL so an abandoned start ages out of the banner on the same clock.
 */
export function activeSessionFromWorkouts(
  rows: WorkoutSessionRow[],
  now: Date,
): ActiveSession | null {
  const freshest = rows
    .filter((row) => row.completedAt === null)
    .filter((row) => now.getTime() - row.startedAt.getTime() <= DRAFT_TTL_MS)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0]
  if (!freshest) return null

  return {
    key: freshest.id,
    name: freshest.name?.trim() || null,
    exerciseCount: freshest.exerciseCount,
    setCount: freshest.setCount,
    completedSetCount: freshest.completedSetCount,
    openedAt: freshest.startedAt,
  }
}

/**
 * The home banner's single source of truth. When a draft and a workout are
 * the SAME session (draft keyed by that workout's id), the draft wins — it
 * carries the unsaved sets. When they are unrelated sessions (an abandoned
 * quick-log draft vs a freshly started program day), recency wins: the
 * banner must surface what the lifter is doing NOW, compared on the draft's
 * last touch vs the workout's start.
 */
export function resolveActiveSession(
  draftRows: { key: string; payload: unknown; updatedAt: Date }[],
  workoutRows: WorkoutSessionRow[],
  now: Date,
): ActiveSession | null {
  const draftSession = pickActiveSession(draftRows, now)
  const workoutSession = activeSessionFromWorkouts(workoutRows, now)
  if (!draftSession || !workoutSession) return draftSession ?? workoutSession
  if (draftSession.key === workoutSession.key) return draftSession

  const draftTouchedAt = draftRows.find((row) => row.key === draftSession.key)?.updatedAt
  return draftTouchedAt && draftTouchedAt.getTime() >= workoutSession.openedAt.getTime()
    ? draftSession
    : workoutSession
}
