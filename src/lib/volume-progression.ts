import { MUSCLE_GROUPS, type MuscleGroup } from './muscle-groups'
import {
  sessionBeatsTop,
  sessionStall,
  type AutoregSession,
  type AutoregStallPolicy,
} from './autoregulate'
import type { ProposalPatch } from './patch-proposal'

/**
 * Volume progression signal (feature-wave plan §4): weekly per-MUSCLE verdicts
 * derived from logged history only — a PROPOSAL layer over the existing
 * schemes, never an 8th scheme and never an auto-mutation. Pure module: the
 * db layer (db/volume-progression.ts) assembles per-movement week evidence
 * from the same prescribed-at-instantiation snapshots the autoreg engine
 * scores, and this module answers "which muscles earned a set, which should
 * hold" with movement names a lifter can audit.
 *
 * v1 signal is performance-only (RPE refinement waits on effort data):
 * - INCREASE: ≥1 movement crediting the muscle as PRIMARY beat its rep-range
 *   top (every scorable working set at/above the top — `sessionBeatsTop`, the
 *   engine's own pairing/quorum discipline) in BOTH of the last two completed
 *   weeks. Two weeks because no methodology chases one good day (M2's
 *   precedent, week-scaled).
 * - HOLD: ≥2 distinct primary movements stalled (`sessionStall` — the same
 *   verdict the autoreg rules act on) in the last completed week. One stalled
 *   movement is that movement's own problem; two is a recovery signal for the
 *   muscle. HOLD outranks INCREASE — safety wins a conflict.
 * - ON-TRACK: trained with scorable evidence, neither of the above.
 * - Silence: no scorable evidence → no verdict at all (the muscle simply
 *   doesn't appear). Missing/ambiguous data is never guessed at.
 *
 * Verdicts count PRIMARY-credit movements only: a fly beating its range says
 * something about chest; a row's secondary-biceps credit beating says almost
 * nothing about biceps volume. The 'Other' honesty bucket is excluded — it is
 * not a coachable muscle. Landmarks (mev/mrv) stay per-program scheme config;
 * this module deliberately knows nothing about volume tables.
 */

export interface SetTemplate {
  repMin: number | null
  repMax: number | null
  restSec: number | null
}

export interface MovementWeekResult {
  /** true = every scorable working set at/above the rep top; false = trained
   *  with evidence but not beaten; null = no verdict (silence). */
  beat: boolean | null
  /** true only on a quorum-met stall verdict. */
  stalled: boolean
}

/** One movement's evidence for the verdict window, assembled by the db layer.
 *  `weeks` carries per-program-week results keyed by programWeek. */
export interface MovementWeekEvidence {
  /** Composite identity key `${source}:${wgerExerciseId}`. */
  key: string
  name: string
  /** Muscle groups this movement credits as PRIMARY (1.0) — the verdict
   *  currency. 'Other' never appears here. */
  primaryGroups: readonly MuscleGroup[]
  /** Per program week: the movement's combined beat/stall result. */
  weeks: ReadonlyMap<number, MovementWeekResult>
  /** Distinct program days the movement appears on — the pick's first key. */
  frequency: number
  /** Total muscle-tag rows (primary + secondary) — the compound proxy
   *  tie-break: more muscles touched reads as more compound. */
  muscleTagCount: number
  /** First occurrence (lowest day, then exercise position) — the
   *  add_program_set patch address. */
  address: { dayPosition: number; exercisePosition: number }
  /** The shape of the movement's last working set, cloned into the proposed
   *  set so the +1 matches its siblings. Null = no working set to clone (the
   *  movement can't be a candidate). */
  setTemplate: SetTemplate | null
  /** weekly-volume scheme owns its own set count at derive time — patching a
   *  literal set row under it would fight the scheme, so it never candidates. */
  schemeOwnsSets: boolean
}

export type MuscleVolumeStatus = 'increase' | 'hold' | 'on-track'

export interface VolumeCandidate {
  key: string
  name: string
  address: { dayPosition: number; exercisePosition: number }
  setTemplate: SetTemplate
}

export interface MuscleVerdict {
  group: MuscleGroup
  status: MuscleVolumeStatus
  /** The movements driving the verdict: beaters for 'increase', stallers for
   *  'hold', empty for 'on-track'. */
  drivers: string[]
  /** The one movement a +1 proposal would patch ('increase' only; null when
   *  every beater is scheme-owned or template-less — chip without proposal). */
  candidate: VolumeCandidate | null
}

/** How many consecutive completed weeks must beat the top before a muscle is
 *  eligible for +1 — the week-scaled M2 discipline. */
export const BEAT_WEEKS_REQUIRED = 2

/** Distinct stalled primary movements that put a muscle on HOLD. */
export const HOLD_STALLED_MOVEMENTS = 2

/**
 * The combined beat/stall result of one movement's session for one week.
 * `repTop` null (no uniform rep-range top on the plan) means beat can never
 * verdict — silence, not false. Stall reuses the autoreg engine's session
 * verdict under the program's stall policy, so "stalled" here can never
 * disagree with what derive acts on.
 */
export function movementWeekResult(
  session: AutoregSession,
  repTop: number | null,
  stallPolicy: AutoregStallPolicy,
): MovementWeekResult {
  return {
    beat: repTop === null ? null : sessionBeatsTop(session, repTop),
    stalled: sessionStall(session, stallPolicy) !== null,
  }
}

/**
 * Folds multiple sessions of the same movement in the same week (a 2×/week
 * frequency slot, a re-trained day) into one result: any stall stalls the
 * week; a beat needs EVERY session with a verdict to beat (a mixed week is
 * not a clear beat); all-null stays null.
 */
export function combineWeekResults(
  results: readonly MovementWeekResult[],
): MovementWeekResult {
  let beat: boolean | null = null
  for (const r of results) {
    if (r.beat === false) beat = false
    else if (r.beat === true && beat === null) beat = true
  }
  return { beat, stalled: results.some((r) => r.stalled) }
}

/** The uniform rep-range top of a movement's plan: every WORKING set carries
 *  the same non-null repMax → that top; mixed tops or no range → null (which
 *  top was beaten is unconfirmable — silence). Mirrors classifyRange's
 *  uniform-top fast path (lib/autoregulate.ts). */
export function uniformRepTop(
  sets: readonly { setType: string; repMax: number | null }[],
): number | null {
  const tops = sets.filter((s) => s.setType === 'working').map((s) => s.repMax)
  if (tops.length === 0 || tops[0] === null) return null
  return tops.every((t) => t === tops[0]) ? tops[0] : null
}

/** The candidate pick among a muscle's beating movements: highest frequency
 *  (the movement you meet most often is the cheapest place to add work), then
 *  most muscle tags (the compound proxy — "propose the compound first"), then
 *  first address. Scheme-owned and template-less movements never candidate. */
export function pickCandidate(
  beaters: readonly MovementWeekEvidence[],
): VolumeCandidate | null {
  const eligible = beaters.filter(
    (m): m is MovementWeekEvidence & { setTemplate: SetTemplate } =>
      !m.schemeOwnsSets && m.setTemplate !== null,
  )
  if (eligible.length === 0) return null
  const best = eligible.reduce((a, b) => {
    if (b.frequency !== a.frequency) return b.frequency > a.frequency ? b : a
    if (b.muscleTagCount !== a.muscleTagCount) return b.muscleTagCount > a.muscleTagCount ? b : a
    if (b.address.dayPosition !== a.address.dayPosition)
      return b.address.dayPosition < a.address.dayPosition ? b : a
    return b.address.exercisePosition < a.address.exercisePosition ? b : a
  })
  return { key: best.key, name: best.name, address: best.address, setTemplate: best.setTemplate }
}

/**
 * The per-muscle verdicts for the last completed week `week` (beat evidence
 * additionally consults `week − 1`). Muscles are emitted in MUSCLE_GROUPS
 * display order; a muscle with no scorable evidence this week is absent
 * entirely — silence over corruption. `week < BEAT_WEEKS_REQUIRED` can still
 * HOLD (one week of stalls is real) but can never INCREASE.
 */
export function muscleVerdicts(
  movements: readonly MovementWeekEvidence[],
  week: number,
): MuscleVerdict[] {
  if (week < 1) return []
  const verdicts: MuscleVerdict[] = []
  for (const group of MUSCLE_GROUPS) {
    const mine = movements.filter((m) => m.primaryGroups.includes(group))
    if (mine.length === 0) continue

    const stallers = mine.filter((m) => m.weeks.get(week)?.stalled === true)
    const beaters = mine.filter((m) => {
      for (let w = week - BEAT_WEEKS_REQUIRED + 1; w <= week; w++) {
        if (w < 1 || m.weeks.get(w)?.beat !== true) return false
      }
      return true
    })
    const hasEvidence = mine.some((m) => {
      const r = m.weeks.get(week)
      return r !== undefined && (r.beat !== null || r.stalled)
    })

    if (stallers.length >= HOLD_STALLED_MOVEMENTS) {
      verdicts.push({
        group,
        status: 'hold',
        drivers: stallers.map((m) => m.name),
        candidate: null,
      })
    } else if (beaters.length > 0) {
      verdicts.push({
        group,
        status: 'increase',
        drivers: beaters.map((m) => m.name),
        candidate: pickCandidate(beaters),
      })
    } else if (hasEvidence) {
      verdicts.push({ group, status: 'on-track', drivers: [], candidate: null })
    }
  }
  return verdicts
}

/** The structured `source` value volume proposals are stamped with — one half
 *  of the dedup key (with the muscle group), backed by the partial unique
 *  index on program_patch_proposals. */
export const VOLUME_PROPOSAL_SOURCE = 'volume-progression'

/** The provenance slice of a pending proposal row the dedup check reads. */
export interface PendingProposalRef {
  source: string | null
  muscleGroup: string | null
}

/** The proposal's one-line summary (display only — dedup is the structured
 *  source/muscleGroup columns, never the text). */
export function volumeProposalSummary(group: MuscleGroup): string {
  return `Add a set to ${group} — beat top of range ${BEAT_WEEKS_REQUIRED} weeks running`
}

/** Whether a pending volume proposal for this muscle already exists — matched
 *  on the structured columns. Any pending +1 for the muscle blocks a new one
 *  regardless of week: one open question per muscle at a time. (The partial
 *  unique index enforces the same rule at the database; this check just makes
 *  the common path quiet.) */
export function hasPendingVolumeProposal(
  pending: readonly PendingProposalRef[],
  group: MuscleGroup,
): boolean {
  return pending.some((p) => p.source === VOLUME_PROPOSAL_SOURCE && p.muscleGroup === group)
}

/** One +1 proposal's content: the summary and its single add_program_set
 *  patch, cloning the candidate's working-set shape (only non-null fields —
 *  the op's defaults cover the rest; no load, so the scheme/ghost derives it). */
export function volumeProposalContent(
  group: MuscleGroup,
  candidate: VolumeCandidate,
): { summary: string; patches: ProposalPatch[] } {
  const { repMin, repMax, restSec } = candidate.setTemplate
  return {
    summary: volumeProposalSummary(group),
    patches: [
      {
        tool: 'add_program_set',
        args: {
          dayPosition: candidate.address.dayPosition,
          exercisePosition: candidate.address.exercisePosition,
          setType: 'working',
          ...(repMin !== null ? { repMin } : {}),
          ...(repMax !== null ? { repMax } : {}),
          ...(restSec !== null ? { restSec } : {}),
        },
      },
    ],
  }
}

/** The verdicts a proposal run should act on: 'increase' with a candidate and
 *  no pending proposal for the muscle. HOLD and on-track produce nothing —
 *  silence is the deliverable there. */
export function proposalsToCreate(
  verdicts: readonly MuscleVerdict[],
  pending: readonly PendingProposalRef[],
): { group: MuscleGroup; candidate: VolumeCandidate }[] {
  return verdicts.flatMap((v) =>
    v.status === 'increase' &&
    v.candidate !== null &&
    !hasPendingVolumeProposal(pending, v.group)
      ? [{ group: v.group, candidate: v.candidate }]
      : [],
  )
}
