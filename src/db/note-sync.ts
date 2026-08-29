import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { NoteAnchorSnapshot } from '@/lib/notes/note-input'
import { LOAD_EPSILON_KG, loadsMatch } from '@/lib/workout/load-quantize'
import { db } from './index'
import { notes, sets, workoutExercises } from './schema'

/**
 * Notes-v2 preservation + reconcile helpers for the workout write paths, all
 * transaction-scoped (the caller owns the tx — everything here must commit or
 * vanish with the workout write around it).
 *
 * THE LANDMINE: `updateWorkout` full-replaces children (delete + re-insert),
 * and every set/exercise-anchored note has a real ON DELETE CASCADE — an edit
 * would silently eat the user's words. Same bug class the prescribed_*
 * PriorSetFacts snapshots guard against, so the carry rules match theirs:
 * identity-keyed (source:exerciseId), set notes ride setNumber and only while
 * positions still align (incoming set count >= prior count); anything whose
 * anchor vanished FALLS BACK to the workout anchor with its snapshot
 * preserved — never delete a user's words.
 *
 * Mechanically it's a two-phase park/re-attach: notes are parked on the
 * workout anchor BEFORE the child delete (or the cascade wins), then
 * re-attached to the re-inserted rows after.
 */

/** The transaction handle, lifted from the callback signature (workouts.ts idiom). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Identity key for an exercise slot — the PriorSetFacts convention. */
function exerciseKey(source: string, wgerExerciseId: number): string {
  return `${source}:${wgerExerciseId}`
}

/** A child-anchored note captured before the replace. */
export interface CapturedChildNote {
  noteId: string
  /** Identity of the exercise the note (or its set) hung on. */
  exerciseKey: string
  /** 1-based set number for set-anchored notes; null = exercise-anchored. */
  setNumber: number | null
  /** The note's frozen creation-time context — the content-affinity evidence
   *  the re-attach gate compares against the re-inserted row. */
  anchorSnapshot: NoteAnchorSnapshot | null
}

/** A re-inserted set row: id plus the content the affinity gate compares. */
export interface InsertedSetRow {
  id: string
  weight: number | null
  reps: number | null
  durationSec: number | null
}

/** The re-inserted child row ids, keyed by exercise identity (first slot wins
 *  on duplicates, mirroring priorFacts) — built by insertWorkoutChildren. */
export interface InsertedChildIds {
  /** exerciseKey -> new workout_exercises.id */
  exerciseIdByKey: Map<string, string>
  /** `${exerciseKey}:${setNumber}` -> new set row (id + content). */
  setIdByKey: Map<string, InsertedSetRow>
}

/**
 * The content-affinity gate (never misattribute): a parked set note may only
 * re-attach positionally when the facts its snapshot recorded still agree
 * with the row now at that position — loadKg within the loadsMatch tolerance,
 * reps/duration exact. Snapshot fields that were null/absent at creation
 * (note taken on a not-yet-typed set) are wildcards: there is nothing to
 * contradict. A snapshot with NO recorded facts passes on position alone.
 */
export function snapshotMatchesSetRow(
  snapshot: NoteAnchorSnapshot | null,
  row: { weight: number | null; reps: number | null; durationSec: number | null },
): boolean {
  if (snapshot == null) return true
  if (snapshot.loadKg != null) {
    if (row.weight === null || !loadsMatch(snapshot.loadKg, row.weight, LOAD_EPSILON_KG)) {
      return false
    }
  }
  if (snapshot.reps != null && snapshot.reps !== row.reps) return false
  if (snapshot.durationSec != null && snapshot.durationSec !== row.durationSec) return false
  return true
}

/**
 * Captures every set/exercise-anchored note inside the workout and PARKS it
 * on the workout anchor so the child delete can't cascade it away. Returns
 * the mapping needed to re-attach after re-insert. Must run BEFORE the
 * children are deleted.
 */
export async function captureAndParkChildNotes(
  tx: Tx,
  workoutId: string,
): Promise<CapturedChildNote[]> {
  const rows = await tx
    .select({
      noteId: notes.id,
      source: workoutExercises.source,
      wgerExerciseId: workoutExercises.wgerExerciseId,
      setNumber: sets.setNumber,
      anchorSnapshot: notes.anchorSnapshot,
    })
    .from(notes)
    .leftJoin(sets, eq(sets.id, notes.setId))
    .innerJoin(
      workoutExercises,
      eq(workoutExercises.id, sql`coalesce(${notes.workoutExerciseId}, ${sets.workoutExerciseId})`),
    )
    .where(eq(workoutExercises.workoutId, workoutId))
  if (rows.length === 0) return []
  // Park: exactly-one-anchor CHECK holds because the workout FK takes over.
  // anchor_snapshot is untouched — it is the note's frozen context AND the
  // marker that distinguishes a fallback from a true session note.
  await tx
    .update(notes)
    .set({ workoutId, workoutExerciseId: null, setId: null })
    .where(
      inArray(
        notes.id,
        rows.map((r) => r.noteId),
      ),
    )
  return rows.map((r) => ({
    noteId: r.noteId,
    exerciseKey: exerciseKey(r.source, r.wgerExerciseId),
    setNumber: r.setNumber,
    anchorSnapshot: r.anchorSnapshot,
  }))
}

/**
 * Re-attaches parked notes to the re-inserted child rows. Exercise-anchored
 * notes follow their exercise identity (reorders keep them; a vanished
 * identity leaves them parked = the workout-anchor fallback). Set-anchored
 * notes additionally require positional alignment — the caller passes the
 * SAME gate PriorSetFacts uses (`alignedKeys`: identities whose incoming set
 * count >= prior count) — AND content affinity: the note's snapshot must
 * agree with the row now at that position (snapshotMatchesSetRow), or a
 * same-count within-exercise reorder would hand the note to whatever set
 * shifted into its ordinal. Any failed gate leaves the note parked, snapshot
 * intact — never misattribute, never delete.
 */
export async function reattachChildNotes(
  tx: Tx,
  captured: CapturedChildNote[],
  ids: InsertedChildIds,
  alignedKeys: ReadonlySet<string>,
): Promise<void> {
  // Group note ids per concrete new anchor so re-attachment is one UPDATE per
  // target row instead of one per note.
  const byExerciseId = new Map<string, string[]>()
  const bySetId = new Map<string, string[]>()
  for (const note of captured) {
    if (note.setNumber === null) {
      const target = ids.exerciseIdByKey.get(note.exerciseKey)
      if (target === undefined) continue // fallback: stays parked
      const list = byExerciseId.get(target) ?? []
      list.push(note.noteId)
      byExerciseId.set(target, list)
    } else {
      if (!alignedKeys.has(note.exerciseKey)) continue // shifted positions: park
      const target = ids.setIdByKey.get(`${note.exerciseKey}:${note.setNumber}`)
      if (target === undefined) continue
      // Content affinity: position agreeing is not enough after a same-count
      // reorder — the recorded facts must agree with the row too.
      if (!snapshotMatchesSetRow(note.anchorSnapshot, target)) continue
      const list = bySetId.get(target.id) ?? []
      list.push(note.noteId)
      bySetId.set(target.id, list)
    }
  }
  for (const [weId, noteIds] of byExerciseId) {
    await tx
      .update(notes)
      .set({ workoutId: null, workoutExerciseId: weId })
      .where(inArray(notes.id, noteIds))
  }
  for (const [setId, noteIds] of bySetId) {
    await tx.update(notes).set({ workoutId: null, setId }).where(inArray(notes.id, noteIds))
  }
}

/**
 * Guard for the SINGLE-set removal path (removeSet — MCP remove_set or a
 * future UI): the set's cascade would eat its notes, so before the delete
 * every note on that set falls back to the workout anchor. The snapshot is
 * preserved when present and WRITTEN AT FALLBACK TIME when absent — the
 * set's facts are about to be destroyed, and a fallback note without its
 * context would be an anonymous orphan. Never delete a user's words.
 */
export async function fallbackSetNotesBeforeRemoval(
  tx: Tx,
  workoutId: string,
  set: {
    id: string
    setNumber: number
    exerciseName: string
    weight: number | null
    reps: number | null
    durationSec: number | null
  },
): Promise<void> {
  const snapshot: NoteAnchorSnapshot = {
    exerciseName: set.exerciseName,
    setNumber: set.setNumber,
    loadKg: set.weight,
    reps: set.reps,
    durationSec: set.durationSec,
  }
  await tx
    .update(notes)
    .set({
      workoutId,
      setId: null,
      // Written-once rule holds: coalesce keeps an existing snapshot verbatim
      // and only fills the gap for notes that never had one.
      anchorSnapshot: sql`coalesce(${notes.anchorSnapshot}, ${JSON.stringify(snapshot)}::jsonb)`,
    })
    .where(eq(notes.setId, set.id))
}

/**
 * The wire-notes reconcile target: the CANONICAL note the legacy one-string
 * tiers map onto. For the workout tier that is the latest user-authored
 * workout-anchored note WITHOUT a snapshot (a snapshot marks a fallback
 * re-anchor, whose words the session-note wire must never clobber); for the
 * exercise tier, the latest user-authored note on that instance.
 */
async function canonicalNote(
  tx: Tx,
  userId: string,
  anchor: { workoutId: string } | { workoutExerciseId: string },
): Promise<{ id: string; body: string } | null> {
  const anchorCondition =
    'workoutId' in anchor
      ? and(eq(notes.workoutId, anchor.workoutId), isNull(notes.anchorSnapshot))
      : eq(notes.workoutExerciseId, anchor.workoutExerciseId)
  const [row] = await tx
    .select({ id: notes.id, body: notes.body })
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.author, 'user'), anchorCondition))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .limit(1)
  return row ?? null
}

/** Applies a wire body to a canonical row: create / update / delete. Only the
 *  canonical row is touched — additional notes on the same anchor (future
 *  capture-sheet writes) survive a full-replace save untouched. */
async function applyCanonical(
  tx: Tx,
  userId: string,
  existing: { id: string; body: string } | null,
  body: string | null,
  insertValues: typeof notes.$inferInsert,
): Promise<void> {
  if (body === null) {
    if (existing) await tx.delete(notes).where(eq(notes.id, existing.id))
    return
  }
  if (existing) {
    if (existing.body === body) return // no churn on a round-tripped draft
    await tx
      .update(notes)
      .set({ body, updatedAt: new Date() })
      .where(and(eq(notes.id, existing.id), eq(notes.userId, userId)))
    return
  }
  await tx.insert(notes).values(insertValues)
}

/**
 * Sets/clears the canonical SESSION note of a workout from a wire string
 * (`null` = clear — the full-replace "input IS the state" rule the legacy
 * column had). Shared by saveWorkout, updateWorkout, and updateWorkoutMeta so
 * the three write paths can't drift.
 */
export async function setCanonicalWorkoutNote(
  tx: Tx,
  userId: string,
  workoutId: string,
  body: string | null,
): Promise<void> {
  const existing = await canonicalNote(tx, userId, { workoutId })
  await applyCanonical(tx, userId, existing, body, {
    userId,
    author: 'user',
    body: body ?? '',
    workoutId,
  })
}

/**
 * Sets/clears the canonical instance note of one workout exercise. New rows
 * carry the {exerciseName} snapshot every exercise-anchored note gets at
 * creation (the frozen-context rule).
 */
export async function setCanonicalExerciseNote(
  tx: Tx,
  userId: string,
  workoutExerciseId: string,
  exerciseName: string,
  body: string | null,
): Promise<void> {
  const existing = await canonicalNote(tx, userId, { workoutExerciseId })
  await applyCanonical(tx, userId, existing, body, {
    userId,
    author: 'user',
    body: body ?? '',
    workoutExerciseId,
    anchorSnapshot: { exerciseName },
  })
}
