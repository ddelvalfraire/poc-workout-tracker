import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from './index'
import { recordProgramEvent, type ProgramEventActor } from './program-events'
import {
  ProgramPatchError,
  assertSetRowIntegrity,
  bumpUpdatedAt,
  findOwnedExercise,
  type PatchRunner,
} from './program-ownership'
import { normalizeFields, pickFields, type SetTargets } from './program-bulk-shared'
import { programSets } from './schema'

/**
 * The set-level fan-outs — "fill down" (one set's targets onto its siblings)
 * and the quick-entry scheme apply (reconcile an exercise to exactly the set
 * list a scheme describes). Both rewrite `program_sets` rows under ONE
 * exercise, and both validate the whole outcome before writing any of it.
 */

/** Which sets a fill-down reaches. 'below' matches the affordance ("fill the
 *  REMAINING sets"); 'all' rewrites every sibling. Never the source itself. */
export type FillDownScope = 'below' | 'all'

/**
 * Copies one set's TARGET fields onto its siblings within the same exercise —
 * the "fill down" affordance, as ONE op. Shape (`setType`, `metricMode`) never
 * travels, so a warm-up row stays a warm-up and a timed set stays timed; only
 * the prescription copies.
 *
 * Every written row is revalidated against the Phase-1 cross-field rules with
 * the SAME merge-then-revalidate discipline as `updateProgramSet` — a fill that
 * would leave a timed set without a duration, or an inverted rep range, is a
 * `ProgramPatchError`, and because it all rides one transaction NOTHING is
 * written when one row would be invalid. A partial fill is a wrong plan.
 *
 * Returns the number of sets changed (0 when the source is the only/last set —
 * a no-op success, with no event). Null when the node isn't owned/found.
 * Reads, in order: owned-exercise → the exercise's set rows.
 */
export async function fillProgramSetsDown(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  fromSetNumber: number,
  actor: ProgramEventActor,
  options?: { scope?: FillDownScope; fields?: readonly (keyof SetTargets)[]; runIn?: PatchRunner },
): Promise<{ updated: number } | null> {
  const scope = options?.scope ?? 'below'
  const fields = normalizeFields(options?.fields)
  return (options?.runIn ?? db).transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const rows = await tx
      .select({
        setNumber: programSets.setNumber,
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
      .where(eq(programSets.programExerciseId, found.exerciseId))
      .orderBy(asc(programSets.setNumber))

    const source = rows.find((r) => r.setNumber === fromSetNumber)
    if (!source) return null
    const values = pickFields(source, fields)
    const targets = rows.filter((r) =>
      scope === 'below' ? r.setNumber > fromSetNumber : r.setNumber !== fromSetNumber,
    )
    if (targets.length === 0) return { updated: 0 }

    // Validate EVERY merged row before writing any of them.
    for (const target of targets) {
      assertSetRowIntegrity({ ...target, ...values })
    }
    await tx
      .update(programSets)
      .set(values)
      .where(
        and(
          eq(programSets.programExerciseId, found.exerciseId),
          inArray(
            programSets.setNumber,
            targets.map((t) => t.setNumber),
          ),
        ),
      )
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'fill_program_sets',
      summary: `Fill set ${fromSetNumber} down to ${targets.length} set${
        targets.length === 1 ? '' : 's'
      } of ${found.name} (Day ${dayPosition + 1})`,
      payload: {
        dayPosition,
        exercisePosition,
        fromSetNumber,
        scope,
        setNumbers: targets.map((t) => t.setNumber),
        after: values,
      },
    })
    return { updated: targets.length }
  })
}

/** One planned set a scheme asks for, already in canonical kg (the tool /
 *  action layer converts, exactly as the single-set patch ops require). */
export interface SchemeSetRow {
  repMin: number
  repMax: number
  rir: number | null
  rpe: number | null
  suggestedLoadKg: number | null
}

/**
 * Reconciles one exercise's sets to EXACTLY the list a quick-entry scheme
 * describes (`5,5,3,3,1`, `3x8-12 @ 7RPE` — see lib/set-scheme.ts, which owns
 * the parsing): sets 1..n are updated in place, extra sets are appended, and
 * any tail beyond n is removed. One transaction, one event.
 *
 * This is the add/update/remove batch the affordance implies, as a SINGLE op.
 * A five-set scheme replacing a two-set exercise is 3 adds + 2 updates — five
 * patches through the granular path, and a ten-set one already eats half of
 * MAX_PROPOSAL_PATCHES before anything else in the batch. As one op it costs
 * one slot, and it cannot half-apply.
 *
 * `setType` and `metricMode` are preserved on surviving rows and default to
 * working / reps_weight on appended ones — a scheme prescribes targets, not
 * shape. Effort and load travel as the scheme gave them, INCLUDING nulls: a
 * scheme with no `@8RPE` clears a stale RPE rather than leaving a target the
 * author did not ask for. Every resulting row is revalidated (Phase-1
 * cross-field rules) before anything is written.
 *
 * Returns the per-kind counts, or null when the exercise isn't owned/found.
 * Throws `ProgramPatchError` on an empty scheme (an exercise needs ≥1 set —
 * remove the exercise instead) or an invalid resulting row.
 * Reads, in order: owned-exercise → the exercise's current set rows.
 */
export async function applyProgramSetScheme(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  schemeSets: readonly SchemeSetRow[],
  actor: ProgramEventActor,
  options?: { runIn?: PatchRunner; summary?: string },
): Promise<{ added: number; updated: number; removed: number } | null> {
  if (schemeSets.length === 0) {
    throw new ProgramPatchError(
      'a set scheme must describe at least one set — remove the exercise instead',
    )
  }
  return (options?.runIn ?? db).transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const current = await tx
      .select({
        setNumber: programSets.setNumber,
        metricMode: programSets.metricMode,
        durationSec: programSets.durationSec,
      })
      .from(programSets)
      .where(eq(programSets.programExerciseId, found.exerciseId))
      .orderBy(asc(programSets.setNumber))

    // Validate the whole outcome first — no row is written unless all can be.
    schemeSets.forEach((scheme, index) => {
      const existing = current[index]
      assertSetRowIntegrity({
        metricMode: existing?.metricMode ?? 'reps_weight',
        durationSec: existing?.durationSec ?? null,
        repMin: scheme.repMin,
        repMax: scheme.repMax,
      })
    })

    let updated = 0
    for (const [index, scheme] of schemeSets.entries()) {
      const values = {
        repMin: scheme.repMin,
        repMax: scheme.repMax,
        rir: scheme.rir,
        rpe: scheme.rpe,
        suggestedLoadKg: scheme.suggestedLoadKg,
      }
      if (index < current.length) {
        await tx
          .update(programSets)
          .set(values)
          .where(
            and(
              eq(programSets.programExerciseId, found.exerciseId),
              eq(programSets.setNumber, current[index].setNumber),
            ),
          )
        updated += 1
      } else {
        await tx.insert(programSets).values({
          programExerciseId: found.exerciseId,
          setNumber: index + 1,
          setType: 'working',
          metricMode: 'reps_weight',
          tempo: null,
          durationSec: null,
          distanceM: null,
          restSec: null,
          technique: null,
          ...values,
        })
      }
    }
    const removedNumbers = current.slice(schemeSets.length).map((r) => r.setNumber)
    if (removedNumbers.length > 0) {
      await tx
        .delete(programSets)
        .where(
          and(
            eq(programSets.programExerciseId, found.exerciseId),
            inArray(programSets.setNumber, removedNumbers),
          ),
        )
    }
    const added = Math.max(0, schemeSets.length - current.length)
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'apply_set_scheme',
      summary:
        options?.summary ??
        `Set scheme on ${found.name}: ${schemeSets.length} set${
          schemeSets.length === 1 ? '' : 's'
        } (Day ${dayPosition + 1})`,
      payload: {
        dayPosition,
        exercisePosition,
        added,
        updated,
        removed: removedNumbers.length,
        after: schemeSets,
      },
    })
    return { added, updated, removed: removedNumbers.length }
  })
}
