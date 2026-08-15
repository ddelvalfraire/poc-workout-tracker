'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth'
import {
  parseProgramInput,
  statusSchema,
  visibilitySchema,
  dietPhaseSchema,
  MAX_DESCRIPTION,
  type ProgramVisibility,
} from '@/lib/program-input'
import {
  saveProgram,
  updateProgram,
  deleteProgram,
  setProgramStatus,
  updateProgramDescription,
  cloneProgram,
  instantiateProgramDay,
  adoptProgram,
  declineProgram,
} from '@/db/programs'
import { setProgramVisibility, createShare, revokeShare } from '@/db/program-shares'
import {
  setTrainingMax,
  setProgramDietPhase,
  setProgramOvershootPolicy,
} from '@/db/program-patches'
import { overshootPolicySchema } from '@/lib/overshoot-policy'
import { confirmPatchProposal, declinePatchProposal } from '@/db/patch-proposals'
import { restartTmPlan } from '@/db/restart-plan'
import { getWeightUnit } from '@/db/preferences'
import { kgToDisplay } from '@/lib/units'
import type { TmIncrement } from '@/lib/tm-restart'
import { proposedTrainingMaxKg } from './[id]/detail-view'
import type { RestartPreview } from './[id]/restart-view'

/**
 * Validates and persists a new program for the signed-in user, returning its id.
 *
 * Validation runs here on the server — independent of any client-side checks —
 * so malformed input is rejected even if the browser sends it directly. A throw
 * (auth redirect, validation failure, or DB error) surfaces to the caller as a
 * rejected action; the client component is expected to `try/catch` it.
 */
export async function saveProgramAction(input: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = parseProgramInput(input)
  const result = await saveProgram(userId, parsed, 'ui')
  revalidatePath('/programs')
  return result
}

/**
 * Validates and applies a full-replace edit to an owned program, returning its
 * id. A missing result means the program isn't owned (or was concurrently
 * deleted); we throw so the client's try/catch surfaces an inline error.
 *
 * `updateProgram` deletes and re-inserts the whole day/exercise/set tree, so the
 * builder's draft must round-trip EVERYTHING (progression/technique JSONB
 * included — `detailToProgramDraft`/`draftToProgramInput` carry them through).
 * Per-week set OVERRIDES are preserved by `updateProgram` itself (re-keyed to
 * the recreated rows at the same day/exercise/setNumber address); overrides on
 * slots the edit removed die with them.
 */
export async function updateProgramAction(id: string, input: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = parseProgramInput(input)
  const result = await updateProgram(userId, id, parsed, 'ui')
  if (!result) throw new Error('program not found')
  revalidatePath('/programs')
  revalidatePath(`/programs/${id}`)
  return result
}

/**
 * Deletes an owned program (children cascade). Returns void — the client
 * navigates to the list after; we must NOT redirect() here, as the client wraps
 * the call in try/catch and would mistake NEXT_REDIRECT for a failure.
 *
 * A missing result means the program isn't owned (or was already deleted); we
 * throw so the client surfaces an error rather than navigating away as if it
 * had worked — mirroring deleteWorkoutAction's ownership handling.
 */
/**
 * Updates the program article's description (the FullEditor save path —
 * markdown string, blank clears to null). Narrow on purpose: the builder's
 * full-replace update would race a quick description edit against unsaved
 * structural state. Not-owned/proposed throws for the client's try/catch.
 */
export async function updateProgramDescriptionAction(
  id: unknown,
  description: unknown,
): Promise<void> {
  const userId = await requireUserId()
  if (typeof id !== 'string' || id.length === 0) throw new Error('invalid program id')
  if (typeof description !== 'string' && description !== null) {
    throw new Error('invalid description')
  }
  const trimmed = typeof description === 'string' ? description.trim() : null
  if (trimmed !== null && trimmed.length > MAX_DESCRIPTION) {
    throw new Error('Description is too long.')
  }
  const result = await updateProgramDescription(userId, id, trimmed === '' ? null : trimmed)
  if (!result) throw new Error('program not found')
  revalidatePath(`/programs/${id}`)
}

export async function deleteProgramAction(id: string): Promise<void> {
  const userId = await requireUserId()
  const [deleted] = await deleteProgram(userId, id)
  if (!deleted) throw new Error('program not found')
  revalidatePath('/programs')
}

/**
 * Updates only a program's lifecycle status (draft/active/archived), validated
 * here against the same enum the schema uses. A null result means the program
 * isn't owned; we throw for the client's try/catch.
 */
export async function setProgramStatusAction(id: string, status: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = statusSchema.parse(status)
  const result = await setProgramStatus(userId, id, parsed, 'ui')
  if (!result) throw new Error('program not found')
  revalidatePath('/programs')
  revalidatePath(`/programs/${id}`)
  return result
}

/**
 * The owner's explicit confirm on a coach-drafted proposal ("we always force
 * the user to confirm"): promotes a 'proposed' program to 'draft', or straight
 * to 'active' (running the single-active sweep) when `activate` is true. The
 * db layer is the guard — this is the ONLY path off 'proposed'. A null result
 * means not owned or not a proposal; throw for the client's try/catch.
 */
/**
 * Sets (or clears, with null) the program's diet phase from an owner surface
 * (the staleness card's "Still cutting" / "End cut"). Every explicit write —
 * including re-affirming the same phase — stamps diet_phase_set_at, which is
 * exactly what "Still cutting" needs: the affirmation resets the staleness
 * clock. Same event-logged op the MCP tool and batch proposals apply through.
 */
export async function setDietPhaseAction(id: string, phase: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = dietPhaseSchema.nullable().parse(phase)
  const result = await setProgramDietPhase(userId, id, parsed, 'ui')
  if (!result) throw new Error('program not found')
  revalidatePath(`/programs/${id}`)
  return result
}

/**
 * Sets (or clears, with null) the program's overshoot / goal-met policy from
 * the owner's settings control (#227). Same event-logged narrow op the MCP
 * tool applies through; null restores the per-scheme defaults.
 */
export async function setOvershootPolicyAction(
  id: string,
  policy: unknown,
): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = overshootPolicySchema.nullable().parse(policy)
  const result = await setProgramOvershootPolicy(userId, id, parsed, 'ui')
  if (!result) throw new Error('program not found')
  revalidatePath(`/programs/${id}`)
  return result
}

export async function adoptProgramAction(
  id: unknown,
  activate: unknown,
): Promise<{ id: string }> {
  const userId = await requireUserId()
  if (typeof id !== 'string' || id.length === 0) throw new Error('invalid program id')
  if (typeof activate !== 'boolean') throw new Error('invalid activate flag')
  const result = await adoptProgram(userId, id, activate)
  if (!result) throw new Error('proposal not found')
  revalidatePath('/') // activating repoints the home hero
  revalidatePath('/programs')
  revalidatePath(`/programs/${id}`)
  return result
}

/**
 * The owner's explicit reject: hard-deletes a 'proposed' program (children
 * cascade). Returns void — the client navigates to the list after; no
 * redirect() here (the client's try/catch would mistake NEXT_REDIRECT for a
 * failure, same as deleteProgramAction).
 */
export async function declineProgramAction(id: unknown): Promise<void> {
  const userId = await requireUserId()
  if (typeof id !== 'string' || id.length === 0) throw new Error('invalid program id')
  const result = await declineProgram(userId, id)
  if (!result) throw new Error('proposal not found')
  revalidatePath('/programs')
}

/**
 * The owner's single combined confirm on a batch-patch proposal: every stored
 * patch is applied atomically through the event-logged patch functions (the db
 * layer re-validates and rolls the lot back on any mismatch — apply ALL or
 * apply NOTHING). A null result means not owned / not pending; a
 * PatchProposalError (program drifted) surfaces its owner-safe message to the
 * client's try/catch.
 */
export async function confirmPatchProposalAction(id: unknown): Promise<{ applied: number }> {
  const userId = await requireUserId()
  if (typeof id !== 'string' || id.length === 0) throw new Error('invalid proposal id')
  const result = await confirmPatchProposal(userId, id)
  if (!result) throw new Error('proposal not found')
  revalidatePath('/programs')
  revalidatePath(`/programs/${result.programId}`)
  return { applied: result.applied }
}

/**
 * The owner's reject on a batch-patch proposal: hard-deletes the pending row
 * (decline discards; the decline event stays in the change log). Returns void —
 * the card refreshes in place; no redirect() (same try/catch rationale as
 * declineProgramAction).
 */
export async function declinePatchProposalAction(id: unknown): Promise<void> {
  const userId = await requireUserId()
  if (typeof id !== 'string' || id.length === 0) throw new Error('invalid proposal id')
  const result = await declinePatchProposal(userId, id)
  if (!result) throw new Error('proposal not found')
  revalidatePath('/programs')
  revalidatePath(`/programs/${result.programId}`)
}

/**
 * Rolls a block over: clone the program (full row fidelity, week-1 fresh) and
 * activate the clone — setProgramStatus's single-active sweep archives an
 * active source automatically; an already-archived source stays archived.
 * The clone commits BEFORE activation, so a failed activate leaves only a
 * harmless draft copy (retry-safe, deletable). Returns the NEW program id —
 * the client navigates to it; no redirect() here, as the client's try/catch
 * would mistake NEXT_REDIRECT for a failure.
 */
export async function restartProgramAction(id: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('invalid program id')
  }
  // Block-restart TM carry-forward (plan §5): clean amrap-cycle lifts step up
  // one increment inside the clone transaction; M4-flagged lifts are skipped
  // (the confirm dialog suggested a reset instead — restartPreviewAction). A
  // failed plan derivation must not block the restart itself: proceed with a
  // plain copy rather than stranding the user (silence over corruption).
  let tmIncrements: TmIncrement[] = []
  try {
    tmIncrements = (await restartTmPlan(userId, id))?.increments ?? []
  } catch {
    tmIncrements = []
  }
  const clone = await cloneProgram(userId, id, 'ui', { tmIncrements })
  if (!clone) throw new Error('program not found')
  const activated = await setProgramStatus(userId, clone.id, 'active', 'ui')
  if (!activated) throw new Error('could not activate the new block')
  revalidatePath('/') // the home hero now points at the clone
  revalidatePath('/programs')
  revalidatePath(`/programs/${id}`)
  return { id: clone.id }
}

/**
 * The restart confirm step's TM preview: which lifts step up for the new
 * block and which M4-flagged lifts will be SKIPPED (with the reset the page's
 * M4 idiom would suggest), in the user's display unit. Purely informational —
 * restartProgramAction recomputes the plan server-side at confirm, so the
 * client is never trusted with it. Throws on not-owned; the dialog treats any
 * failure as "no preview" and keeps its base copy.
 */
export async function restartPreviewAction(id: unknown): Promise<RestartPreview> {
  const userId = await requireUserId()
  if (typeof id !== 'string' || id.length === 0) throw new Error('invalid program id')
  const plan = await restartTmPlan(userId, id)
  if (!plan) throw new Error('program not found')
  const unit = await getWeightUnit(userId)
  return {
    unit,
    incrementCount: plan.increments.length,
    flagged: plan.flags.map((flag) => {
      const proposedKg = proposedTrainingMaxKg(flag.currentTmKg)
      return {
        exerciseName: flag.exerciseName,
        proposedTm: proposedKg === null ? null : kgToDisplay(proposedKg, unit),
      }
    }),
  }
}

/**
 * Instantiates a program day into a new workout with engine-derived targets.
 * `week` stamps the workout's provenance explicitly — the program page passes
 * its selected week so any week's day is startable (a skipped day no longer
 * pins the block); omitting it auto-derives from the program's own history
 * (the home hero's path). Returns the new workout id — the client navigates
 * to it; no redirect() here for the same try/catch reason as above. Null
 * means the day isn't found or its program isn't owned.
 */
export async function startProgramDayAction(
  programDayId: unknown,
  week?: unknown,
): Promise<{ workoutId: string; week: number }> {
  const userId = await requireUserId()
  if (typeof programDayId !== 'string' || programDayId.length === 0) {
    throw new Error('invalid program day id')
  }
  if (week !== undefined && (typeof week !== 'number' || !Number.isInteger(week) || week < 1)) {
    throw new Error('invalid week')
  }
  const result = await instantiateProgramDay(userId, programDayId, week ?? null, 'ui')
  if (!result) throw new Error('program day not found')
  revalidatePath('/') // the new workout appears in the home history list
  return { workoutId: result.id, week: result.week }
}

/**
 * The owner's explicit confirm on an M4 "TM likely set too high" flag: writes
 * the proposed reduced training max through the single sanctioned setter
 * (reason 'reset' — visible in the change log). Never called automatically;
 * the program page renders the proposal and only this click applies it. The
 * db layer re-validates scheme and ownership; a null result (not owned/found)
 * and a ProgramPatchError (wrong scheme) both surface to the client's
 * try/catch.
 */
export async function adjustTrainingMaxAction(
  id: unknown,
  dayPosition: unknown,
  exercisePosition: unknown,
  trainingMaxKg: unknown,
): Promise<{ trainingMaxKg: number }> {
  const userId = await requireUserId()
  if (typeof id !== 'string' || id.length === 0) throw new Error('invalid program id')
  if (typeof dayPosition !== 'number' || !Number.isInteger(dayPosition) || dayPosition < 0) {
    throw new Error('invalid day position')
  }
  if (
    typeof exercisePosition !== 'number' ||
    !Number.isInteger(exercisePosition) ||
    exercisePosition < 0
  ) {
    throw new Error('invalid exercise position')
  }
  if (typeof trainingMaxKg !== 'number' || !Number.isFinite(trainingMaxKg) || trainingMaxKg < 0) {
    throw new Error('invalid training max')
  }
  const result = await setTrainingMax(
    userId,
    id,
    dayPosition,
    exercisePosition,
    trainingMaxKg,
    'reset',
    'ui',
  )
  if (!result) throw new Error('exercise not found')
  revalidatePath(`/programs/${id}`)
  return { trainingMaxKg: result.trainingMaxKg }
}

/**
 * Flips a program's sharing visibility, minting a share link lazily on the
 * first switch away from 'private' (createShare is idempotent for a live
 * link, so re-selecting Shared/Public reuses the token — a NEW token comes
 * only from the explicit revoke-and-rotate below). Switching to 'private'
 * leaves share rows in place: visibility itself gates resolution, and the
 * same link resumes if the owner flips back. The db layer (via authz's
 * `can`) refuses proposals and non-owners; throws surface to the client's
 * try/catch.
 */
export async function setProgramVisibilityAction(
  id: unknown,
  visibility: unknown,
): Promise<{ visibility: ProgramVisibility; token: string | null }> {
  const userId = await requireUserId()
  if (typeof id !== 'string' || id.length === 0) throw new Error('invalid program id')
  const parsed = visibilitySchema.parse(visibility)
  const result = await setProgramVisibility(userId, id, parsed)
  if (!result) throw new Error('program not found')
  let token: string | null = null
  if (parsed !== 'private') {
    const share = await createShare(userId, id)
    if (!share) throw new Error('program not found')
    token = share.token
  }
  revalidatePath(`/programs/${id}`)
  return { visibility: parsed, token }
}

/**
 * Revoke-and-rotate: kills every live link (revokedAt — old URLs 404
 * immediately) and mints a fresh token in its place. Only offered by the UI
 * when visibility is already link|public, so createShare's private-refusal
 * is unreachable here in practice; if raced, the throw surfaces like any
 * other action failure.
 */
export async function rotateProgramShareAction(id: unknown): Promise<{ token: string }> {
  const userId = await requireUserId()
  if (typeof id !== 'string' || id.length === 0) throw new Error('invalid program id')
  const revoked = await revokeShare(userId, id)
  if (!revoked) throw new Error('program not found')
  const share = await createShare(userId, id)
  if (!share) throw new Error('program not found')
  revalidatePath(`/programs/${id}`)
  return { token: share.token }
}
