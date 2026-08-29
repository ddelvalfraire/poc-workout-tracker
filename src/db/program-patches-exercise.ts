import {
  and,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  max,
  sql,
} from 'drizzle-orm'

import {
  type Progression,
} from '@/lib/programs/program-input'
import type {
  ExerciseSource,
} from '@/lib/exercises/custom-exercise-input'

import {
  overshootPolicySchema,
  type OvershootPolicy,
} from '@/lib/programs/overshoot-policy'
import {
  TM_BASED_SCHEMES,
} from '@/lib/workout/substitute-slot'
import {
  db,
} from './index'

import {
  recordProgramEvent,
  type ProgramEventActor,
} from './program-events'
import {
  bumpUpdatedAt,
  findOwnedDayId,
  findOwnedExercise,
  type Tx,
} from './program-ownership'
import {
  muscleRowsFor,
} from './programs'
import type {
  ExerciseCatalog,
} from '@/lib/exercises/exercise-catalog'
import {
  getExerciseCatalog,
} from './exercise-catalog'
import {
  programExercises,
  programExerciseMuscles,
  programSets,
  programSetOverrides,
} from './schema'
import {
  definedFields,
  parseProgression,
  patchErrorFromZod,
} from './program-patches-shared'

// ---------------------------------------------------------------------------
// Exercise ops
// ---------------------------------------------------------------------------

/**
 * An exercise edit. An omitted key is left unchanged; `progression: null`
 * clears the JSONB, `supersetGroup: null` ungroups the exercise, and
 * `overshootPolicy: null` clears the per-exercise override back to the
 * program/scheme resolution (lib/overshoot-policy.ts precedence). Changing
 * either identity half — `wgerExerciseId` or `source` — re-derives the muscle
 * tags from the merged catalog using the effective (source, id).
 */
export interface ProgramExercisePatch {
  wgerExerciseId?: number
  source?: ExerciseSource
  name?: string
  progression?: Progression | null
  supersetGroup?: number | null
  overshootPolicy?: OvershootPolicy | null
}

/** Replaces an exercise's muscle tags from the catalog (delete + re-insert). */
async function retagExerciseMuscles(
  tx: Tx,
  programExerciseId: string,
  source: ExerciseSource,
  exerciseId: number,
  catalog: ExerciseCatalog | null,
): Promise<void> {
  await tx
    .delete(programExerciseMuscles)
    .where(eq(programExerciseMuscles.programExerciseId, programExerciseId))
  const rows = muscleRowsFor(programExerciseId, source, exerciseId, catalog)
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
  exercise: {
    wgerExerciseId: number
    source?: ExerciseSource
    name: string
    progression?: Progression | null
  },
  actor: ProgramEventActor,
): Promise<{ position: number } | null> {
  const source = exercise.source ?? 'wger'
  const progression = exercise.progression == null ? null : parseProgression(exercise.progression)
  const catalog = await getExerciseCatalog(userId) // network read stays outside the tx
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
        source,
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
    const muscles = muscleRowsFor(pe.id, source, exercise.wgerExerciseId, catalog)
    if (muscles.length > 0) await tx.insert(programExerciseMuscles).values(muscles)
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'add_program_exercise',
      summary: `Add ${exercise.name} (Day ${dayPosition + 1})`,
      payload: {
        after: { wgerExerciseId: exercise.wgerExerciseId, source, name: exercise.name, position },
      },
    })
    return { position }
  })
}

/**
 * Updates an exercise's identity (`wgerExerciseId`/`source`), name, and/or
 * progression. A non-null `progression` is re-parsed (`ProgramPatchError` on
 * mismatch); `null` clears it. Returns null when the patch is empty or the
 * node isn't owned/found.
 * Reads, in order: owned-exercise.
 */
export async function updateProgramExercise(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  patch: ProgramExercisePatch,
  actor: ProgramEventActor,
): Promise<{ id: string } | null> {
  const values = definedFields(patch)
  if (Object.keys(values).length === 0) return null
  if (values.progression != null) values.progression = parseProgression(values.progression)
  // Boundary re-parse (null clears — only a non-null value must sit inside
  // the enum), same discipline as setProgramOvershootPolicy at program level.
  if (values.overshootPolicy != null) {
    try {
      values.overshootPolicy = overshootPolicySchema.parse(values.overshootPolicy)
    } catch (error: unknown) {
      throw patchErrorFromZod(error, 'invalid overshoot policy')
    }
  }
  // A change to either identity half re-derives the muscle tags; fetch the
  // catalog outside the tx.
  const identityChanged = values.wgerExerciseId !== undefined || values.source !== undefined
  const catalog = identityChanged ? await getExerciseCatalog(userId) : null
  return db.transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const [updated] = await tx
      .update(programExercises)
      .set(values)
      .where(eq(programExercises.id, found.exerciseId))
      .returning({ id: programExercises.id })
    if (!updated) return null
    if (identityChanged) {
      // Effective identity: the patched half wins, the stored half fills in.
      await retagExerciseMuscles(
        tx,
        found.exerciseId,
        values.source ?? found.source,
        values.wgerExerciseId ?? found.wgerExerciseId,
        catalog,
      )
    }
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'update_program_exercise',
      // A rename (the usual shape of a movement swap) reads as a replace;
      // everything else names the touched fields.
      summary:
        values.name !== undefined && values.name !== found.name
          ? `Replace ${found.name} → ${values.name} (Day ${dayPosition + 1})`
          : `Update ${found.name} (${Object.keys(values).join(', ')}) (Day ${dayPosition + 1})`,
      payload: {
        before: { wgerExerciseId: found.wgerExerciseId, source: found.source, name: found.name },
        after: values,
      },
    })
    return updated
  })
}

/**
 * The persisted twin of lib/substitute-slot.ts: re-points a slot at a new
 * movement AND strips every absolute load that belonged to the old one —
 * template `suggestedLoadKg`, per-week override `suggestedLoadKg`, and a
 * TM-based progression (`percent-1rm`/`amrap-cycle` would keep prescribing
 * the ORIGINAL lift's training max to the substitute). Rep ranges, RIR/RPE,
 * rest, tempo, technique, and every other per-week override COLUMN survive —
 * an override row is never deleted, only its `suggestedLoadKg` is nulled, so
 * hand-authored week intent (rep_min/rep_max, rir, rpe, rest_sec, tempo,
 * duration_sec, distance_m, technique) is kept. Structure transfers, loads
 * don't (#215). `updateProgramExercise` deliberately keeps loads: it is the
 * general patch op, not a movement swap.
 *
 * Both clears are narrowed to rows that actually CARRY a load, and the row
 * counts come back in the result: a swap is destructive to real user data, so
 * the caller (coach turn, UI toast) can say exactly how much was erased
 * instead of leaving the user to discover it in week 4.
 * Reads, in order: owned-exercise, current-progression, set-ids.
 */
export async function substituteProgramExercise(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  substitute: { wgerExerciseId: number; source: ExerciseSource; name: string },
  actor: ProgramEventActor,
): Promise<{
  id: string
  /** Template `program_sets` rows whose suggestedLoadKg was nulled. */
  clearedTemplateLoads: number
  /** Per-week `program_set_overrides` rows whose suggestedLoadKg was nulled. */
  clearedOverrideLoads: number
  /** True when a TM-anchored progression was dropped with the swap. */
  progressionCleared: boolean
} | null> {
  const catalog = await getExerciseCatalog(userId)
  return db.transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const [current] = await tx
      .select({ progression: programExercises.progression })
      .from(programExercises)
      .where(eq(programExercises.id, found.exerciseId))
      .limit(1)
    const dropProgression =
      current?.progression != null && TM_BASED_SCHEMES.has(current.progression.scheme)
    const [updated] = await tx
      .update(programExercises)
      .set({
        wgerExerciseId: substitute.wgerExerciseId,
        source: substitute.source,
        name: substitute.name,
        ...(dropProgression && { progression: null }),
      })
      .where(eq(programExercises.id, found.exerciseId))
      .returning({ id: programExercises.id })
    if (!updated) return null
    await retagExerciseMuscles(
      tx,
      found.exerciseId,
      substitute.source,
      substitute.wgerExerciseId,
      catalog,
    )
    const setRows = await tx
      .select({ id: programSets.id })
      .from(programSets)
      .where(eq(programSets.programExerciseId, found.exerciseId))
    // isNotNull narrows the clear to rows that actually carried a load, so the
    // returned count is what was ERASED, not what was visited.
    const clearedTemplate = await tx
      .update(programSets)
      .set({ suggestedLoadKg: null })
      .where(
        and(
          eq(programSets.programExerciseId, found.exerciseId),
          isNotNull(programSets.suggestedLoadKg),
        ),
      )
      .returning({ id: programSets.id })
    const clearedOverrides =
      setRows.length > 0
        ? await tx
            .update(programSetOverrides)
            .set({ suggestedLoadKg: null })
            .where(
              and(
                inArray(
                  programSetOverrides.programSetId,
                  setRows.map((row) => row.id),
                ),
                isNotNull(programSetOverrides.suggestedLoadKg),
              ),
            )
            .returning({ id: programSetOverrides.id })
        : []
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'update_program_exercise',
      summary: `Replace ${found.name} → ${substitute.name} (Day ${dayPosition + 1})`,
      payload: {
        before: { wgerExerciseId: found.wgerExerciseId, source: found.source, name: found.name },
        after: {
          ...substitute,
          loadsCleared: true,
          clearedTemplateLoads: clearedTemplate.length,
          clearedOverrideLoads: clearedOverrides.length,
          ...(dropProgression && { progressionCleared: true }),
        },
      },
    })
    return {
      id: updated.id,
      clearedTemplateLoads: clearedTemplate.length,
      clearedOverrideLoads: clearedOverrides.length,
      progressionCleared: dropProgression,
    }
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
  actor: ProgramEventActor,
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
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'remove_program_exercise',
      summary: `Remove ${found.name} (Day ${dayPosition + 1})`,
      payload: { before: { name: found.name }, dayPosition, exercisePosition },
    })
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
  actor: ProgramEventActor,
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
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'move_program_exercise',
      summary: `Move ${found.name} to position ${to + 1} (Day ${dayPosition + 1})`,
      payload: { from, to },
    })
    return { moved: true }
  })
}
