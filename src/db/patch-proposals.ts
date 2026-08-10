import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './index'
import { programs, programPatchProposals } from './schema'
import { recordProgramEvent, type ProgramEventActor } from './program-events'
import { PatchProposalError } from './program-errors'
import {
  addProgramSet,
  updateProgramSet,
  removeProgramSet,
  setProgramSetOverride,
  removeProgramSetOverride,
  setTrainingMax,
  withTx,
  type PatchRunner,
  type ProgramSetPatch,
  type ProgramSetOverridePatch,
} from './program-patches'
import {
  proposalPatchesSchema,
  MAX_PROPOSAL_SUMMARY,
  type ProposalPatch,
} from '@/lib/patch-proposal'

/**
 * Batch-patch proposals (proposals plan §3): ONE `program_patch_proposals`
 * row per proposal, holding a validated jsonb array of existing patch-op
 * payloads plus a one-line summary. The row is INERT — nothing in the derive/
 * instantiate path reads it — until the owner's single combined confirm
 * applies every patch atomically through the event-logged functions in
 * program-patches.ts (each patch event carries the PROPOSAL's actor, so the
 * change log says who really authored the change), or decline discards it.
 *
 * Failure channels mirror program-patches.ts: `null` = not owned / not found /
 * not pending; `PatchProposalError` = invalid proposal or a confirm the
 * program has drifted out from under — in which case NOTHING is applied (the
 * throw aborts the shared transaction).
 */

/** Parses an unknown patches payload, converting Zod issues into the
 *  caller-safe error channel (mirrors patchErrorFromZod). */
function parsePatches(value: unknown): ProposalPatch[] {
  try {
    return proposalPatchesSchema.parse(value)
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      const first = error.issues[0]
      const path = first?.path.length ? `${first.path.join('.')}: ` : ''
      throw new PatchProposalError(`${path}${first?.message ?? 'invalid patches'}`)
    }
    throw new PatchProposalError('invalid patches')
  }
}

/** The target fields a stored patch may carry (addressing/unit keys are NOT
 *  patch fields — they are consumed by the op call itself). */
const SET_PATCH_KEYS = [
  'setType',
  'metricMode',
  'repMin',
  'repMax',
  'rir',
  'rpe',
  'tempo',
  'durationSec',
  'distanceM',
  'restSec',
  'technique',
] as const

/** The set-target args of a stored patch as the kg-canonical db-layer patch
 *  shape (`suggestedLoad` is already kg — lib/patch-proposal.ts contract). */
function toSetPatch(args: Record<string, unknown>): ProgramSetPatch & ProgramSetOverridePatch {
  const patch: Record<string, unknown> = {}
  for (const key of SET_PATCH_KEYS) {
    if (args[key] !== undefined) patch[key] = args[key]
  }
  if (args.suggestedLoad !== undefined) patch.suggestedLoadKg = args.suggestedLoad
  return patch as ProgramSetPatch & ProgramSetOverridePatch
}

/**
 * Applies one stored patch through its program-patches function on the
 * caller's transaction. Returns the op's own result (null = the address no
 * longer matches the program).
 */
async function applyProposalPatch(
  runIn: PatchRunner,
  userId: string,
  programId: string,
  patch: ProposalPatch,
  actor: ProgramEventActor,
): Promise<unknown | null> {
  const { dayPosition, exercisePosition } = patch.args
  switch (patch.tool) {
    case 'add_program_set':
      return addProgramSet(
        userId,
        programId,
        dayPosition,
        exercisePosition,
        toSetPatch(patch.args),
        actor,
        runIn,
      )
    case 'update_program_set':
      return updateProgramSet(
        userId,
        programId,
        dayPosition,
        exercisePosition,
        patch.args.setNumber,
        toSetPatch(patch.args),
        actor,
        runIn,
      )
    case 'remove_program_set':
      return removeProgramSet(
        userId,
        programId,
        dayPosition,
        exercisePosition,
        patch.args.setNumber,
        actor,
        runIn,
      )
    case 'set_program_set_override':
      return setProgramSetOverride(
        userId,
        programId,
        dayPosition,
        exercisePosition,
        patch.args.setNumber,
        patch.args.week,
        toSetPatch(patch.args),
        actor,
        runIn,
      )
    case 'remove_program_set_override':
      return removeProgramSetOverride(
        userId,
        programId,
        dayPosition,
        exercisePosition,
        patch.args.setNumber,
        patch.args.week,
        actor,
        runIn,
      )
    case 'set_training_max':
      return setTrainingMax(
        userId,
        programId,
        dayPosition,
        exercisePosition,
        patch.args.trainingMax,
        'manual',
        actor,
        { runIn },
      )
  }
}

/** The proposal's stored author as an event actor; anything outside the known
 *  union (open value space) attributes as 'mcp' rather than corrupting the log. */
function actorFromAuthor(authorActor: string): ProgramEventActor {
  return authorActor === 'ui' ||
    authorActor === 'mcp' ||
    authorActor === 'coach' ||
    authorActor === 'wger'
    ? authorActor
    : 'mcp'
}

/**
 * Records a batch-patch proposal against an owned ACTIVE program. Patches are
 * validated here (propose time) AND re-validated at confirm time; the summary
 * is required non-blank. Returns null when the program isn't owned; throws
 * `PatchProposalError` for invalid patches or a non-active program (a draft/
 * archived/proposed program has no live plan to batch-patch — that's what
 * upsert/adopt are for). Logs `propose_program_patches` with the proposing
 * actor in the same transaction, so the change log shows the ask itself.
 */
export async function createPatchProposal(
  userId: string,
  programId: string,
  input: { summary: string; patches: unknown },
  actor: ProgramEventActor,
): Promise<{ id: string } | null> {
  const summary = input.summary.trim()
  if (summary.length === 0 || summary.length > MAX_PROPOSAL_SUMMARY) {
    throw new PatchProposalError(`summary must be 1–${MAX_PROPOSAL_SUMMARY} characters`)
  }
  const patches = parsePatches(input.patches)
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: programs.id, status: programs.status })
      .from(programs)
      .where(and(eq(programs.id, programId), eq(programs.userId, userId)))
      .limit(1)
    if (!owned) return null
    if (owned.status !== 'active') {
      throw new PatchProposalError(
        `batch change proposals target an active program — this one is ${owned.status}`,
      )
    }
    const [row] = await tx
      .insert(programPatchProposals)
      .values({ programId, userId, authorActor: actor, summary, patches })
      .returning({ id: programPatchProposals.id })
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'propose_program_patches',
      summary: `Proposed ${patches.length} change${patches.length === 1 ? '' : 's'}: ${summary}`,
      payload: { proposalId: row.id, patchCount: patches.length },
    })
    return { id: row.id }
  })
}

export interface PatchProposalRow {
  id: string
  programId: string
  authorActor: string
  summary: string
  patches: ProposalPatch[]
  createdAt: Date
}

/**
 * The user's PENDING proposals, oldest first (decision order), optionally
 * scoped to one program. Rows whose stored patches no longer parse are
 * dropped (never rendered, never confirmable) rather than crashing the page —
 * silence over corruption; they stay declinable by id if that ever happens.
 */
export async function listPatchProposals(
  userId: string,
  programId?: string,
): Promise<PatchProposalRow[]> {
  const rows = await db
    .select({
      id: programPatchProposals.id,
      programId: programPatchProposals.programId,
      authorActor: programPatchProposals.authorActor,
      summary: programPatchProposals.summary,
      patches: programPatchProposals.patches,
      createdAt: programPatchProposals.createdAt,
    })
    .from(programPatchProposals)
    .where(
      and(
        eq(programPatchProposals.userId, userId),
        eq(programPatchProposals.status, 'pending'),
        ...(programId !== undefined ? [eq(programPatchProposals.programId, programId)] : []),
      ),
    )
    .orderBy(asc(programPatchProposals.createdAt))
  const valid: PatchProposalRow[] = []
  for (const row of rows) {
    const parsed = proposalPatchesSchema.safeParse(row.patches)
    if (parsed.success) valid.push({ ...row, patches: parsed.data })
  }
  return valid
}

/**
 * The owner's single combined confirm: re-validates the stored patches and
 * applies EVERY one inside ONE transaction through the event-logged
 * program-patches functions — each patch event carries the proposal's stored
 * actor, and one extra `confirm_patch_proposal` event (actor 'ui') records
 * the owner's decision itself. Any patch that no longer matches the program
 * (null result) or fails validation throws, rolling back the lot — apply ALL
 * or apply NOTHING. Requires the program to still be active. Returns null
 * when the proposal isn't owned or isn't pending.
 */
export async function confirmPatchProposal(
  userId: string,
  proposalId: string,
): Promise<{ id: string; programId: string; applied: number } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: programPatchProposals.id,
        programId: programPatchProposals.programId,
        authorActor: programPatchProposals.authorActor,
        patches: programPatchProposals.patches,
        programStatus: programs.status,
      })
      .from(programPatchProposals)
      .innerJoin(programs, eq(programs.id, programPatchProposals.programId))
      .where(
        and(
          eq(programPatchProposals.id, proposalId),
          eq(programPatchProposals.userId, userId),
          eq(programPatchProposals.status, 'pending'),
        ),
      )
      .limit(1)
    if (!row) return null
    if (row.programStatus !== 'active') {
      throw new PatchProposalError(
        'this program is no longer active — the proposed changes were not applied',
      )
    }
    const patches = parsePatches(row.patches)
    const actor = actorFromAuthor(row.authorActor)
    const runIn = withTx(tx)
    for (const [index, patch] of patches.entries()) {
      const applied = await applyProposalPatch(runIn, userId, row.programId, patch, actor)
      if (applied === null) {
        throw new PatchProposalError(
          `change ${index + 1} of ${patches.length} no longer matches the program — nothing was applied`,
        )
      }
    }
    await tx
      .update(programPatchProposals)
      .set({ status: 'applied' })
      .where(eq(programPatchProposals.id, proposalId))
    await recordProgramEvent(tx, {
      programId: row.programId,
      userId,
      actor: 'ui',
      action: 'confirm_patch_proposal',
      summary: `Applied ${patches.length} proposed change${patches.length === 1 ? '' : 's'}`,
      payload: { proposalId, patchCount: patches.length },
    })
    return { id: row.id, programId: row.programId, applied: patches.length }
  })
}

/**
 * The owner's reject: hard-deletes the pending proposal (decline discards —
 * mirroring declineProgram), logging `decline_patch_proposal` (actor 'ui') in
 * the same transaction so the change log keeps the decision. Returns null
 * when the proposal isn't owned or isn't pending.
 */
export async function declinePatchProposal(
  userId: string,
  proposalId: string,
): Promise<{ id: string; programId: string } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: programPatchProposals.id,
        programId: programPatchProposals.programId,
      })
      .from(programPatchProposals)
      .where(
        and(
          eq(programPatchProposals.id, proposalId),
          eq(programPatchProposals.userId, userId),
          eq(programPatchProposals.status, 'pending'),
        ),
      )
      .limit(1)
    if (!row) return null
    await recordProgramEvent(tx, {
      programId: row.programId,
      userId,
      actor: 'ui',
      action: 'decline_patch_proposal',
      summary: 'Proposed changes declined',
      payload: { proposalId },
    })
    await tx.delete(programPatchProposals).where(eq(programPatchProposals.id, proposalId))
    return { id: row.id, programId: row.programId }
  })
}
