import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
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
}

/** The re-inserted child row ids, keyed by exercise identity (first slot wins
 *  on duplicates, mirroring priorFacts) — built by insertWorkoutChildren. */
export interface InsertedChildIds {
  /** exerciseKey -> new workout_exercises.id */
  exerciseIdByKey: Map<string, string>
  /** `${exerciseKey}:${setNumber}` -> new sets.id */
  setIdByKey: Map<string, string>
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
  }))
}

/**
 * Re-attaches parked notes to the re-inserted child rows. Exercise-anchored
 * notes follow their exercise identity (reorders keep them; a vanished
 * identity leaves them parked = the workout-anchor fallback). Set-anchored
 * notes additionally require positional alignment — the caller passes the
 * SAME gate PriorSetFacts uses (`alignedKeys`: identities whose incoming set
 * count >= prior count); an unaligned or missing target leaves the note
 * parked, snapshot intact.
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
      const list = bySetId.get(target) ?? []
      list.push(note.noteId)
      bySetId.set(target, list)
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
