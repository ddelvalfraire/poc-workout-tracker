import {
  and,
  count,
  countDistinct,
  eq,
  gt,
  max,
  sql,
} from 'drizzle-orm'

import {
  programMetaPatchSchema,
  programMesocycleViolation,
  type ProgramMetaPatch,
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
  type PatchRunner,
  type Tx,
} from './program-ownership'

import {
  programs,
  programDays,
  programExercises,
  programSets,
  programSetOverrides,
  workouts,
  workoutExercises,
  sets,
} from './schema'
import {
  definedFields,
  patchErrorFromZod,
} from './program-patches-shared'

const META_FIELDS = [
  'name',
  'mesocycleWeeks',
  'deloadWeek',
  'checkInEveryDays',
  'icon',
  'description',
  'heroImageUrl',
  'sourceUrl',
  'notes',
] as const

type MetaField = (typeof META_FIELDS)[number]

/** One compact phrase per changed field — joined into the event's summary line. */
function metaFieldPhrase(field: MetaField, before: unknown, after: unknown): string {
  switch (field) {
    case 'name':
      return `renamed to "${String(after)}"`
    case 'mesocycleWeeks':
      return `mesocycle ${String(before)} → ${String(after)} weeks`
    case 'deloadWeek':
      return after === null ? 'deload week cleared' : `deload week → ${String(after)}`
    case 'checkInEveryDays':
      return after === null ? 'check-in cadence cleared' : `check-in every ${String(after)} days`
    default:
      return after === null ? `${field} cleared` : `${field} updated`
  }
}

/** The stored scalars the meta op needs, for the merge and the event. */
interface StoredMeta {
  name: string
  mesocycleWeeks: number
  deloadWeek: number | null
  checkInEveryDays: number | null
  icon: string | null
  description: string | null
  heroImageUrl: string | null
  sourceUrl: string | null
  notes: string | null
}

/**
 * Counts the per-week overrides in a program that address a week BEYOND
 * `weeks` — the orphan check behind updateProgramMeta's shrink refusal.
 * Ownership was already established by the caller's owned-program read; the
 * join chain here is addressing, not authorization.
 */
async function countOverridesBeyondWeek(
  tx: Tx,
  programId: string,
  weeks: number,
): Promise<{ n: number; maxWeek: number | null }> {
  const [row] = await tx
    .select({ n: count(), maxWeek: max(programSetOverrides.week) })
    .from(programSetOverrides)
    .innerJoin(programSets, eq(programSets.id, programSetOverrides.programSetId))
    .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
    .innerJoin(programDays, eq(programDays.id, programExercises.programDayId))
    .where(and(eq(programDays.programId, programId), gt(programSetOverrides.week, weeks)))
  return { n: row?.n ?? 0, maxWeek: row?.maxWeek ?? null }
}

/**
 * Counts the DISTINCT program weeks beyond `weeks` that already carry a
 * TRAINED workout — same predicate `programWeekState` uses (≥1 completed set,
 * so an instantiated-but-unlogged ghost counts for nothing). This is a REPORT,
 * never a gate: updateProgramMeta hands the number back so the caller can say
 * what the user's history looks like relative to the new block length. It
 * reads workouts; it never writes one.
 */
async function countTrainedWeeksBeyond(
  tx: Tx,
  userId: string,
  programId: string,
  weeks: number,
): Promise<number> {
  const [row] = await tx
    .select({ n: countDistinct(workouts.programWeek) })
    .from(workouts)
    .innerJoin(programDays, eq(programDays.id, workouts.programDayId))
    .where(
      and(
        eq(programDays.programId, programId),
        eq(workouts.userId, userId),
        gt(workouts.programWeek, weeks),
        sql`exists (
          select 1 from ${workoutExercises}
          inner join ${sets} on ${sets.workoutExerciseId} = ${workoutExercises.id}
          where ${workoutExercises.workoutId} = ${workouts.id} and ${sets.completed}
        )`,
      ),
    )
  return row?.n ?? 0
}

/**
 * Edits a program's own SCALARS — name, the article metadata (icon,
 * description, heroImageUrl, sourceUrl), notes, and the mesocycle shape
 * (mesocycleWeeks, deloadWeek, checkInEveryDays) — without touching a single
 * day, exercise, set or override. The granular alternative to `upsert_program`
 * for these fields: a full replace wipes and re-inserts the whole tree just to
 * fix a title, and drops any per-week override addressed to a slot the
 * replacement payload no longer carries.
 *
 * Partial semantics, exactly like updateProgramSet: omitted = unchanged,
 * explicit null = clear (on the nullable fields). The patch is re-parsed
 * through `programMetaPatchSchema` (`ProgramPatchError` on a bad value — blank
 * text collapses to null, URLs must be http(s)) so nothing outside the
 * full-replace schema's own bounds can reach a column.
 *
 * TWO rules run against the MERGED row (patch over stored), because neither is
 * visible to a schema that only sees the patch:
 *
 *  1. `deloadWeek` ≤ `mesocycleWeeks` — the shared `programMesocycleViolation`
 *     (lib/program-input.ts), so setting either half alone is still checked
 *     against the other half as stored.
 *
 *  2. SHRINKING `mesocycleWeeks` is REFUSED while any per-week OVERRIDE
 *     (`program_set_overrides`) addresses a week beyond the new length. That
 *     is the whole of rule 2 — it looks at authored overrides and at nothing
 *     else. Three behaviors were on the table. Cascade-delete: a metadata edit
 *     must never silently destroy prescription data the owner deliberately
 *     pinned. Leave them orphaned: that is the exact silent-drop failure this
 *     tool exists to end — the pins would simply stop taking effect,
 *     invisibly. So: refuse, with the count and the highest pinned week in the
 *     message, and the caller clears them with `remove_program_set_override`
 *     first (or keeps the longer mesocycle). Destroying a pin stays an
 *     explicit, separately logged act. GROWING the mesocycle is always fine,
 *     and an override pinned beyond the mesocycle stays legal
 *     (setProgramSetOverride never bounded `week`) — it is simply inert until
 *     the block is long enough to reach it.
 *
 * TRAINED HISTORY IS DELIBERATELY NOT GUARDED. Shrinking `mesocycleWeeks`
 * below weeks the user has already trained (`workouts.programWeek`) is
 * ALLOWED, and this op will never grow a refusal for it. The asymmetry with
 * rule 2 is the point: an override is authored CONFIG, a logged workout is a
 * FACT. Shrinking past an override strands configuration the user wrote — it
 * would stop applying with no signal. Shrinking past trained weeks strands
 * nothing: prescriptions are snapshotted at instantiation, so no logged
 * session is altered, re-derived or invalidated by a change to this
 * forward-looking scalar; the history stays exactly as trained. And the edit
 * is fully reversible — growing `mesocycleWeeks` is unconditionally allowed
 * and restores the prior state exactly, so there is no work to destroy and
 * nothing to confirm. (`programWeekState` clamps `currentWeek` only when a
 * cycle just completed, so an in-progress overshoot reads unclamped — its own
 * documented anomaly path, not this op's business to prevent.) What a shrink
 * DOES do is report: the result and the event payload carry
 * `trainedWeeksBeyond`, the number of distinct already-trained weeks past the
 * new length, so an agent-facing caller can relay the fact ("you have
 * workouts logged in 2 weeks past the new end; the block now ends at 6")
 * instead of blocking on it. Informational, never blocking.
 *
 * Ownership gate, unconditional write and event discipline as the policy
 * siblings above; the event names only the fields that actually changed.
 * Returns null when the program isn't owned. Like every other patch op it
 * makes NO 'proposed'-status check: a proposal is still the user's own row and
 * the patch ops are the sanctioned path for it — only the lifecycle and
 * sharing paths refuse proposals (ProposedProgramError).
 * Reads, in order: owned-program (with its current scalars) → orphaned
 * overrides → trained weeks beyond the new length (the last two only when the
 * mesocycle shrinks).
 */
export async function updateProgramMeta(
  userId: string,
  programId: string,
  patch: ProgramMetaPatch,
  actor: ProgramEventActor,
  runIn?: PatchRunner,
): Promise<{
  id: string
  changed: MetaField[]
  /** Distinct already-TRAINED program weeks past the new `mesocycleWeeks` —
   *  0 unless this call shrank it. A fact to relay, never a refusal. */
  trainedWeeksBeyond: number
} | null> {
  let values: Partial<ProgramMetaPatch>
  try {
    values = definedFields(programMetaPatchSchema.parse(patch))
  } catch (error: unknown) {
    throw patchErrorFromZod(error, 'invalid program metadata')
  }
  if (Object.keys(values).length === 0) {
    throw new ProgramPatchError('updateProgramMeta needs at least one field to change')
  }
  return (runIn ?? db).transaction(async (tx) => {
    const [stored] = await tx
      .select({
        name: programs.name,
        mesocycleWeeks: programs.mesocycleWeeks,
        deloadWeek: programs.deloadWeek,
        checkInEveryDays: programs.checkInEveryDays,
        icon: programs.icon,
        description: programs.description,
        heroImageUrl: programs.heroImageUrl,
        sourceUrl: programs.sourceUrl,
        notes: programs.notes,
      })
      .from(programs)
      .where(and(eq(programs.id, programId), eq(programs.userId, userId)))
      .limit(1)
    if (!stored) return null
    const current = stored as StoredMeta

    // Rule 1 — the deload must land inside the mesocycle, merged.
    const mesocycleWeeks = values.mesocycleWeeks ?? current.mesocycleWeeks
    const deloadWeek = values.deloadWeek !== undefined ? values.deloadWeek : current.deloadWeek
    const violation = programMesocycleViolation({ mesocycleWeeks, deloadWeek })
    if (violation) throw new ProgramPatchError(violation.message)

    // Rule 2 — a shrink may not strand per-week overrides (see the doc above).
    // Trained history is NOT a gate here: it is counted and reported, never
    // refused (the config-vs-fact asymmetry, documented above).
    let trainedWeeksBeyond = 0
    if (values.mesocycleWeeks !== undefined && mesocycleWeeks < current.mesocycleWeeks) {
      const orphans = await countOverridesBeyondWeek(tx, programId, mesocycleWeeks)
      if (orphans.n > 0) {
        // One expression for both halves of the agreement: "1 override pins",
        // "2 overrides pin".
        const [plural, verb] = orphans.n === 1 ? ['', 's'] : ['s', '']
        throw new ProgramPatchError(
          `Cannot shrink mesocycleWeeks to ${mesocycleWeeks}: ${orphans.n} per-week override${plural} pin${verb} a week beyond it (highest: week ${String(orphans.maxWeek)}). Remove them with remove_program_set_override first, or keep the longer mesocycle.`,
        )
      }
      trainedWeeksBeyond = await countTrainedWeeksBeyond(tx, userId, programId, mesocycleWeeks)
    }

    const changed = META_FIELDS.filter(
      (field) => values[field] !== undefined && values[field] !== current[field],
    )
    await tx
      .update(programs)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(programs.id, programId))
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'update_program_meta',
      summary:
        changed.length === 0
          ? 'Program details unchanged'
          : `Program details: ${changed
              .map((field) => metaFieldPhrase(field, current[field], values[field]))
              .join(', ')}`,
      payload: {
        before: Object.fromEntries(changed.map((field) => [field, current[field]])),
        after: {
          ...Object.fromEntries(changed.map((field) => [field, values[field]])),
          // Recorded so the change log can explain, after the fact, that the
          // block was shortened past weeks the user had already trained.
          ...(trainedWeeksBeyond > 0 && { trainedWeeksBeyond }),
        },
      },
    })
    return { id: programId, changed, trainedWeeksBeyond }
  })
}

/** WHY a training max moved — stamped into the event payload so the change
 *  log can distinguish the engine's cycle bump from a deliberate reset. */
