import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm'
import type {
  NoteAnchor,
  NoteAnchorKind,
  NoteAnchorSnapshot,
  NoteAuthor,
} from '@/lib/note-input'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { db } from './index'
import { notes, programs, sets, workoutExercises, workouts } from './schema'

/**
 * Data access for notes-v2 rows, always scoped to a Clerk userId.
 *
 * Like `db/workouts.ts`, this module is the authorization boundary: creation
 * proves anchor ownership through the join chain (a note can only hang on an
 * entity the user owns), and every other op filters by `user_id` directly.
 * Callers pass already-validated bodies (`parseNoteBody`) — validation lives
 * at the boundary, same as every other db module.
 */

/** Row type for consumers. */
export type NoteRow = typeof notes.$inferSelect

/** A note with its anchor breadcrumb context (the browser row shape). */
export interface NoteWithContext {
  id: string
  author: NoteAuthor
  body: string
  anchorKind: NoteAnchorKind
  programId: string | null
  workoutId: string | null
  workoutExerciseId: string | null
  setId: string | null
  anchorSnapshot: NoteAnchorSnapshot | null
  createdAt: Date
  updatedAt: Date
  /** Breadcrumb context, resolved through the anchor joins (live names —
   *  the frozen creation-time facts stay in anchorSnapshot). */
  workoutName: string | null
  workoutStartedAt: Date | null
  exerciseName: string | null
  setNumber: number | null
  programName: string | null
}

/** Derives the anchor kind from the one non-null FK (the DB CHECK guarantees
 *  exactly one). */
export function noteAnchorKind(row: {
  programId: string | null
  workoutId: string | null
  workoutExerciseId: string | null
  setId: string | null
}): NoteAnchorKind {
  if (row.setId !== null) return 'set'
  if (row.workoutExerciseId !== null) return 'workout_exercise'
  if (row.workoutId !== null) return 'workout'
  return 'program'
}

/** The ownership + snapshot facts resolved from an anchor before insert. */
interface ResolvedAnchor {
  snapshot: NoteAnchorSnapshot | null
}

/**
 * Proves the user owns the anchor and gathers the cheap snapshot facts in the
 * same read. Returns null when the anchor doesn't exist or isn't owned —
 * indistinguishable on purpose (no acknowledging other users' rows).
 */
async function resolveAnchor(userId: string, anchor: NoteAnchor): Promise<ResolvedAnchor | null> {
  switch (anchor.kind) {
    case 'program': {
      const [row] = await db
        .select({ id: programs.id })
        .from(programs)
        .where(and(eq(programs.id, anchor.id), eq(programs.userId, userId)))
        .limit(1)
      return row ? { snapshot: null } : null
    }
    case 'workout': {
      const [row] = await db
        .select({ id: workouts.id })
        .from(workouts)
        .where(and(eq(workouts.id, anchor.id), eq(workouts.userId, userId)))
        .limit(1)
      return row ? { snapshot: null } : null
    }
    case 'workout_exercise': {
      const [row] = await db
        .select({ exerciseName: workoutExercises.name })
        .from(workoutExercises)
        .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
        .where(and(eq(workoutExercises.id, anchor.id), eq(workouts.userId, userId)))
        .limit(1)
      return row ? { snapshot: { exerciseName: row.exerciseName } } : null
    }
    case 'set': {
      const [row] = await db
        .select({
          exerciseName: workoutExercises.name,
          setNumber: sets.setNumber,
          loadKg: sets.weight,
          reps: sets.reps,
          durationSec: sets.durationSec,
        })
        .from(sets)
        .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
        .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
        .where(and(eq(sets.id, anchor.id), eq(workouts.userId, userId)))
        .limit(1)
      if (!row) return null
      return {
        snapshot: {
          exerciseName: row.exerciseName,
          setNumber: row.setNumber,
          loadKg: row.loadKg,
          reps: row.reps,
          durationSec: row.durationSec,
        },
      }
    }
  }
}

/** The column for each anchor kind, for insert addressing. */
function anchorColumn(
  kind: NoteAnchorKind,
): 'programId' | 'workoutId' | 'workoutExerciseId' | 'setId' {
  switch (kind) {
    case 'program':
      return 'programId'
    case 'workout':
      return 'workoutId'
    case 'workout_exercise':
      return 'workoutExerciseId'
    case 'set':
      return 'setId'
  }
}

/**
 * Creates a note on an owned anchor. Set/exercise anchors get their frozen
 * `anchor_snapshot` stamped here — written once, never updated (the
 * "outdated" badge's evidence AND the fallback marker note-sync keys on).
 * Returns null when the anchor isn't owned or doesn't exist.
 *
 * `clientKey` is the offline queue's idempotency handle: the partial unique
 * on (user_id, client_key) plus ON CONFLICT DO NOTHING makes a replayed
 * flush (send landed, response lost) return the EXISTING row instead of
 * minting a duplicate — exactly-once per queued note.
 *
 * The ownership read and the insert are two statements (no tx): the only
 * race is a concurrent anchor delete, which the FK turns into a loud error —
 * the accepted single-user-POC tradeoff noted in db/programs.ts.
 */
export async function createNote(
  userId: string,
  anchor: NoteAnchor,
  body: string,
  opts: { author?: NoteAuthor; clientKey?: string } = {},
): Promise<NoteRow | null> {
  const resolved = await resolveAnchor(userId, anchor)
  if (!resolved) return null
  const values = {
    userId,
    author: opts.author ?? 'user',
    body,
    [anchorColumn(anchor.kind)]: anchor.id,
    ...(resolved.snapshot !== null ? { anchorSnapshot: resolved.snapshot } : {}),
    ...(opts.clientKey !== undefined ? { clientKey: opts.clientKey } : {}),
  }
  if (opts.clientKey === undefined) {
    const [row] = await db.insert(notes).values(values).returning()
    if (!row) throw new Error('createNote: insert returned no row')
    return row
  }
  const [row] = await db
    .insert(notes)
    .values(values)
    .onConflictDoNothing({
      target: [notes.userId, notes.clientKey],
      // Match the partial index predicate — required for Postgres to pick it.
      where: sql`${notes.clientKey} is not null`,
    })
    .returning()
  if (row) return row
  // Conflict: the note already landed on a previous flush — return it.
  const [existing] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.clientKey, opts.clientKey)))
    .limit(1)
  if (!existing) throw new Error('createNote: conflict with no existing row')
  return existing
}

/**
 * Updates the body of the user's OWN note. Author-gated to 'user': the owner
 * can delete a coach's comment on their data, but never rewrite its words.
 * Returns null when the note doesn't exist, isn't theirs, or is coach-authored.
 */
export async function updateNote(
  userId: string,
  noteId: string,
  body: string,
): Promise<NoteRow | null> {
  const [row] = await db
    .update(notes)
    .set({ body, updatedAt: new Date() })
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId), eq(notes.author, 'user')))
    .returning()
  return row ?? null
}

/**
 * Deletes a note the user owns (any author — it's their data). Returns false
 * when nothing matched (absent or someone else's — owner-scoped where, so
 * cross-user deletion is impossible by construction).
 */
export async function deleteNote(userId: string, noteId: string): Promise<boolean> {
  const rows = await db
    .delete(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .returning({ id: notes.id })
  return rows.length > 0
}

/** Optional filters for the browser query. */
export interface ListNotesFilters {
  anchorKind?: NoteAnchorKind
  programId?: string
  workoutId?: string
  workoutExerciseId?: string
  setId?: string
  /**
   * Exercise IDENTITY (source + id), not one instance: every note anchored to
   * ANY workout_exercise of this identity — directly or through one of its
   * sets — across all workouts. The exercise page's reverse index. Fallback
   * re-anchored rows (workout-anchored, snapshot-carrying) drop out by
   * construction: their exercise row is gone, so the join can't prove
   * identity — the browser's outdated badge is where those surface.
   */
  exercise?: { source: ExerciseSource; exerciseId: number }
  limit?: number
  offset?: number
}

/** Generous page ceiling for the browser; callers page below it. */
const MAX_LIST_LIMIT = 200

/** Shared breadcrumb projection for the anchor-context joins. */
const contextSelection = {
  id: notes.id,
  author: notes.author,
  body: notes.body,
  programId: notes.programId,
  workoutId: notes.workoutId,
  workoutExerciseId: notes.workoutExerciseId,
  setId: notes.setId,
  anchorSnapshot: notes.anchorSnapshot,
  createdAt: notes.createdAt,
  updatedAt: notes.updatedAt,
  workoutName: workouts.name,
  workoutStartedAt: workouts.startedAt,
  exerciseName: workoutExercises.name,
  setNumber: sets.setNumber,
  programName: programs.name,
}

/**
 * The anchor-context join skeleton: a set note reaches its exercise through
 * the set row, an exercise note directly, and both reach the workout through
 * the exercise — so ONE query serves every anchor kind (that's how the
 * browser "understands workouts").
 */
function contextQuery() {
  return db
    .select(contextSelection)
    .from(notes)
    .leftJoin(sets, eq(sets.id, notes.setId))
    .leftJoin(
      workoutExercises,
      eq(workoutExercises.id, sql`coalesce(${notes.workoutExerciseId}, ${sets.workoutExerciseId})`),
    )
    .leftJoin(
      workouts,
      eq(workouts.id, sql`coalesce(${notes.workoutId}, ${workoutExercises.workoutId})`),
    )
    .leftJoin(programs, eq(programs.id, notes.programId))
}

type ContextRow = Omit<NoteWithContext, 'anchorKind'>

function withKind(row: ContextRow): NoteWithContext {
  return { ...row, anchorKind: noteAnchorKind(row) }
}

/** The one non-null-FK condition for an anchor-kind filter. */
function anchorKindCondition(kind: NoteAnchorKind) {
  switch (kind) {
    case 'program':
      return isNotNull(notes.programId)
    case 'workout':
      return isNotNull(notes.workoutId)
    case 'workout_exercise':
      return isNotNull(notes.workoutExerciseId)
    case 'set':
      return isNotNull(notes.setId)
  }
}

/**
 * The browser query: the user's notes, newest first, each with its anchor
 * breadcrumb (workout name/date, exercise name, set number, program name).
 * Filterable by anchor kind and/or specific anchor ids.
 */
export async function listNotes(
  userId: string,
  filters: ListNotesFilters = {},
): Promise<NoteWithContext[]> {
  const rows = await contextQuery()
    .where(
      and(
        eq(notes.userId, userId),
        filters.anchorKind !== undefined ? anchorKindCondition(filters.anchorKind) : undefined,
        filters.programId !== undefined ? eq(notes.programId, filters.programId) : undefined,
        filters.workoutId !== undefined ? eq(notes.workoutId, filters.workoutId) : undefined,
        filters.workoutExerciseId !== undefined
          ? eq(notes.workoutExerciseId, filters.workoutExerciseId)
          : undefined,
        filters.setId !== undefined ? eq(notes.setId, filters.setId) : undefined,
        // eq against the LEFT-joined exercise columns: rows whose anchor
        // chain reaches no workout_exercise (workout/program anchors) have
        // NULL there and never match — no extra isNotNull needed.
        filters.exercise !== undefined
          ? eq(workoutExercises.source, filters.exercise.source)
          : undefined,
        filters.exercise !== undefined
          ? eq(workoutExercises.wgerExerciseId, filters.exercise.exerciseId)
          : undefined,
      ),
    )
    .orderBy(desc(notes.createdAt), desc(notes.id))
    .limit(Math.min(filters.limit ?? MAX_LIST_LIMIT, MAX_LIST_LIMIT))
    .offset(filters.offset ?? 0)
  return rows.map(withKind)
}

/**
 * Every note anchored anywhere inside one owned workout — the workout row
 * itself, its exercises, or their sets — oldest first (reading order). The
 * get_workout ride-along shape: flat rows with `anchorKind` + the effective
 * ids, for callers to key per exercise/set for render. The workout join in
 * the skeleton reaches all three tiers, so ownership rides the same where.
 */
export async function notesForWorkout(
  userId: string,
  workoutId: string,
): Promise<NoteWithContext[]> {
  const rows = await contextQuery()
    .where(and(eq(notes.userId, userId), eq(workouts.id, workoutId)))
    .orderBy(asc(notes.createdAt), asc(notes.id))
  return rows.map(withKind)
}
