import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import { db } from './index'
import { recordProgramEvent, type ProgramEventActor } from './program-events'
import { bumpUpdatedAt, findOwnedDayId, type PatchRunner } from './program-ownership'
import { OVERRIDE_FIELDS, groupBy, pickFields, selectOverrides } from './program-bulk-shared'
import {
  programDays,
  programExercises,
  programExerciseMuscles,
  programSets,
  programSetOverrides,
} from './schema'

/**
 * Duplicate day — the deepest copy of the bulk set, and the only one that
 * creates rows at every level of the program tree. See db/program-bulk.ts for
 * why these fan-outs are ops rather than client loops.
 */

/**
 * Duplicates one program day — the day row, its exercises (superset groups,
 * progression, per-exercise overshoot policy, muscle tags), their sets, AND the
 * per-week overrides on those sets — inserting the copy IMMEDIATELY AFTER the
 * source and shifting the later days down so positions stay 0-based contiguous.
 *
 * PER-WEEK OVERRIDES ARE COPIED. The alternative (drop them, hand back a bare
 * skeleton) was rejected: an override is part of what the day PRESCRIBES, so a
 * "duplicate" that silently drops week 3's back-off targets produces a day that
 * looks identical in the builder and trains differently from week 2 onward — a
 * wrong plan with no signal, which is the failure mode this whole batch of
 * primitives exists to prevent. Copying also matches the fidelity
 * `copyProgramTree` already established for whole-program clones (db/programs.ts),
 * so duplicate-day and duplicate-program agree about what a copy means. The
 * event payload reports `overridesCopied` so the count is auditable rather than
 * invisible; a lifter who wants the skeleton clears the overrides on the copy,
 * which is one visible op instead of an invisible policy.
 *
 * Overrides are copied VERBATIM, including their `week` numbers — the copy
 * lives in the same mesocycle as its source, so week 3 stays week 3.
 *
 * Returns the new day's 0-based position, or null when the program/day isn't
 * owned. Reads, in order: owned-day → day row → exercises → sets → overrides →
 * muscle tags.
 */
export async function duplicateProgramDay(
  userId: string,
  programId: string,
  dayPosition: number,
  actor: ProgramEventActor,
  options?: { name?: string; runIn?: PatchRunner },
): Promise<{ position: number; overridesCopied: number } | null> {
  return (options?.runIn ?? db).transaction(async (tx) => {
    const sourceDayId = await findOwnedDayId(tx, userId, programId, dayPosition)
    if (!sourceDayId) return null

    const [sourceDay] = await tx
      .select({
        name: programDays.name,
        notes: programDays.notes,
        weekdays: programDays.weekdays,
      })
      .from(programDays)
      .where(eq(programDays.id, sourceDayId))
      .limit(1)
    if (!sourceDay) return null

    const sourceExercises = await tx
      .select({
        id: programExercises.id,
        wgerExerciseId: programExercises.wgerExerciseId,
        source: programExercises.source,
        name: programExercises.name,
        position: programExercises.position,
        supersetGroup: programExercises.supersetGroup,
        progression: programExercises.progression,
        overshootPolicy: programExercises.overshootPolicy,
      })
      .from(programExercises)
      .where(eq(programExercises.programDayId, sourceDayId))
      .orderBy(asc(programExercises.position))

    const exerciseIds = sourceExercises.map((e) => e.id)
    const sourceSets = exerciseIds.length
      ? await tx
          .select({
            id: programSets.id,
            programExerciseId: programSets.programExerciseId,
            setNumber: programSets.setNumber,
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
          .where(inArray(programSets.programExerciseId, exerciseIds))
          .orderBy(asc(programSets.setNumber))
      : []

    const setIds = sourceSets.map((s) => s.id)
    const sourceOverrides = setIds.length > 0 ? await selectOverrides(tx, setIds) : []
    const sourceMuscles = exerciseIds.length
      ? await tx
          .select({
            programExerciseId: programExerciseMuscles.programExerciseId,
            muscle: programExerciseMuscles.muscle,
            role: programExerciseMuscles.role,
          })
          .from(programExerciseMuscles)
          .where(inArray(programExerciseMuscles.programExerciseId, exerciseIds))
      : []

    // Make room, then land the copy directly after its source. The per-parent
    // unique on `position` is DEFERRABLE, so the transient overlap is fine.
    const position = dayPosition + 1
    await tx
      .update(programDays)
      .set({ position: sql`${programDays.position} + 1` })
      .where(and(eq(programDays.programId, programId), gt(programDays.position, dayPosition)))

    const [newDay] = await tx
      .insert(programDays)
      .values({
        programId,
        name: options?.name ?? `${sourceDay.name} (copy)`,
        position,
        notes: sourceDay.notes,
        // The schedule travels with the day — the copy is the same session on
        // (initially) the same weekdays, which the owner then edits. Diverging
        // here would silently unschedule the copy.
        weekdays: sourceDay.weekdays,
      })
      .returning({ id: programDays.id })

    const setsByExercise = groupBy(sourceSets, (s) => s.programExerciseId)
    const overridesBySet = groupBy(sourceOverrides, (o) => o.programSetId)
    const musclesByExercise = groupBy(sourceMuscles, (m) => m.programExerciseId)

    let overridesCopied = 0
    for (const exercise of sourceExercises) {
      const [newExercise] = await tx
        .insert(programExercises)
        .values({
          programDayId: newDay.id,
          wgerExerciseId: exercise.wgerExerciseId,
          source: exercise.source,
          name: exercise.name,
          position: exercise.position,
          supersetGroup: exercise.supersetGroup,
          progression: exercise.progression,
          overshootPolicy: exercise.overshootPolicy,
        })
        .returning({ id: programExercises.id })

      const exerciseSets = setsByExercise.get(exercise.id) ?? []
      if (exerciseSets.length > 0) {
        // Postgres returns batch-insert RETURNING rows in VALUES order — the
        // index zip below relies on it, exactly as `copyProgramTree` does.
        const newSets = await tx
          .insert(programSets)
          .values(
            exerciseSets.map((s) => ({
              programExerciseId: newExercise.id,
              setNumber: s.setNumber,
              setType: s.setType,
              metricMode: s.metricMode,
              repMin: s.repMin,
              repMax: s.repMax,
              rir: s.rir,
              rpe: s.rpe,
              suggestedLoadKg: s.suggestedLoadKg,
              tempo: s.tempo,
              durationSec: s.durationSec,
              distanceM: s.distanceM,
              restSec: s.restSec,
              technique: s.technique,
            })),
          )
          .returning({ id: programSets.id })

        const overrideRows = exerciseSets.flatMap((s, i) =>
          (overridesBySet.get(s.id) ?? []).map((o) => ({
            programSetId: newSets[i].id,
            week: o.week,
            ...pickFields(o, OVERRIDE_FIELDS),
          })),
        )
        if (overrideRows.length > 0) {
          overridesCopied += overrideRows.length
          await tx.insert(programSetOverrides).values(overrideRows)
        }
      }

      // Muscle tags copy as STORED — no catalog fetch, so this path never
      // touches the network (same reasoning as copyProgramTree).
      const muscles = musclesByExercise.get(exercise.id) ?? []
      if (muscles.length > 0) {
        await tx.insert(programExerciseMuscles).values(
          muscles.map((m) => ({
            programExerciseId: newExercise.id,
            muscle: m.muscle,
            role: m.role,
          })),
        )
      }
    }

    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'duplicate_program_day',
      summary: `Duplicate Day ${dayPosition + 1} ("${sourceDay.name}") → Day ${position + 1}`,
      payload: {
        from: dayPosition,
        to: position,
        exercises: sourceExercises.length,
        sets: sourceSets.length,
        overridesCopied,
      },
    })
    return { position, overridesCopied }
  })
}
