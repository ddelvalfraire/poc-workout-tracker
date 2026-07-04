import { and, count, eq, gt, gte, lt, lte, max, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  setTypeSchema,
  metricModeSchema,
  techniqueSchema,
  progressionSchema,
  programSetIntegrityViolation,
  type Technique,
  type Progression,
} from '@/lib/program-input'
import { db } from './index'
import { loadExerciseCatalog, muscleRowsFor, type ExerciseCatalog } from './programs'
import {
  programs,
  programDays,
  programExercises,
  programExerciseMuscles,
  programSets,
  programSetOverrides,
} from './schema'

/**
 * Granular patch ops for the program tree — the program twin of the set-level
 * ops in `db/workouts.ts`. Each op addresses one node by `programId` + 0-based
 * positions (+ 1-based `setNumber` at the leaf; + `week` for the Phase-5
 * per-week override ops), runs in one `db.transaction`, and is user-scoped:
 * ownership is enforced through the join chain up to `programs.user_id`, so a
 * caller can never touch another user's program.
 *
 * Two distinct failure channels:
 * - `null` — the addressed node isn't owned or doesn't exist (tool → not-found)
 * - `ProgramPatchError` — the edit itself is invalid (last-set removal, a merge
 *   that breaks the Phase-1 cross-field rules, malformed technique/progression)
 *
 * Every successful op bumps `programs.updatedAt` (the list sort key) inside the
 * same transaction. Positions stay 0-based contiguous and setNumbers 1-based
 * contiguous: removes close the gap, moves splice-renumber. All three levels
 * carry a per-parent unique on their ordering column; the splice-renumbers
 * transiently collide with it — safe because the migrations made each one
 * DEFERRABLE INITIALLY DEFERRED (checked at commit).
 */

/** An invalid edit (vs. `null` = not-found). The tool layer surfaces the message verbatim. */
export class ProgramPatchError extends Error {}

type SetType = z.infer<typeof setTypeSchema>
type MetricMode = z.infer<typeof metricModeSchema>

/** The transaction handle, lifted from the callback signature (no internal import). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** A ZodError → a concise ProgramPatchError (first issue, path-prefixed). */
function patchErrorFromZod(error: unknown, fallback: string): ProgramPatchError {
  if (error instanceof z.ZodError) {
    const first = error.issues[0]
    const path = first?.path.length ? `${first.path.join('.')}: ` : ''
    return new ProgramPatchError(`${path}${first?.message ?? fallback}`)
  }
  return new ProgramPatchError(error instanceof Error ? error.message : fallback)
}

/** Re-parses a non-null technique through the Phase-1 schema (normalizes `version`). */
function parseTechnique(value: Technique): Technique {
  try {
    return techniqueSchema.parse(value)
  } catch (error: unknown) {
    throw patchErrorFromZod(error, 'invalid technique')
  }
}

/** Re-parses a non-null progression through the Phase-1 schema. */
function parseProgression(value: Progression): Progression {
  try {
    return progressionSchema.parse(value)
  } catch (error: unknown) {
    throw patchErrorFromZod(error, 'invalid progression')
  }
}

/**
 * Cross-field integrity for a (merged) program-set row — the same shared rules
 * as `programSetSchema`, applied here because a partial edit merges against the
 * stored row, outside Zod's reach.
 */
function assertSetRowIntegrity(row: {
  metricMode: string
  durationSec: number | null
  repMin: number | null
  repMax: number | null
}): void {
  const violation = programSetIntegrityViolation(row)
  if (violation) throw new ProgramPatchError(violation.message)
}

/** Marks the program as just-edited; ownership was already verified by the finder. */
async function bumpUpdatedAt(tx: Tx, programId: string): Promise<void> {
  await tx.update(programs).set({ updatedAt: new Date() }).where(eq(programs.id, programId))
}

/**
 * Resolves the program's own id only when owned by the user — the ownership gate
 * for the day-level ops that don't address an existing day (add).
 */
async function findOwnedProgramId(
  tx: Tx,
  userId: string,
  programId: string,
): Promise<string | null> {
  const [p] = await tx
    .select({ id: programs.id })
    .from(programs)
    .where(and(eq(programs.id, programId), eq(programs.userId, userId)))
    .limit(1)
  return p?.id ?? null
}

/**
 * Resolves a program-day id only when the program is owned by the user. The join
 * to `programs.userId` is the ownership gate for every day-level edit. Returns
 * null when the program isn't owned or no day sits at that 0-based position.
 */
async function findOwnedDayId(
  tx: Tx,
  userId: string,
  programId: string,
  dayPosition: number,
): Promise<string | null> {
  const [pd] = await tx
    .select({ id: programDays.id })
    .from(programDays)
    .innerJoin(programs, eq(programs.id, programDays.programId))
    .where(
      and(
        eq(programDays.programId, programId),
        eq(programDays.position, dayPosition),
        eq(programs.userId, userId),
      ),
    )
    .limit(1)
  return pd?.id ?? null
}

/**
 * Resolves a program-exercise id (and its day id, for sibling renumbering) only
 * when the program is owned by the user — one join deeper than the workout twin:
 * program_exercises → program_days → programs.user_id.
 */
async function findOwnedExercise(
  tx: Tx,
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
): Promise<{ exerciseId: string; dayId: string } | null> {
  const [pe] = await tx
    .select({ exerciseId: programExercises.id, dayId: programDays.id })
    .from(programExercises)
    .innerJoin(programDays, eq(programDays.id, programExercises.programDayId))
    .innerJoin(programs, eq(programs.id, programDays.programId))
    .where(
      and(
        eq(programDays.programId, programId),
        eq(programDays.position, dayPosition),
        eq(programExercises.position, exercisePosition),
        eq(programs.userId, userId),
      ),
    )
    .limit(1)
  return pe ?? null
}

/** Strips `undefined` entries so an omitted key never overwrites a stored value. */
function definedFields<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}

// ---------------------------------------------------------------------------
// Day ops
// ---------------------------------------------------------------------------

/** A day edit. An omitted key is left unchanged; `name` is required by the schema, so it can't be cleared. */
export interface ProgramDayPatch {
  name?: string
  notes?: string | null
}

/**
 * Appends a day at `max(position)+1`. Returns the new 0-based position, or null
 * when the program isn't owned.
 * Reads, in order: owned-program → max(position).
 */
export async function addProgramDay(
  userId: string,
  programId: string,
  day: { name: string; notes?: string | null },
): Promise<{ position: number } | null> {
  return db.transaction(async (tx) => {
    const owned = await findOwnedProgramId(tx, userId, programId)
    if (!owned) return null
    const [{ value: lastPosition }] = await tx
      .select({ value: max(programDays.position) })
      .from(programDays)
      .where(eq(programDays.programId, programId))
    const position = lastPosition === null ? 0 : lastPosition + 1
    await tx
      .insert(programDays)
      .values({ programId, name: day.name, position, notes: day.notes ?? null })
    await bumpUpdatedAt(tx, programId)
    return { position }
  })
}

/**
 * Updates a day's name and/or notes. Returns null when the patch is empty, the
 * program isn't owned, or no day sits at that position.
 * Reads, in order: owned-day.
 */
export async function updateProgramDay(
  userId: string,
  programId: string,
  dayPosition: number,
  patch: ProgramDayPatch,
): Promise<{ id: string } | null> {
  const values = definedFields(patch)
  if (Object.keys(values).length === 0) return null
  return db.transaction(async (tx) => {
    const dayId = await findOwnedDayId(tx, userId, programId, dayPosition)
    if (!dayId) return null
    const [updated] = await tx
      .update(programDays)
      .set(values)
      .where(eq(programDays.id, dayId))
      .returning({ id: programDays.id })
    if (!updated) return null
    await bumpUpdatedAt(tx, programId)
    return updated
  })
}

/**
 * Removes a day (cascade deletes its exercises/sets) and closes the position gap.
 * Reads, in order: owned-day.
 */
export async function removeProgramDay(
  userId: string,
  programId: string,
  dayPosition: number,
): Promise<{ removed: true } | null> {
  return db.transaction(async (tx) => {
    const dayId = await findOwnedDayId(tx, userId, programId, dayPosition)
    if (!dayId) return null
    await tx.delete(programDays).where(eq(programDays.id, dayId))
    await tx
      .update(programDays)
      .set({ position: sql`${programDays.position} - 1` })
      .where(and(eq(programDays.programId, programId), gt(programDays.position, dayPosition)))
    await bumpUpdatedAt(tx, programId)
    return { removed: true }
  })
}

/**
 * Moves a day from one 0-based position to another, splice-renumbering the block
 * between them so positions stay contiguous. `from === to` is a no-op success;
 * an out-of-range `to` (no day there) is a not-found null.
 * Reads, in order: owned-day-at-from → day-exists-at-to.
 */
export async function moveProgramDay(
  userId: string,
  programId: string,
  from: number,
  to: number,
): Promise<{ moved: true } | null> {
  return db.transaction(async (tx) => {
    const movedId = await findOwnedDayId(tx, userId, programId, from)
    if (!movedId) return null
    if (from === to) return { moved: true }
    const [target] = await tx
      .select({ id: programDays.id })
      .from(programDays)
      .where(and(eq(programDays.programId, programId), eq(programDays.position, to)))
      .limit(1)
    if (!target) return null
    if (from < to) {
      await tx
        .update(programDays)
        .set({ position: sql`${programDays.position} - 1` })
        .where(
          and(
            eq(programDays.programId, programId),
            gt(programDays.position, from),
            lte(programDays.position, to),
          ),
        )
    } else {
      await tx
        .update(programDays)
        .set({ position: sql`${programDays.position} + 1` })
        .where(
          and(
            eq(programDays.programId, programId),
            gte(programDays.position, to),
            lt(programDays.position, from),
          ),
        )
    }
    await tx.update(programDays).set({ position: to }).where(eq(programDays.id, movedId))
    await bumpUpdatedAt(tx, programId)
    return { moved: true }
  })
}

// ---------------------------------------------------------------------------
// Exercise ops
// ---------------------------------------------------------------------------

/**
 * An exercise edit. An omitted key is left unchanged; `progression: null`
 * clears the JSONB, `supersetGroup: null` ungroups the exercise. Changing
 * `wgerExerciseId` re-derives the muscle tags from the wger catalog.
 */
export interface ProgramExercisePatch {
  wgerExerciseId?: number
  name?: string
  progression?: Progression | null
  supersetGroup?: number | null
}

/** Replaces an exercise's muscle tags from the catalog (delete + re-insert). */
async function retagExerciseMuscles(
  tx: Tx,
  programExerciseId: string,
  wgerExerciseId: number,
  catalog: ExerciseCatalog | null,
): Promise<void> {
  await tx
    .delete(programExerciseMuscles)
    .where(eq(programExerciseMuscles.programExerciseId, programExerciseId))
  const rows = muscleRowsFor(programExerciseId, wgerExerciseId, catalog)
  if (rows.length > 0) await tx.insert(programExerciseMuscles).values(rows)
}

/**
 * Appends an exercise to a day at `max(position)+1`, seeding ONE default set
 * (working / reps_weight, all targets blank) so the schema invariant — an
 * exercise has ≥1 set — holds. A non-null `progression` is re-parsed through the
 * Phase-1 schema (`ProgramPatchError` on mismatch). Returns the new 0-based
 * position, or null when the program/day isn't owned.
 * Reads, in order: owned-day → max(position).
 */
export async function addProgramExercise(
  userId: string,
  programId: string,
  dayPosition: number,
  exercise: { wgerExerciseId: number; name: string; progression?: Progression | null },
): Promise<{ position: number } | null> {
  const progression = exercise.progression == null ? null : parseProgression(exercise.progression)
  const catalog = await loadExerciseCatalog() // network read stays outside the tx
  return db.transaction(async (tx) => {
    const dayId = await findOwnedDayId(tx, userId, programId, dayPosition)
    if (!dayId) return null
    const [{ value: lastPosition }] = await tx
      .select({ value: max(programExercises.position) })
      .from(programExercises)
      .where(eq(programExercises.programDayId, dayId))
    const position = lastPosition === null ? 0 : lastPosition + 1
    const [pe] = await tx
      .insert(programExercises)
      .values({
        programDayId: dayId,
        wgerExerciseId: exercise.wgerExerciseId,
        name: exercise.name,
        position,
        progression,
      })
      .returning({ id: programExercises.id })
    // Seed the required first set — field list mirrors insertProgramChildren.
    await tx.insert(programSets).values({
      programExerciseId: pe.id,
      setNumber: 1,
      setType: 'working',
      metricMode: 'reps_weight',
      repMin: null,
      repMax: null,
      rir: null,
      rpe: null,
      suggestedLoadKg: null,
      tempo: null,
      durationSec: null,
      distanceM: null,
      technique: null,
    })
    // A brand-new exercise has no stale tags to clear — insert-only tagging.
    const muscles = muscleRowsFor(pe.id, exercise.wgerExerciseId, catalog)
    if (muscles.length > 0) await tx.insert(programExerciseMuscles).values(muscles)
    await bumpUpdatedAt(tx, programId)
    return { position }
  })
}

/**
 * Updates an exercise's wger id, name, and/or progression. A non-null
 * `progression` is re-parsed (`ProgramPatchError` on mismatch); `null` clears it.
 * Returns null when the patch is empty or the node isn't owned/found.
 * Reads, in order: owned-exercise.
 */
export async function updateProgramExercise(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  patch: ProgramExercisePatch,
): Promise<{ id: string } | null> {
  const values = definedFields(patch)
  if (Object.keys(values).length === 0) return null
  if (values.progression != null) values.progression = parseProgression(values.progression)
  // A movement swap re-derives the muscle tags; fetch the catalog outside the tx.
  const catalog = values.wgerExerciseId !== undefined ? await loadExerciseCatalog() : null
  return db.transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const [updated] = await tx
      .update(programExercises)
      .set(values)
      .where(eq(programExercises.id, found.exerciseId))
      .returning({ id: programExercises.id })
    if (!updated) return null
    if (values.wgerExerciseId !== undefined) {
      await retagExerciseMuscles(tx, found.exerciseId, values.wgerExerciseId, catalog)
    }
    await bumpUpdatedAt(tx, programId)
    return updated
  })
}

/**
 * Removes an exercise (cascade deletes its sets) and closes the position gap
 * within its day.
 * Reads, in order: owned-exercise.
 */
export async function removeProgramExercise(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
): Promise<{ removed: true } | null> {
  return db.transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    await tx.delete(programExercises).where(eq(programExercises.id, found.exerciseId))
    await tx
      .update(programExercises)
      .set({ position: sql`${programExercises.position} - 1` })
      .where(
        and(
          eq(programExercises.programDayId, found.dayId),
          gt(programExercises.position, exercisePosition),
        ),
      )
    await bumpUpdatedAt(tx, programId)
    return { removed: true }
  })
}

/**
 * Moves an exercise within its day (cross-day moves are out of scope — a swap is
 * remove+add). Same splice semantics as `moveProgramDay`.
 * Reads, in order: owned-exercise-at-from → exercise-exists-at-to.
 */
export async function moveProgramExercise(
  userId: string,
  programId: string,
  dayPosition: number,
  from: number,
  to: number,
): Promise<{ moved: true } | null> {
  return db.transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, from)
    if (!found) return null
    if (from === to) return { moved: true }
    const [target] = await tx
      .select({ id: programExercises.id })
      .from(programExercises)
      .where(and(eq(programExercises.programDayId, found.dayId), eq(programExercises.position, to)))
      .limit(1)
    if (!target) return null
    if (from < to) {
      await tx
        .update(programExercises)
        .set({ position: sql`${programExercises.position} - 1` })
        .where(
          and(
            eq(programExercises.programDayId, found.dayId),
            gt(programExercises.position, from),
            lte(programExercises.position, to),
          ),
        )
    } else {
      await tx
        .update(programExercises)
        .set({ position: sql`${programExercises.position} + 1` })
        .where(
          and(
            eq(programExercises.programDayId, found.dayId),
            gte(programExercises.position, to),
            lt(programExercises.position, from),
          ),
        )
    }
    await tx
      .update(programExercises)
      .set({ position: to })
      .where(eq(programExercises.id, found.exerciseId))
    await bumpUpdatedAt(tx, programId)
    return { moved: true }
  })
}

// ---------------------------------------------------------------------------
// Set ops
// ---------------------------------------------------------------------------

/**
 * A planned-set edit. An omitted key is left unchanged; an explicit `null`
 * clears it. `suggestedLoadKg` is canonical kg (the tool layer converts).
 */
export interface ProgramSetPatch {
  setType?: SetType
  metricMode?: MetricMode
  repMin?: number | null
  repMax?: number | null
  rir?: number | null
  rpe?: number | null
  suggestedLoadKg?: number | null
  tempo?: string | null
  durationSec?: number | null
  distanceM?: number | null
  technique?: Technique | null
}

/** The stored defaults an added set starts from before the patch is applied. */
const SET_DEFAULTS = {
  setType: 'working' as SetType,
  metricMode: 'reps_weight' as MetricMode,
  repMin: null,
  repMax: null,
  rir: null,
  rpe: null,
  suggestedLoadKg: null,
  tempo: null,
  durationSec: null,
  distanceM: null,
  technique: null,
}

/**
 * Appends a set at `max(setNumber)+1`, defaulting to working / reps_weight. The
 * assembled row must satisfy the Phase-1 cross-field rules and a non-null
 * `technique` is re-parsed — both throw `ProgramPatchError`. Returns the new
 * 1-based set number, or null when the exercise isn't owned/found.
 * Reads, in order: owned-exercise → max(setNumber).
 */
export async function addProgramSet(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  patch: ProgramSetPatch,
): Promise<{ setNumber: number } | null> {
  const values = definedFields(patch)
  if (values.technique != null) values.technique = parseTechnique(values.technique)
  const row = { ...SET_DEFAULTS, ...values }
  assertSetRowIntegrity(row)
  return db.transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const [{ value: lastNumber }] = await tx
      .select({ value: max(programSets.setNumber) })
      .from(programSets)
      .where(eq(programSets.programExerciseId, found.exerciseId))
    const setNumber = (lastNumber ?? 0) + 1
    await tx.insert(programSets).values({ programExerciseId: found.exerciseId, setNumber, ...row })
    await bumpUpdatedAt(tx, programId)
    return { setNumber }
  })
}

/**
 * Updates one planned set with merge-then-revalidate semantics: the stored row is
 * read, the defined patch fields merged over it (null = clear), and the merged
 * row re-checked against the Phase-1 cross-field rules — so a partial edit can
 * never leave a set the full-program schema would reject. A non-null `technique`
 * is re-parsed. Returns null when the patch is empty or the node isn't owned/found.
 * Reads, in order: owned-exercise → current set row.
 */
export async function updateProgramSet(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  setNumber: number,
  patch: ProgramSetPatch,
): Promise<{ id: string } | null> {
  const values = definedFields(patch)
  if (Object.keys(values).length === 0) return null
  if (values.technique != null) values.technique = parseTechnique(values.technique)
  return db.transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const [current] = await tx
      .select({
        setType: programSets.setType,
        metricMode: programSets.metricMode,
        repMin: programSets.repMin,
        repMax: programSets.repMax,
        rir: programSets.rir,
        rpe: programSets.rpe,
        suggestedLoadKg: programSets.suggestedLoadKg,
        tempo: programSets.tempo,
        durationSec: programSets.durationSec,
        distanceM: programSets.distanceM,
        technique: programSets.technique,
      })
      .from(programSets)
      .where(
        and(
          eq(programSets.programExerciseId, found.exerciseId),
          eq(programSets.setNumber, setNumber),
        ),
      )
      .limit(1)
    if (!current) return null
    assertSetRowIntegrity({ ...current, ...values })
    const [updated] = await tx
      .update(programSets)
      .set(values)
      .where(
        and(
          eq(programSets.programExerciseId, found.exerciseId),
          eq(programSets.setNumber, setNumber),
        ),
      )
      .returning({ id: programSets.id })
    if (!updated) return null
    await bumpUpdatedAt(tx, programId)
    return updated
  })
}

/**
 * Removes one planned set and renumbers the higher sets down (the transient
 * collision commits under the DEFERRABLE unique). Removing an exercise's last
 * set throws `ProgramPatchError` — the schema invariant is ≥1 set per exercise;
 * remove the exercise instead. Returns null when the node isn't owned/found.
 * Reads, in order: owned-exercise → count(sets).
 */
export async function removeProgramSet(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  setNumber: number,
): Promise<{ removed: true } | null> {
  return db.transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const [{ value: total }] = await tx
      .select({ value: count(programSets.id) })
      .from(programSets)
      .where(eq(programSets.programExerciseId, found.exerciseId))
    // setNumbers are 1-based contiguous, so existence ⇔ 1 ≤ setNumber ≤ total.
    if (setNumber < 1 || setNumber > total) return null
    if (total === 1) {
      throw new ProgramPatchError(
        'an exercise needs at least one set — remove the exercise instead',
      )
    }
    const [deleted] = await tx
      .delete(programSets)
      .where(
        and(
          eq(programSets.programExerciseId, found.exerciseId),
          eq(programSets.setNumber, setNumber),
        ),
      )
      .returning({ id: programSets.id })
    if (!deleted) return null
    await tx
      .update(programSets)
      .set({ setNumber: sql`${programSets.setNumber} - 1` })
      .where(
        and(
          eq(programSets.programExerciseId, found.exerciseId),
          gt(programSets.setNumber, setNumber),
        ),
      )
    await bumpUpdatedAt(tx, programId)
    return { removed: true }
  })
}

/**
 * Moves a set from one 1-based number to another, splice-renumbering the block
 * between them (commits under the DEFERRABLE unique). `from === to` is a no-op
 * success; an out-of-range `to` is a not-found null.
 * Reads, in order: owned-exercise → set-id-at-from → set-exists-at-to.
 */
export async function moveProgramSet(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  from: number,
  to: number,
): Promise<{ moved: true } | null> {
  return db.transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const [moved] = await tx
      .select({ id: programSets.id })
      .from(programSets)
      .where(
        and(eq(programSets.programExerciseId, found.exerciseId), eq(programSets.setNumber, from)),
      )
      .limit(1)
    if (!moved) return null
    if (from === to) return { moved: true }
    const [target] = await tx
      .select({ id: programSets.id })
      .from(programSets)
      .where(
        and(eq(programSets.programExerciseId, found.exerciseId), eq(programSets.setNumber, to)),
      )
      .limit(1)
    if (!target) return null
    if (from < to) {
      await tx
        .update(programSets)
        .set({ setNumber: sql`${programSets.setNumber} - 1` })
        .where(
          and(
            eq(programSets.programExerciseId, found.exerciseId),
            gt(programSets.setNumber, from),
            lte(programSets.setNumber, to),
          ),
        )
    } else {
      await tx
        .update(programSets)
        .set({ setNumber: sql`${programSets.setNumber} + 1` })
        .where(
          and(
            eq(programSets.programExerciseId, found.exerciseId),
            gte(programSets.setNumber, to),
            lt(programSets.setNumber, from),
          ),
        )
    }
    await tx.update(programSets).set({ setNumber: to }).where(eq(programSets.id, moved.id))
    await bumpUpdatedAt(tx, programId)
    return { moved: true }
  })
}

// ---------------------------------------------------------------------------
// Per-week override ops (Phase 5)
// ---------------------------------------------------------------------------

/**
 * A per-week override edit. An omitted key leaves that override field as it
 * was; an explicit `null` CLEARS the override for that field (reverting the
 * week to the engine-derived value — overrides can't pin "no value").
 */
export interface ProgramSetOverridePatch {
  repMin?: number | null
  repMax?: number | null
  rir?: number | null
  rpe?: number | null
  suggestedLoadKg?: number | null
  tempo?: string | null
  durationSec?: number | null
  distanceM?: number | null
  technique?: Technique | null
}

const OVERRIDE_FIELDS = [
  'repMin',
  'repMax',
  'rir',
  'rpe',
  'suggestedLoadKg',
  'tempo',
  'durationSec',
  'distanceM',
  'technique',
] as const

/**
 * Upserts the (set, week) override row: the defined patch fields are merged
 * over any existing override, and the EFFECTIVE row (base set with the merged
 * override's non-null fields on top — exactly what instantiation will seed) is
 * revalidated against the Phase-1 cross-field rules. A merge that clears every
 * field deletes the row. An override wins over the progression engine AND the
 * deload modifier for that week. Returns null when the node isn't owned/found.
 * Reads, in order: owned-exercise → current set row → existing override.
 */
export async function setProgramSetOverride(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  setNumber: number,
  week: number,
  patch: ProgramSetOverridePatch,
): Promise<{ week: number; cleared: boolean } | null> {
  const values = definedFields(patch)
  if (Object.keys(values).length === 0) return null
  if (values.technique != null) values.technique = parseTechnique(values.technique)
  return db.transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const [current] = await tx
      .select({
        id: programSets.id,
        metricMode: programSets.metricMode,
        repMin: programSets.repMin,
        repMax: programSets.repMax,
        durationSec: programSets.durationSec,
      })
      .from(programSets)
      .where(
        and(
          eq(programSets.programExerciseId, found.exerciseId),
          eq(programSets.setNumber, setNumber),
        ),
      )
      .limit(1)
    if (!current) return null

    const [existing] = await tx
      .select({
        id: programSetOverrides.id,
        repMin: programSetOverrides.repMin,
        repMax: programSetOverrides.repMax,
        rir: programSetOverrides.rir,
        rpe: programSetOverrides.rpe,
        suggestedLoadKg: programSetOverrides.suggestedLoadKg,
        tempo: programSetOverrides.tempo,
        durationSec: programSetOverrides.durationSec,
        distanceM: programSetOverrides.distanceM,
        technique: programSetOverrides.technique,
      })
      .from(programSetOverrides)
      .where(
        and(eq(programSetOverrides.programSetId, current.id), eq(programSetOverrides.week, week)),
      )
      .limit(1)

    const merged: Record<string, unknown> = {}
    for (const field of OVERRIDE_FIELDS) {
      merged[field] = values[field] !== undefined ? values[field] : (existing?.[field] ?? null)
    }

    // Validate the week's EFFECTIVE prescription: base overlaid by non-null overrides.
    assertSetRowIntegrity({
      metricMode: current.metricMode,
      durationSec: (merged.durationSec as number | null) ?? current.durationSec,
      repMin: (merged.repMin as number | null) ?? current.repMin,
      repMax: (merged.repMax as number | null) ?? current.repMax,
    })

    const cleared = OVERRIDE_FIELDS.every((field) => merged[field] === null)
    if (cleared) {
      if (existing) {
        await tx.delete(programSetOverrides).where(eq(programSetOverrides.id, existing.id))
      }
    } else if (existing) {
      await tx.update(programSetOverrides).set(merged).where(eq(programSetOverrides.id, existing.id))
    } else {
      await tx.insert(programSetOverrides).values({ programSetId: current.id, week, ...merged })
    }
    await bumpUpdatedAt(tx, programId)
    return { week, cleared }
  })
}

/**
 * Removes the (set, week) override row entirely, reverting that week to the
 * engine-derived prescription. Returns null when the exercise/set isn't
 * owned/found or no override exists for that week.
 * Reads, in order: owned-exercise → set-id-at-setNumber.
 */
export async function removeProgramSetOverride(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  setNumber: number,
  week: number,
): Promise<{ removed: true } | null> {
  return db.transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const [set] = await tx
      .select({ id: programSets.id })
      .from(programSets)
      .where(
        and(
          eq(programSets.programExerciseId, found.exerciseId),
          eq(programSets.setNumber, setNumber),
        ),
      )
      .limit(1)
    if (!set) return null
    const [deleted] = await tx
      .delete(programSetOverrides)
      .where(and(eq(programSetOverrides.programSetId, set.id), eq(programSetOverrides.week, week)))
      .returning({ id: programSetOverrides.id })
    if (!deleted) return null
    await bumpUpdatedAt(tx, programId)
    return { removed: true }
  })
}
