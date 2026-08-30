import type { DerivedSet } from '@/lib/progression'
import type { Technique } from '@/lib/program-input'
import { quantizeLoadKg } from '@/lib/workout/load-quantize'
import type { WeightUnit } from '@/lib/units'

/**
 * Intensity techniques (drop-set / rest-pause / myo-reps / cluster) as a fact
 * the app RUNS, not just stores. Pure and IO-free so both consumers — the
 * instantiation that seeds the workout rows and the plan overlay that feeds
 * the logger's ghosts — expand a prescription through the SAME function and
 * can never disagree about how many rows a technique set becomes.
 *
 * The model (docs/TECHNIQUE-LOGGING.md, "Model A"): a technique set
 * instantiates as N `sets` ROWS grouped by `technique_group` + `stage_index`,
 * never as nested JSON on one row. Every existing consumer (e1RM, best-set,
 * plan-sync, the autoreg stall rules, the effort gate) reads rows and keeps
 * working untouched; only weekly volume learns the grouping, because only
 * volume asks "how many hard sets was that?".
 *
 * Stage semantics, fixed here once: the planned set IS stage 0 (the top set /
 * activation set), and `technique.stages[]` are the ADDITIONAL stages after
 * it — one drop, one mini-set, one cluster block each. So a 2-stage drop-set
 * prescription is 3 rows. A stage's `restSec` is the INTRA-set pause taken
 * AFTER that stage (program_sets.restSec stays the between-set rest and rides
 * the LAST row, where the set truly ends); unauthored intra-set rest is 0 —
 * minimal rest is what makes these techniques what they are.
 */

export const TECHNIQUE_KINDS = ['drop-set', 'rest-pause', 'myo-reps', 'cluster'] as const
export type TechniqueKind = Technique['kind']

/** Narrows untrusted input (action payloads, DB text) to a TechniqueKind. */
export function isTechniqueKind(value: unknown): value is TechniqueKind {
  return (TECHNIQUE_KINDS as readonly unknown[]).includes(value)
}

/** Translation-key segment per kind — the enum value is not a message key
 *  (kebab case, and keys never carry punctuation). Shared so the plan page and
 *  the logger name the same technique the same way. */
export const TECHNIQUE_LABEL_KEY = {
  'drop-set': 'dropSet',
  'rest-pause': 'restPause',
  'myo-reps': 'myoReps',
  cluster: 'cluster',
} as const satisfies Record<TechniqueKind, string>

/**
 * A LOGGED row's place in a technique group (the `sets` columns, the wire
 * field, and the draft field all speak this shape). `group` is equal across
 * the rows of ONE technique set and unique within the exercise; `stageIndex`
 * is 0-based (0 = the top / activation set).
 */
export interface SetTechnique {
  kind: TechniqueKind
  group: string
  stageIndex: number
}

/**
 * True when `next` continues `current`'s technique group — the rows are one
 * set, not two. The logger's rest rule (Hevy's, and the reason the technique
 * works): no rest period starts between stages unless the plan prescribed an
 * intra-set pause, because zero rest IS the stimulus.
 */
export function continuesTechniqueGroup(
  current: SetTechnique | undefined,
  next: SetTechnique | undefined,
): boolean {
  return current !== undefined && next !== undefined && current.group === next.group
}

/**
 * Whether checking off this set should start a rest period at all.
 * `planRestSec` is the prescription for THIS position (null = unprescribed):
 * a rest-pause's authored 20 s pause still counts down, but a drop set's
 * zero — and an ad-hoc group with no plan at all — starts no clock.
 */
export function startsRestPeriod(
  current: SetTechnique | undefined,
  next: SetTechnique | undefined,
  planRestSec: number | null,
): boolean {
  if (!continuesTechniqueGroup(current, next)) return true
  return planRestSec !== null && planRestSec > 0
}

/** Where a DERIVED row sits inside its technique group. Absent on ordinary sets. */
export interface TechniqueStage {
  /** Group key — equal across the rows of ONE technique set, unique within
   *  the exercise. Derived from the source set (never random) so a second
   *  derivation of the same week produces identical grouping. */
  group: string
  kind: TechniqueKind
  /** 0-based: 0 is the top/activation set, 1..n the drops or mini-sets. */
  index: number
}

/** A derived set that may carry its place in a technique group. */
export type StagedSet = DerivedSet & { techniqueStage?: TechniqueStage }

/**
 * Expands each technique-carrying set into its stage rows and renumbers the
 * whole list 1-based contiguous (the `sets` unique constraint's contract).
 * Sets without a technique pass through byte-identical apart from
 * `setNumber`, so a technique-free program derives exactly as before.
 *
 * Each stage row inherits the top set's chassis (setType, metricMode, effort
 * targets, tempo, sourceIndex — so per-week override matching still lands)
 * and overrides only what the stage authored: its load and its reps. An
 * unauthored stage load is null — a drop set's later loads are usually
 * captured at the rack, not planned, and a null there means "the lifter types
 * it", never a phantom prescription.
 */
export function expandTechniqueStages(
  sets: readonly DerivedSet[],
  unit: WeightUnit,
): StagedSet[] {
  const rows: StagedSet[] = []
  // Keyed by the group's ORDER of appearance, never by sourceIndex: a
  // weekly-volume resize CLONES its last working set (progression.ts
  // `resizeWorkingSets`), and clones inherit both the technique and the
  // source index — so a sourceIndex key would fuse two adjacent drop sets
  // into one group with two stage 0s, which mis-weights volume and makes the
  // session unsaveable (the wire refuses a non-contiguous group). Position is
  // deterministic, so re-deriving the same week still yields the same keys.
  let groupCount = 0
  for (const set of sets) {
    const technique = set.technique
    if (!technique || technique.stages.length === 0) {
      rows.push(set)
      continue
    }
    const group = `t${groupCount++}`
    const kind = technique.kind
    // The top set's own rest becomes the pause before stage 1; the between-set
    // rest moves to the LAST stage, where the technique set actually ends.
    rows.push({
      ...set,
      restSec: intraRestSec(technique, 0),
      techniqueStage: { group, kind, index: 0 },
    })
    technique.stages.forEach((stage, i) => {
      const last = i === technique.stages.length - 1
      rows.push({
        ...set,
        loadKg: stageLoadKg(stage, set, unit),
        repMin: stage.reps ?? null,
        repMax: stage.reps ?? null,
        restSec: last ? set.restSec : intraRestSec(technique, i + 1),
        techniqueStage: { group, kind, index: i + 1 },
      })
    })
  }
  return rows.map((row, i) => ({ ...row, setNumber: i + 1 }))
}

/**
 * One stage's prescribed load, from the three states a stage may be in.
 *
 * - `loadKg` — absolute, taken verbatim. Right when the number IS the point
 *   (a fixed dumbbell, a machine's pin).
 * - `loadPct` — relative to the top set's DERIVED load, so the drop keeps its
 *   shape as the top set progresses. Quantized to the loadable grid (#226) for
 *   the same reason every other derived load is: the lifter has to be able to
 *   load it. Resolves to null when the top set has no load — a percentage of
 *   nothing is nothing, and inventing a number here would be the phantom
 *   prescription an absent stage load exists to avoid.
 * - neither — null: the lifter types what they actually dropped to. NEVER
 *   inherited from the top set.
 *
 * The schema refuses a stage carrying both, so this is a total function over
 * what can actually be stored. See docs/specs/technique-authoring.md §03.
 */
function stageLoadKg(
  stage: Technique['stages'][number],
  top: Pick<DerivedSet, 'loadKg' | 'metricMode'>,
  unit: WeightUnit,
): number | null {
  if (stage.loadKg != null) return stage.loadKg
  if (stage.loadPct == null) return null
  // Metric-mode guard, stated rather than inferred. A timed row derives with a
  // null load today, so trusting that would work — but `applyOverride` makes
  // exactly this check for exactly this reason ("a stray/legacy per-week
  // suggestedLoadKg must not resurrect a load onto a duration set"), and a
  // percentage is the same hazard from a different direction. Duration is never
  // multiplied by a load factor.
  if (top.metricMode !== 'reps_weight') return null
  if (top.loadKg == null) return null
  return quantizeLoadKg(top.loadKg * stage.loadPct, unit)
}

/** The pause AFTER stage `index`, seconds: what the stage authored, else 0
 *  (minimal rest IS the technique — a 2-minute gap makes it a straight set). */
function intraRestSec(technique: Technique, index: number): number {
  return technique.stages[index]?.restSec ?? 0
}

/**
 * How much of a HARD SET one technique row is worth to weekly volume — the
 * one number Model A owes the rest of the app, and the only place the
 * grouping is not purely cosmetic.
 *
 * Why not simply 1.0 per row: volume landmarks (MEV/MAV/MRV) count hard sets
 * as a proxy for stimulus AND recoverable fatigue. Counting a 3-stage
 * rest-pause as 3 straight sets would fire an MRV warning at a third of the
 * real dose; counting it as 1 would under-credit work that is demonstrably
 * more than one set.
 *
 * The rule — top stage 1.0, each later stage 0.5 — reproduces what the
 * literature and coaching practice already estimate for these techniques:
 * a rest-pause set is commonly counted as ≈2 straight sets (and DC training,
 * which is rest-pause throughout, is programmed as though it were), a
 * myo-rep set (activation + 3–5 mini-sets) as ≈3, and a drop set as ≈2–3.
 *
 * Clusters are the deliberate exception: their mini-sets are submaximal with
 * real intra-set rest — the technique exists to keep reps AWAY from failure —
 * and the literature counts a cluster as ONE set by definition. So a cluster
 * group is worth exactly 1.0 however many blocks it is broken into.
 *
 * Sources: Hevy, "Workout Set Types"; the standard hard-set convention
 * (a set counts when taken within ~5 reps of failure); the cluster-set
 * literature's own framing ("you still count that as one cluster set").
 */
export function stageVolumeWeight(technique: SetTechnique | undefined): number {
  if (technique === undefined) return 1
  if (technique.stageIndex === 0) return 1
  return technique.kind === 'cluster' ? 0 : 0.5
}

/**
 * The same rule applied to a PLANNED set, whose stages are still nested
 * (program_sets.technique) rather than expanded into rows — so planned and
 * performed volume stay apples-to-apples, the invariant db/planned-volume.ts
 * exists to protect.
 */
export function plannedTechniqueWeight(technique: Technique | null | undefined): number {
  if (!technique || technique.stages.length === 0) return 1
  if (technique.kind === 'cluster') return 1
  return 1 + 0.5 * technique.stages.length
}
