import { and, desc, eq } from 'drizzle-orm'
import type { WeightUnit } from '@/lib/units'
import type { ExerciseSource } from '@/lib/exercises/custom-exercise-input'
import { getAllExercises } from '@/lib/exercises/wger'
import {
  guessCategory,
  matchExercises,
  MAX_CUSTOM_CREATES,
  type CatalogEntry,
  type ExerciseResolution,
} from '@/lib/import/match'
import type { ImportSource, ParsedImport, ParsedSet, SkippedRow } from '@/lib/import/types'
import { checkTrophies } from '@/lib/goals/trophies'
import { db } from './index'
import { customExercises, importBatches, notes, sets, workoutExercises, workouts } from './schema'
import { listCustomExercises } from './custom-exercises'

/**
 * History-import data access — the dry-run/commit seam. `planImport` is the
 * ONE code path that resolves exercises and detects duplicates: the preview
 * renders its output, and `commitImport` consumes it, so preview counts and
 * committed counts can never drift (the PRD's honest-preview metric).
 *
 * Like every db module, this is the authorization boundary: all queries
 * filter by userId; routes must come through these helpers.
 */

// Mirror workout-input.ts caps. Import TRUNCATES instead of rejecting —
// refusing a whole file over one long note would drop performed history,
// the one thing the importer promises never to do.
const MAX_NAME = 200
const MAX_NOTES = 2000

/** Workouts per transaction chunk: bounded memory/tx time on huge histories. */
const COMMIT_CHUNK_SIZE = 25

/** Thrown when a plan cannot be built for a policy reason (surfaced as 422). */
export class ImportPlanError extends Error {}

export interface PlannedExercise {
  /** Verbatim import name — the resolution map is keyed by it. */
  name: string
  notes?: string
  sets: ParsedSet[]
}

export interface PlannedWorkout {
  name?: string
  startedAt: Date
  completedAt: Date
  notes?: string
  exercises: PlannedExercise[]
  /** True when (startedAt, name) already exists for the user — skipped at commit. */
  isDuplicate: boolean
}

export interface ImportPlan {
  source: ImportSource
  sourceUnit: WeightUnit
  workouts: PlannedWorkout[]
  /** Per unique import exercise name: catalog match or create-custom. */
  resolutions: Map<string, ExerciseResolution>
  matched: { importName: string; source: ExerciseSource; id: number; name: string }[]
  /** Import names that will become custom exercises (verbatim), sorted. */
  toCreate: string[]
  duplicates: { name: string | null; startedAt: Date }[]
  skipped: SkippedRow[]
  warnings: string[]
  /** Counts of what commit will actually write (duplicates excluded). */
  workoutCount: number
  setCount: number
  dateRange: { from: Date; to: Date } | null
}

/**
 * Dry-run: resolves every exercise against the merged catalog (wger + the
 * user's customs), flags duplicate workouts ((startedAt, name) already
 * logged), and totals what a commit would write. Reads only — nothing is
 * created here. Throws ImportPlanError above the custom-create cap.
 */
export async function planImport(userId: string, parsed: ParsedImport): Promise<ImportPlan> {
  const [wger, customs, existing] = await Promise.all([
    getAllExercises(),
    listCustomExercises(userId),
    db
      .select({ startedAt: workouts.startedAt, name: workouts.name })
      .from(workouts)
      .where(eq(workouts.userId, userId)),
  ])

  const catalog: CatalogEntry[] = [
    ...wger.map((e) => ({ source: 'wger' as const, id: e.id, name: e.name })),
    ...customs.map((c) => ({ source: 'custom' as const, id: c.id, name: c.name })),
  ]

  const names = [...new Set(parsed.workouts.flatMap((w) => w.exercises.map((e) => e.name)))]
  const resolutions = matchExercises(names, catalog)

  const toCreate = names.filter((n) => resolutions.get(n)?.kind === 'create').sort()
  if (toCreate.length > MAX_CUSTOM_CREATES) {
    throw new ImportPlanError(
      `This file needs ${toCreate.length} new custom exercises — the limit per import is ${MAX_CUSTOM_CREATES}.`,
    )
  }

  const existingKeys = new Set(existing.map((w) => `${w.startedAt.getTime()}|${w.name ?? ''}`))

  const planned: PlannedWorkout[] = parsed.workouts.map((w) => {
    const startedAt = new Date(w.startedAt)
    return {
      ...(w.name !== undefined ? { name: w.name } : {}),
      startedAt,
      completedAt: new Date(w.completedAt),
      ...(w.notes !== undefined ? { notes: w.notes } : {}),
      exercises: w.exercises,
      isDuplicate: existingKeys.has(`${startedAt.getTime()}|${w.name ?? ''}`),
    }
  })

  const importable = planned.filter((w) => !w.isDuplicate)
  const setCount = importable.reduce(
    (total, w) => total + w.exercises.reduce((n, e) => n + e.sets.length, 0),
    0,
  )
  const times = planned.map((w) => w.startedAt.getTime())
  const matched = names.flatMap((importName) => {
    const r = resolutions.get(importName)
    return r?.kind === 'match' ? [{ importName, source: r.source, id: r.id, name: r.name }] : []
  })

  return {
    source: parsed.source,
    sourceUnit: parsed.sourceUnit,
    workouts: planned,
    resolutions,
    matched,
    toCreate,
    duplicates: planned
      .filter((w) => w.isDuplicate)
      .map((w) => ({ name: w.name ?? null, startedAt: w.startedAt })),
    skipped: parsed.skipped,
    warnings: parsed.warnings,
    workoutCount: importable.length,
    setCount,
    dateRange:
      times.length > 0
        ? { from: new Date(Math.min(...times)), to: new Date(Math.max(...times)) }
        : null,
  }
}

export interface ImportCommitResult {
  batchId: string
  workoutsImported: number
  setsImported: number
  duplicatesSkipped: number
  customsCreated: number
}

/**
 * Executes a plan: creates the needed customs, writes the batch row, then
 * inserts the workouts in chunked transactions (COMMIT_CHUNK_SIZE per tx —
 * one giant tx over thousands of workouts would monopolize the pooled
 * connection). The batch row lands FIRST so a mid-import failure still
 * leaves an undo handle over whatever chunks committed; imported sets are
 * completed=true with setType/metricMode preserved.
 */
export async function commitImport(
  userId: string,
  plan: ImportPlan,
  fileName: string | null,
): Promise<ImportCommitResult> {
  // 1. Auto-created customs, verbatim names. onConflictDoNothing makes a
  //    concurrent double-commit converge instead of throwing on the
  //    (user_id, name) unique; ids are re-read authoritatively after.
  if (plan.toCreate.length > 0) {
    await db
      .insert(customExercises)
      .values(
        plan.toCreate.map((name) => ({
          userId,
          name: truncate(name, MAX_NAME),
          category: guessCategory(name),
        })),
      )
      .onConflictDoNothing()
  }
  const customsByName = new Map(
    (await listCustomExercises(userId)).map((c) => [c.name, c.id] as const),
  )

  // 2. The undo handle, stamped with the plan's counts (what commit intends
  //    to write; the undo delete is by batch id, never by count).
  const [batch] = await db
    .insert(importBatches)
    .values({
      userId,
      source: plan.source,
      fileName,
      workoutCount: plan.workoutCount,
      setCount: plan.setCount,
    })
    .returning({ id: importBatches.id })
  if (!batch) throw new Error('commitImport: batch insert returned no row')

  // 3. Workout tree, duplicates skipped, in chunked transactions.
  const importable = plan.workouts.filter((w) => !w.isDuplicate)
  let workoutsImported = 0
  let setsImported = 0
  for (let start = 0; start < importable.length; start += COMMIT_CHUNK_SIZE) {
    const chunk = importable.slice(start, start + COMMIT_CHUNK_SIZE)
    await db.transaction(async (tx) => {
      for (const workout of chunk) {
        const [w] = await tx
          .insert(workouts)
          .values({
            userId,
            name: workout.name !== undefined ? truncate(workout.name, MAX_NAME) : null,
            startedAt: workout.startedAt,
            completedAt: workout.completedAt,
            importBatchId: batch.id,
          })
          .returning({ id: workouts.id })

        // Imported notes land in the notes table (notes v2 — the legacy
        // columns are dead): workout-anchored session notes, exercise-anchored
        // instance notes with the standard {exerciseName} snapshot, both
        // dated to the session (created_at = started_at, the backfill rule).
        // Undo stays safe: the batch delete removes the workouts explicitly,
        // and the anchor FKs cascade the notes with them.
        const noteValues: (typeof notes.$inferInsert)[] = []
        const workoutNote =
          workout.notes !== undefined ? truncate(workout.notes, MAX_NOTES).trim() : ''
        if (workoutNote !== '') {
          noteValues.push({
            userId,
            author: 'user',
            body: workoutNote,
            workoutId: w.id,
            createdAt: workout.startedAt,
            updatedAt: workout.startedAt,
          })
        }

        for (const [position, exercise] of workout.exercises.entries()) {
          const ref = resolveRef(exercise.name, plan.resolutions, customsByName)
          const [we] = await tx
            .insert(workoutExercises)
            .values({
              workoutId: w.id,
              wgerExerciseId: ref.id,
              source: ref.source,
              name: truncate(ref.name, MAX_NAME),
              position,
            })
            .returning({ id: workoutExercises.id })
          const exerciseNote =
            exercise.notes !== undefined ? truncate(exercise.notes, MAX_NOTES).trim() : ''
          if (exerciseNote !== '') {
            noteValues.push({
              userId,
              author: 'user',
              body: exerciseNote,
              workoutExerciseId: we.id,
              anchorSnapshot: { exerciseName: truncate(ref.name, MAX_NAME) },
              createdAt: workout.startedAt,
              updatedAt: workout.startedAt,
            })
          }

          if (exercise.sets.length > 0) {
            await tx.insert(sets).values(
              exercise.sets.map((s, i) => ({
                workoutExerciseId: we.id,
                setNumber: i + 1,
                reps: s.reps,
                weight: s.weightKg,
                completed: true,
                setType: s.setType,
                metricMode: s.metricMode,
                durationSec: s.durationSec,
              })),
            )
            setsImported += exercise.sets.length
          }
        }
        if (noteValues.length > 0) await tx.insert(notes).values(noteValues)
        workoutsImported += 1
      }
    })
  }

  // Imported history can complete trophies retroactively — trigger 'import'
  // stamps them QUIETLY (trophy page only; no push, no celebration flood).
  // Fails soft inside: a trophy hiccup never fails a committed import.
  await checkTrophies(userId, { kind: 'import' })

  return {
    batchId: batch.id,
    workoutsImported,
    setsImported,
    duplicatesSkipped: plan.duplicates.length,
    customsCreated: plan.toCreate.length,
  }
}

/** Maps an import exercise name to its (source, id, denormalized name). A
 *  matched exercise carries the CATALOG name (canonical); a created custom
 *  keeps the verbatim import name. */
function resolveRef(
  importName: string,
  resolutions: ImportPlan['resolutions'],
  customsByName: Map<string, number>,
): { source: ExerciseSource; id: number; name: string } {
  const resolution = resolutions.get(importName)
  if (resolution?.kind === 'match') {
    return { source: resolution.source, id: resolution.id, name: resolution.name }
  }
  const customId = customsByName.get(truncate(importName, MAX_NAME))
  // The custom was created (or already existed) in step 1; its absence means
  // the create silently failed — fail the chunk loudly, never mis-attribute.
  if (customId === undefined) {
    throw new Error(`commitImport: missing custom exercise for "${importName}"`)
  }
  return { source: 'custom', id: customId, name: truncate(importName, MAX_NAME) }
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

/**
 * Undo: deletes the batch's workouts (children cascade), THEN the batch row.
 * Order matters — the FK is ON DELETE SET NULL, so deleting the batch first
 * would detach the workouts before the workout delete could find them.
 * Deleting workouts first is safe unauthorized: they're filtered by userId
 * AND importBatchId, and another user's batch id can never be stamped on
 * this user's workouts. Created customs are LEFT in place (deleting could
 * orphan history re-logged against them — documented in the PRD). Returns
 * null when the batch isn't owned by the user (or doesn't exist).
 */
export async function undoImport(
  userId: string,
  batchId: string,
): Promise<{ workoutsDeleted: number } | null> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(workouts)
      .where(and(eq(workouts.userId, userId), eq(workouts.importBatchId, batchId)))
      .returning({ id: workouts.id })
    const [owned] = await tx
      .delete(importBatches)
      .where(and(eq(importBatches.id, batchId), eq(importBatches.userId, userId)))
      .returning({ id: importBatches.id })
    // No owned batch → not this user's import (the workout delete matched
    // nothing either, by the stamping invariant). Roll back reports nothing.
    if (!owned) return null
    return { workoutsDeleted: deleted.length }
  })
}

/** Row type for the settings list. */
export type ImportBatchRow = typeof importBatches.$inferSelect

/** Lists a user's import batches, newest first. */
export function listImportBatches(userId: string) {
  return db
    .select()
    .from(importBatches)
    .where(eq(importBatches.userId, userId))
    .orderBy(desc(importBatches.createdAt))
}
