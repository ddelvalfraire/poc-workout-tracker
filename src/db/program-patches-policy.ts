import {
  and,
  eq,
} from 'drizzle-orm'

import {
  deloadPolicySchema,
  dietPhaseSchema,
  type DeloadPolicy,
  type DietPhase,
} from '@/lib/program-input'

import type {
  AutoregStallPolicy,
} from '@/lib/autoregulate'
import {
  overshootPolicySchema,
  type OvershootPolicy,
} from '@/lib/overshoot-policy'

import {
  db,
} from './index'
import {
  requireFeature,
} from './entitlements'
import {
  recordProgramEvent,
  type ProgramEventActor,
} from './program-events'
import {
  findOwnedProgramId,
  type PatchRunner,
} from './program-ownership'

import {
  programs,
} from './schema'
import {
  patchErrorFromZod,
} from './program-patches-shared'

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
