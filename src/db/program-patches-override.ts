import {
  and,
  eq,
} from 'drizzle-orm'

import {
  type Technique,
} from '@/lib/programs/program-input'

import {
  db,
} from './index'

import {
  recordProgramEvent,
  type ProgramEventActor,
} from './program-events'
import {
  assertSetRowIntegrity,
  bumpUpdatedAt,
  findOwnedExercise,
  type PatchRunner,
} from './program-ownership'

import {
  programSets,
  programSetOverrides,
} from './schema'
import {
  definedFields,
  parseTechnique,
} from './program-patches-shared'

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
  restSec?: number | null
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
  'restSec',
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
  actor: ProgramEventActor,
  runIn?: PatchRunner,
): Promise<{ week: number; cleared: boolean } | null> {
  const values = definedFields(patch)
  if (Object.keys(values).length === 0) return null
  if (values.technique != null) values.technique = parseTechnique(values.technique)
  return (runIn ?? db).transaction(async (tx) => {
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
        restSec: programSetOverrides.restSec,
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
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'set_program_set_override',
      summary: cleared
        ? `Clear week ${week} override on set ${setNumber} of ${found.name} (Day ${dayPosition + 1})`
        : `Pin week ${week} targets on set ${setNumber} of ${found.name} (Day ${dayPosition + 1})`,
      payload: { week, setNumber, after: values, cleared },
    })
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
  actor: ProgramEventActor,
  runIn?: PatchRunner,
): Promise<{ removed: true } | null> {
  return (runIn ?? db).transaction(async (tx) => {
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
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'remove_program_set_override',
      summary: `Remove week ${week} override on set ${setNumber} of ${found.name} (Day ${dayPosition + 1})`,
      payload: { week, setNumber },
    })
    return { removed: true }
  })
}
