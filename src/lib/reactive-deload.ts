import type { AutoregAdjustment } from './autoregulate'
import type { DeloadShape, DietPhase } from './program-input'
import type { ProposalPatch } from './patch-proposal'
import type { ExerciseSource } from './custom-exercise-input'
import { kgToDisplay, type WeightUnit } from './units'

/**
 * Pure logic for REACTIVE DELOAD proposals — the piece deloadPolicy mode
 * 'reactive' deferred at #176. When M4 fires (a three-stall streak) for an
 * exercise on a reactive program — or a CUTTING program holds an H2
 * auto-backoff (Part A) — the derive-time trigger (db/reactive-deload.ts)
 * raises ONE batch-patch proposal per exercise offering the back-off as the
 * owner's explicit confirm. Decline = normal silence = hold. Never
 * auto-applied; dedup is the pending-source partial unique index
 * (schema.ts), keyed here by the composite exercise identity.
 *
 * The proposal's patches are set_program_set_override ops for the NEXT
 * untrained week: the resolved deload shape's loadFactor (and rpeCap) applied
 * to the exercise's derived working sets. `setFactor` is deliberately NOT
 * expressed — per-week overrides can pin targets but cannot drop sets, and
 * the summary never claims what the patches don't do (honest copy).
 */

/** The structured provenance stamp — with the subject, the dedup key the
 *  partial unique index enforces (one pending proposal per program per
 *  exercise identity). */
export const REACTIVE_DELOAD_SOURCE = 'reactive-deload'

/** The provenance slice of a pending proposal row the dedup check reads
 *  (same shape volume-progression uses). */
export interface PendingProposalRef {
  source: string | null
  muscleGroup: string | null
}

/** The dedup subject: the composite exercise identity, reusing the
 *  muscle_group column as the generic "subject" discriminator it already is
 *  for machine proposals — no new column, and the identity is stable across
 *  renames/repositions (unlike a positional address). */
export function reactiveDeloadSubject(source: ExerciseSource, wgerExerciseId: number): string {
  return `${source}:${wgerExerciseId}`
}

/** Whether a pending reactive-deload proposal for this exercise already
 *  exists — one open question per lift at a time, regardless of week. (The
 *  partial unique index enforces the same rule at the database; this check
 *  keeps the common path quiet.) */
export function hasPendingReactiveDeloadProposal(
  pending: readonly PendingProposalRef[],
  subject: string,
): boolean {
  return pending.some((p) => p.source === REACTIVE_DELOAD_SOURCE && p.muscleGroup === subject)
}

/** The deload shape a reactive proposal applies when the program stored no
 *  scheduled shape: the historical engine factors — the same defaults
 *  resolveDeloadPolicy materializes. */
export const REACTIVE_DEFAULT_SHAPE: DeloadShape = {
  loadFactor: 0.85,
  setFactor: 0.5,
  rpeCap: null,
}

/**
 * Whether a derived verdict should raise a reactive-deload proposal, and
 * which flavor. Mode 'none' is silence for BOTH flavors — opting out of
 * deloads means no backoff offers of any kind (owner's call, 2026-08-10;
 * the engine still HOLDS the cutting backoff, it just never asks about it).
 * 'cutting-hold': the phase gate held an H2 auto-backoff — the proposal
 * offers THAT backoff, with hold as the default (Part A phrasing).
 * 'reactive': the policy is mode 'reactive' and M4 fired — the proposal
 * offers the program's deload shape (Part B). Null = silence (a 'scheduled'
 * program's non-cutting stalls keep their planned deload week).
 */
export function reactiveDeloadKind(
  adjustment: AutoregAdjustment | null,
  policyMode: 'none' | 'reactive' | 'scheduled',
  phase: DietPhase | null,
): 'cutting-hold' | 'reactive' | null {
  if (!adjustment?.suggestEarlyDeload) return null
  if (policyMode === 'none') return null
  if (phase === 'cutting' && adjustment.heldBackoffKg !== undefined) return 'cutting-hold'
  if (policyMode === 'reactive') return 'reactive'
  return null
}

/** One eligible exercise, addressed for the override ops. */
export interface ReactiveDeloadCandidate {
  name: string
  /** 0-based patch address (first occurrence when a day repeats the lift). */
  dayPosition: number
  exercisePosition: number
  /** The NEXT untrained week the overrides pin. */
  week: number
  /** The derived working rows of that week (post-autoreg, pre-proposal). */
  workingSets: { setNumber: number; loadKg: number | null }[]
  adjustment: AutoregAdjustment
}

/** Two-decimal kg — enough to keep lb round-trips readable without inventing
 *  precision the plates don't have. */
const round2 = (kg: number) => Math.round(kg * 100) / 100

/**
 * The proposal content for one eligible exercise: set_program_set_override
 * patches (kg-canonical — the stored-proposal contract) for every loaded
 * working set of the target week, plus the one-line summary the approval
 * card leads with. 'reactive' applies the shape's loadFactor (+ rpeCap when
 * set); 'cutting-hold' applies the HELD backoff fraction — exactly what the
 * engine would have cut — phrased hold-first (declining holds; that IS the
 * recommendation). Null when nothing is patchable (no loaded working sets —
 * a proposal must carry at least one patch).
 */
export function reactiveDeloadProposalContent(
  candidate: ReactiveDeloadCandidate,
  kind: 'cutting-hold' | 'reactive',
  shape: DeloadShape,
  unit: WeightUnit,
): { summary: string; patches: ProposalPatch[] } | null {
  const { adjustment } = candidate
  const heldBackoffKg = adjustment.heldBackoffKg ?? 0
  const evidenceLoadKg = adjustment.evidence.loadKg
  const factor =
    kind === 'cutting-hold' && evidenceLoadKg > 0
      ? (evidenceLoadKg - heldBackoffKg) / evidenceLoadKg
      : shape.loadFactor
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
              suggestedLoad: round2(set.loadKg * factor),
              unit: 'kg' as const,
              ...(kind === 'reactive' && shape.rpeCap !== null ? { rpe: shape.rpeCap } : {}),
            },
          },
        ],
  )
  if (patches.length === 0) return null
  const load = `${kgToDisplay(evidenceLoadKg, unit)} ${unit}`
  const summary =
    kind === 'cutting-hold'
      ? `${candidate.name} stalled 3× at ${load} while cutting — hold rather than back off? Holding is the win; confirm only to back off week ${candidate.week} (~${Math.round(factor * 100)}% load). Declining holds.`
      : `${candidate.name} stalled 3 sessions — deload next week (week ${candidate.week})? ${Math.round(shape.loadFactor * 100)}% load${
          shape.rpeCap !== null ? `, RPE cap ${shape.rpeCap}` : ''
        }.`
  return { summary, patches }
}
