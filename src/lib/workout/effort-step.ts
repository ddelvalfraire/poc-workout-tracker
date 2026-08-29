import type { ProposalPatch } from '../programs/patch-proposal'
import type { PendingProposalRef } from '../programs/reactive-deload'
import { kgToDisplay, type WeightUnit } from '../units'

/**
 * EFFORT-STEP proposals (RPE plan slice 4): two consecutive easy sessions
 * (lib/effort-gate.ts sustainedUndershoot) earn an owner-confirmable step
 * UP — the mirror image of the reactive-deload proposal, riding the exact
 * same machinery (batch-patch proposal, pending-source dedup index,
 * program-page confirm). Never auto-applied: the engine's own automatic
 * actions are holds only; anything that raises a load is the owner's yes.
 *
 * +2.5% is the literature's small step (small steps beat big ones —
 * StrongLifts' own microloading finding); plate rounding stays the
 * lifter's/logger's concern, same as reactive-deload's factors.
 */

/** The structured provenance stamp — with the subject, the dedup key the
 *  partial unique index enforces (one pending step ask per lift). */
export const EFFORT_STEP_SOURCE = 'effort-step'

/** The proposed step: +2.5% on the target week's loaded working sets. */
export const EFFORT_STEP_FACTOR = 1.025

/** Whether a pending effort-step proposal for this subject already exists
 *  (same app-level quiet-path check as reactive-deload's). */
export function hasPendingEffortStepProposal(
  pending: readonly PendingProposalRef[],
  subject: string,
): boolean {
  return pending.some((p) => p.source === EFFORT_STEP_SOURCE && p.muscleGroup === subject)
}

export interface EffortStepCandidate {
  name: string
  /** 0-based patch address (first occurrence when a day repeats the lift). */
  dayPosition: number
  exercisePosition: number
  /** The NEXT untrained week the overrides pin. */
  week: number
  /** The derived working rows of that week. */
  workingSets: { setNumber: number; loadKg: number | null }[]
}

/** Two-decimal kg — same display honesty as reactive-deload's rounding. */
const round2 = (kg: number) => Math.round(kg * 100) / 100

/**
 * The proposal content: set_program_set_override patches (kg-canonical)
 * stepping every loaded working set of the target week by the factor, plus
 * the approval card's summary. Null when nothing is patchable.
 */
export function effortStepProposalContent(
  candidate: EffortStepCandidate,
  undershootLoadKg: number,
  unit: WeightUnit,
): { summary: string; patches: ProposalPatch[] } | null {
  const patches: ProposalPatch[] = candidate.workingSets.flatMap((set) =>
    set.loadKg === null
      ? []
      : [
          {
            tool: 'set_program_set_override' as const,
            args: {
              dayPosition: candidate.dayPosition,
              exercisePosition: candidate.exercisePosition,
              setNumber: set.setNumber,
              week: candidate.week,
              suggestedLoad: round2(set.loadKg * EFFORT_STEP_FACTOR),
              unit: 'kg' as const,
            },
          },
        ],
  )
  if (patches.length === 0) return null
  const load = `${kgToDisplay(undershootLoadKg, unit)} ${unit}`
  const summary = `${candidate.name} came in easy two sessions running at ${load} — step week ${candidate.week} up ~2.5%? Declining keeps current loads.`
  return { summary, patches }
}
