import { and, count, countDistinct, eq, gt, gte, inArray, lt, lte, max, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  setTypeSchema,
  metricModeSchema,
  techniqueSchema,
  progressionSchema,
  deloadPolicySchema,
  dietPhaseSchema,
  programMetaPatchSchema,
  programSetIntegrityViolation,
  programMesocycleViolation,
  type Technique,
  type Progression,
  type DeloadPolicy,
  type DietPhase,
  type ProgramMetaPatch,
} from '@/lib/program-input'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import type { AutoregStallPolicy } from '@/lib/autoregulate'
import { overshootPolicySchema, type OvershootPolicy } from '@/lib/overshoot-policy'
import { TM_BASED_SCHEMES } from '@/lib/substitute-slot'
import { db } from './index'
import { requireFeature } from './entitlements'
import { recordProgramEvent, type ProgramEventActor } from './program-events'
import { loadExerciseCatalog, muscleRowsFor, type ExerciseCatalog } from './programs'
import {
  programs,
  programDays,
  programExercises,
  programExerciseMuscles,
  programSets,
  programSetOverrides,
  workouts,
  workoutExercises,
  sets,
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
 * Every successful op bumps `programs.updatedAt` (the list sort key) AND
 * appends exactly one `program_events` row (the change log — see
 * program-events.ts) inside the same transaction; the required `actor` param
 * says who edited, threaded from the boundary so no call site can forget it.
 * Positions stay 0-based contiguous and setNumbers 1-based
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

/**
 * Where a patch op runs: the root `db` (the default — each op owns its own
 * transaction, unchanged behavior) or a caller-supplied runner that executes
 * the op's body inside an ALREADY-OPEN transaction. The two callers that need
 * the latter are the batch-proposal confirm (db/patch-proposals.ts — all
 * patches commit or none do) and the block-restart TM carry-forward
 * (cloneProgram — increments ride the clone's transaction). Ops stay
 * event-logged and actor-attributed identically either way.
 */
export interface PatchRunner {
  transaction<T>(cb: (tx: Tx) => Promise<T>): Promise<T>
}

/** Wraps an open transaction as a PatchRunner (the op's body just runs on it —
 *  a throw aborts the caller's whole transaction, which is the point). */
export function withTx(tx: Tx): PatchRunner {
  return { transaction: (cb) => cb(tx) }
}

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
): Promise<{
  exerciseId: string
  dayId: string
  wgerExerciseId: number
  source: ExerciseSource
  name: string
} | null> {
  const [pe] = await tx
    .select({
      exerciseId: programExercises.id,
      dayId: programDays.id,
      // Current identity halves, so a partial identity patch can retag with
      // the effective (source, id) — patch value ?? stored value.
      wgerExerciseId: programExercises.wgerExerciseId,
      source: programExercises.source,
      // Current name, so event summaries can say WHAT changed without a re-read.
      name: programExercises.name,
    })
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
// Program ops
// ---------------------------------------------------------------------------

/**
 * Flips the program-level auto-regulation switch (see programs.autoregulation:
 * false skips the Layer 1 stall rules at derive time) and, when `stallPolicy`
 * is given, sets the fixed-mode stall policy alongside it
 * (programs.autoregStallPolicy — omitted preserves the stored policy). A
 * narrow patch op — not upsert_program — because the full-replace path wipes
 * supersets/overrides, and flipping a setting must never cost plan structure.
 * The event names the policy in summary/payload ONLY when it actually
 * changed — an unchanged pass-through stays the plain toggle line. Returns
 * null when the program isn't owned. Reads, in order: owned-program (with its
 * current stall policy).
 */
export async function setProgramAutoregulation(
  userId: string,
  programId: string,
  enabled: boolean,
  actor: ProgramEventActor,
  stallPolicy?: AutoregStallPolicy,
): Promise<{ id: string } | null> {
  // The autoreg paid gate — same check as saveProgram/updateProgram
  // (db/programs.ts): this narrow op is the third write path to
  // programs.autoregulation (MCP's set_program_policy rides it), and leaving
  // it open would hand back the bypass the upsert gate closes. Turning the
  // switch OFF is always allowed.
  if (enabled) await requireFeature(userId, 'autoreg')
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: programs.id, autoregStallPolicy: programs.autoregStallPolicy })
      .from(programs)
      .where(and(eq(programs.id, programId), eq(programs.userId, userId)))
      .limit(1)
    if (!owned) return null
    const policyChanged = stallPolicy !== undefined && stallPolicy !== owned.autoregStallPolicy
    await tx
      .update(programs)
      .set({
        autoregulation: enabled,
        ...(stallPolicy !== undefined ? { autoregStallPolicy: stallPolicy } : {}),
        updatedAt: new Date(),
      })
      .where(eq(programs.id, programId))
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'set_program_autoregulation',
      summary: policyChanged
        ? `Auto-regulation ${enabled ? 'on' : 'off'} · stall policy: ${
            stallPolicy === 'first-set' ? 'top set decides' : 'every set counts'
          }`
        : `Auto-regulation ${enabled ? 'on' : 'off'}`,
      payload: {
        after: {
          autoregulation: enabled,
          ...(policyChanged ? { autoregStallPolicy: stallPolicy } : {}),
        },
      },
    })
    return { id: programId }
  })
}

/** One human-readable line for the deload-policy event summary. */
function deloadPolicySummary(policy: DeloadPolicy | null): string {
  if (policy === null) return 'Deload policy cleared (legacy behavior)'
  if (policy.mode === 'none') return 'Deload policy: none'
  if (policy.mode === 'reactive') return 'Deload policy: reactive'
  const { loadFactor, setFactor, rpeCap, timedExercises } = policy.shape
  return `Deload policy: scheduled (load ×${loadFactor}, sets ×${setFactor}${
    rpeCap !== null ? `, RPE cap ${rpeCap}` : ''
  }${timedExercises === 'scaled' ? ', timed sets scaled' : ''})`
}

/**
 * Sets (or clears, with null) the program-level deload policy
 * (programs.deloadPolicy — see lib/program-input.ts deloadPolicySchema; the
 * read-time resolver in lib/progression.ts turns null back into the legacy
 * regime). A non-null policy is re-parsed through the schema
 * (`ProgramPatchError` on mismatch) so nothing outside the union can reach
 * the column. Same narrow-op rationale, ownership gate, and event discipline
 * as setProgramAutoregulation above — including the unconditional write.
 * Returns null when the program isn't owned. Reads, in order: owned-program.
 */
export async function setProgramDeloadPolicy(
  userId: string,
  programId: string,
  policy: DeloadPolicy | null,
  actor: ProgramEventActor,
): Promise<{ id: string } | null> {
  let parsed: DeloadPolicy | null = null
  if (policy !== null) {
    try {
      parsed = deloadPolicySchema.parse(policy)
    } catch (error: unknown) {
      throw patchErrorFromZod(error, 'invalid deload policy')
    }
  }
  return db.transaction(async (tx) => {
    const owned = await findOwnedProgramId(tx, userId, programId)
    if (!owned) return null
    await tx
      .update(programs)
      .set({ deloadPolicy: parsed, updatedAt: new Date() })
      .where(eq(programs.id, programId))
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'set_program_deload_policy',
      summary: deloadPolicySummary(parsed),
      payload: { after: { deloadPolicy: parsed } },
    })
    return { id: programId }
  })
}

/**
 * Sets (or clears, with null) the program's diet-phase context
 * (programs.dietPhase — see lib/program-input.ts dietPhaseSchema). A
 * non-null phase is re-parsed through the schema (`ProgramPatchError` on
 * mismatch) so nothing outside the union can reach the column. EVERY
 * explicit write — including a null clear — stamps diet_phase_set_at = now:
 * the setter is a deliberate statement about the diet, and set_at is the
 * staleness anchor get_program exposes. Same narrow-op rationale, ownership
 * gate, and event discipline as setProgramDeloadPolicy above — including
 * the unconditional write. Returns null when the program isn't owned.
 * Reads, in order: owned-program.
 */
export async function setProgramDietPhase(
  userId: string,
  programId: string,
  phase: DietPhase | null,
  actor: ProgramEventActor,
  runIn?: PatchRunner,
): Promise<{ id: string } | null> {
  let parsed: DietPhase | null = null
  if (phase !== null) {
    try {
      parsed = dietPhaseSchema.parse(phase)
    } catch (error: unknown) {
      throw patchErrorFromZod(error, 'invalid diet phase')
    }
  }
  return (runIn ?? db).transaction(async (tx) => {
    const owned = await findOwnedProgramId(tx, userId, programId)
    if (!owned) return null
    await tx
      .update(programs)
      .set({ dietPhase: parsed, dietPhaseSetAt: new Date(), updatedAt: new Date() })
      .where(eq(programs.id, programId))
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'set_program_diet_phase',
      summary: parsed === null ? 'Diet phase cleared' : `Diet phase: ${parsed}`,
      payload: { after: { dietPhase: parsed } },
    })
    return { id: programId }
  })
}

/**
 * Sets (or clears, with null) the program-level overshoot / goal-met policy
 * (programs.overshootPolicy — see lib/overshoot-policy.ts; null resolves to
 * the per-scheme default at read time: strict for load-anchored schemes,
 * e1rm-equivalent for rpe-target). A non-null policy is re-parsed through
 * the schema (`ProgramPatchError` on mismatch) so nothing outside the union
 * can reach the column. Same narrow-op rationale, ownership gate, and event
 * discipline as setProgramDeloadPolicy above — including the unconditional
 * write. Returns null when the program isn't owned. Reads, in order:
 * owned-program.
 */
export async function setProgramOvershootPolicy(
  userId: string,
  programId: string,
  policy: OvershootPolicy | null,
  actor: ProgramEventActor,
): Promise<{ id: string } | null> {
  let parsed: OvershootPolicy | null = null
  if (policy !== null) {
    try {
      parsed = overshootPolicySchema.parse(policy)
    } catch (error: unknown) {
      throw patchErrorFromZod(error, 'invalid overshoot policy')
    }
  }
  return db.transaction(async (tx) => {
    const owned = await findOwnedProgramId(tx, userId, programId)
    if (!owned) return null
    await tx
      .update(programs)
      .set({ overshootPolicy: parsed, updatedAt: new Date() })
      .where(eq(programs.id, programId))
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'set_program_overshoot_policy',
      summary:
        parsed === null
          ? 'Overshoot policy cleared (per-scheme defaults)'
          : `Overshoot policy: ${parsed}`,
      payload: { after: { overshootPolicy: parsed } },
    })
    return { id: programId }
  })
}

/**
 * Flips the program-level plan-sync switch (see programs.planSync: false stops
 * finished sessions from writing their performed loads back into the plan —
 * the deliberate-percentage escape). Same narrow-op rationale, ownership gate,
 * and event discipline as setProgramAutoregulation above — including the
 * sibling's unconditional write (no unchanged-value short-circuit). Returns
 * null when the program isn't owned. Reads, in order: owned-program.
 */
export async function setProgramPlanSync(
  userId: string,
  programId: string,
  enabled: boolean,
  actor: ProgramEventActor,
): Promise<{ id: string } | null> {
  return db.transaction(async (tx) => {
    const owned = await findOwnedProgramId(tx, userId, programId)
    if (!owned) return null
    await tx
      .update(programs)
      .set({ planSync: enabled, updatedAt: new Date() })
      .where(eq(programs.id, programId))
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'set_program_plan_sync',
      summary: `Plan sync ${enabled ? 'on' : 'off'}`,
      payload: { after: { planSync: enabled } },
    })
    return { id: programId }
  })
}

/** The program-scalar fields `updateProgramMeta` may touch, in the order the
 *  event summary reads them. */
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
export type TrainingMaxReason = 'cycle-end' | 'reset' | 'manual' | 'block-restart'

/** Trims float noise for event summaries (kg, max 1 decimal): 142.5 stays
 *  142.5, 140.0000001 reads 140. Payloads keep full precision. */
function formatKg(valueKg: number): string {
  return String(Math.round(valueKg * 10) / 10)
}

/**
 * THE single call site for every training-max change (TM lifecycle plan §1):
 * updates ONLY `progression.trainingMaxKg` on a percent-1rm / amrap-cycle
 * exercise — other schemes carry no TM and throw `ProgramPatchError` — and
 * logs `action: 'adjust_training_max'` with `{before, after, reason}` in the
 * same transaction ("Squat TM 140 → 145 kg (cycle-end)"). Every other
 * progression field is preserved verbatim (a TM move must never cost wave or
 * percent structure). `options.bankedWaves` is the wave-boundary persist's
 * private marker (see program-input.ts): it stamps how many completed waves
 * the new TM already folds in, so derive stops re-adding them — callers other
 * than instantiation never pass it. Returns null when the exercise isn't
 * owned/found. Reads, in order: owned-exercise → current progression.
 */
export async function setTrainingMax(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  trainingMaxKg: number,
  reason: TrainingMaxReason,
  actor: ProgramEventActor,
  options?: { bankedWaves?: number; runIn?: PatchRunner },
): Promise<{ id: string; trainingMaxKg: number } | null> {
  if (!Number.isFinite(trainingMaxKg) || trainingMaxKg < 0) {
    throw new ProgramPatchError('trainingMax must be a non-negative number')
  }
  return (options?.runIn ?? db).transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const [row] = await tx
      .select({ progression: programExercises.progression })
      .from(programExercises)
      .where(eq(programExercises.id, found.exerciseId))
      .limit(1)
    if (!row) return null
    const progression = row.progression as Progression | null
    if (progression?.scheme !== 'percent-1rm' && progression?.scheme !== 'amrap-cycle') {
      throw new ProgramPatchError(
        `${found.name} uses ${progression?.scheme ?? 'no'} progression — a training max applies only to percent-1rm or amrap-cycle exercises`,
      )
    }
    const before = progression.trainingMaxKg
    // Immutable merge: only the TM (and, for the wave persist, its banked-wave
    // marker) moves; wave/percent structure is preserved verbatim.
    const next: Progression = {
      ...progression,
      trainingMaxKg,
      ...(progression.scheme === 'amrap-cycle' && options?.bankedWaves !== undefined
        ? { bankedWaves: options.bankedWaves }
        : {}),
    }
    await tx
      .update(programExercises)
      .set({ progression: parseProgression(next) })
      .where(eq(programExercises.id, found.exerciseId))
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'adjust_training_max',
      summary: `${found.name} TM ${formatKg(before)} → ${formatKg(trainingMaxKg)} kg (${reason})`,
      payload: {
        dayPosition,
        exercisePosition,
        before: { trainingMaxKg: before },
        after: { trainingMaxKg },
        reason,
      },
    })
    return { id: found.exerciseId, trainingMaxKg }
  })
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
  actor: ProgramEventActor,
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
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'add_program_day',
      summary: `Add day "${day.name}" (Day ${position + 1})`,
      payload: { after: { name: day.name, notes: day.notes ?? null, position } },
    })
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
  actor: ProgramEventActor,
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
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'update_program_day',
      summary:
        values.name !== undefined
          ? `Rename Day ${dayPosition + 1} → "${values.name}"`
          : `Update Day ${dayPosition + 1} notes`,
      payload: { dayPosition, after: values },
    })
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
  actor: ProgramEventActor,
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
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'remove_program_day',
      summary: `Remove Day ${dayPosition + 1}`,
      payload: { dayPosition },
    })
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
  actor: ProgramEventActor,
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
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'move_program_day',
      summary: `Move Day ${from + 1} → Day ${to + 1}`,
      payload: { from, to },
    })
    return { moved: true }
  })
}

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
  const catalog = await loadExerciseCatalog(userId) // network read stays outside the tx
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
  const catalog = identityChanged ? await loadExerciseCatalog(userId) : null
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
 * rest, technique, and non-load overrides all survive — structure transfers,
 * loads don't (#215). `updateProgramExercise` deliberately keeps loads: it
 * is the general patch op, not a movement swap.
 * Reads, in order: owned-exercise, current-progression, set-ids.
 */
export async function substituteProgramExercise(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  substitute: { wgerExerciseId: number; source: ExerciseSource; name: string },
  actor: ProgramEventActor,
): Promise<{ id: string } | null> {
  const catalog = await loadExerciseCatalog(userId)
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
    await tx
      .update(programSets)
      .set({ suggestedLoadKg: null })
      .where(eq(programSets.programExerciseId, found.exerciseId))
    if (setRows.length > 0) {
      await tx
        .update(programSetOverrides)
        .set({ suggestedLoadKg: null })
        .where(
          inArray(
            programSetOverrides.programSetId,
            setRows.map((row) => row.id),
          ),
        )
    }
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
          ...(dropProgression && { progressionCleared: true }),
        },
      },
    })
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
