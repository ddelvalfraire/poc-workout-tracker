import {
  and,
  count,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  max,
  sql,
} from 'drizzle-orm'

import {
  type Technique,
} from '@/lib/program-input'

import {
  db,
} from './index'

import {
  recordProgramEvent,
  type ProgramEventActor,
} from './program-events'
import {
  ProgramPatchError,
  assertSetRowIntegrity,
  bumpUpdatedAt,
  findOwnedExercise,
  type PatchRunner,
} from './program-ownership'

import {
  programSets,
} from './schema'
import {
  definedFields,
  parseTechnique,
} from './program-patches-shared'
import type {
  MetricMode,
  SetType,
} from './program-patches-shared'

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
  restSec?: number | null
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
  restSec: null,
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
  actor: ProgramEventActor,
  runIn?: PatchRunner,
): Promise<{ setNumber: number } | null> {
  const values = definedFields(patch)
  if (values.technique != null) values.technique = parseTechnique(values.technique)
  const row = { ...SET_DEFAULTS, ...values }
  assertSetRowIntegrity(row)
  return (runIn ?? db).transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const [{ value: lastNumber }] = await tx
      .select({ value: max(programSets.setNumber) })
      .from(programSets)
      .where(eq(programSets.programExerciseId, found.exerciseId))
    const setNumber = (lastNumber ?? 0) + 1
    await tx.insert(programSets).values({ programExerciseId: found.exerciseId, setNumber, ...row })
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'add_program_set',
      summary: `Add set ${setNumber} to ${found.name} (Day ${dayPosition + 1})`,
      payload: { setNumber, after: values },
    })
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
  actor: ProgramEventActor,
  runIn?: PatchRunner,
): Promise<{ id: string } | null> {
  const values = definedFields(patch)
  if (Object.keys(values).length === 0) return null
  if (values.technique != null) values.technique = parseTechnique(values.technique)
  return (runIn ?? db).transaction(async (tx) => {
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
        restSec: programSets.restSec,
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
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'update_program_set',
      summary: `Update set ${setNumber} of ${found.name} (${Object.keys(values).join(', ')}) (Day ${dayPosition + 1})`,
      payload: {
        setNumber,
        // Before = the stored values of exactly the touched fields.
        before: Object.fromEntries(
          Object.keys(values).map((key) => [key, current[key as keyof typeof current] ?? null]),
        ),
        after: values,
      },
    })
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
  actor: ProgramEventActor,
  runIn?: PatchRunner,
): Promise<{ removed: true } | null> {
  return (runIn ?? db).transaction(async (tx) => {
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
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'remove_program_set',
      summary: `Remove set ${setNumber} of ${found.name} (Day ${dayPosition + 1})`,
      payload: { setNumber },
    })
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
  actor: ProgramEventActor,
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
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'move_program_set',
      summary: `Move set ${from} → ${to} of ${found.name} (Day ${dayPosition + 1})`,
      payload: { from, to },
    })
    return { moved: true }
  })
}

/**
 * Syncs one exercise's suggested loads to performed loads (the confirmed
 * plan-sync flow — see lib/plan-sync.ts): each addressed set's
 * `suggestedLoadKg` becomes the given canonical-kg value, in ONE transaction
 * with ONE `program_events` row for the whole exercise (action
 * 'sync_plan_to_performance'; `summary` is built by the caller, which holds
 * the display unit). Narrow by design — only the load column moves, so the
 * Phase-1 cross-field rules (metricMode/duration/reps) can't be violated and
 * no re-validation is needed.
 *
 * Idempotent at this seam too, not just in the detector: a set whose stored
 * load already equals the target (or whose setNumber vanished since
 * detection) is skipped, and when nothing changes there is no write, no
 * updatedAt bump, and no event. Returns the changed-set count, or null when
 * the exercise isn't owned/found.
 * Reads, in order: owned-exercise → current loads for the addressed sets.
 */
export async function syncProgramExerciseLoads(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  loads: readonly { setNumber: number; suggestedLoadKg: number }[],
  actor: ProgramEventActor,
  summary: string,
): Promise<{ updated: number } | null> {
  if (loads.length === 0) return { updated: 0 }
  return db.transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const current = await tx
      .select({ setNumber: programSets.setNumber, suggestedLoadKg: programSets.suggestedLoadKg })
      .from(programSets)
      .where(
        and(
          eq(programSets.programExerciseId, found.exerciseId),
          inArray(
            programSets.setNumber,
            loads.map((l) => l.setNumber),
          ),
        ),
      )
    const currentByNumber = new Map(current.map((row) => [row.setNumber, row.suggestedLoadKg]))
    const applied: { setNumber: number; before: number | null; after: number }[] = []
    for (const load of loads) {
      const before = currentByNumber.get(load.setNumber)
      if (before === undefined || before === load.suggestedLoadKg) continue
      await tx
        .update(programSets)
        .set({ suggestedLoadKg: load.suggestedLoadKg })
        .where(
          and(
            eq(programSets.programExerciseId, found.exerciseId),
            eq(programSets.setNumber, load.setNumber),
          ),
        )
      applied.push({ setNumber: load.setNumber, before, after: load.suggestedLoadKg })
    }
    if (applied.length === 0) return { updated: 0 }
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'sync_plan_to_performance',
      summary,
      payload: { dayPosition, exercisePosition, sets: applied },
    })
    return { updated: applied.length }
  })
}
