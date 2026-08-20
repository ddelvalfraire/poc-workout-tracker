import type { DerivedSet } from '@/lib/progression'
import type { Technique } from '@/lib/program-input'

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

/** Where a row sits inside its technique group. Absent on ordinary sets. */
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
export function expandTechniqueStages(sets: readonly DerivedSet[]): StagedSet[] {
  const rows: StagedSet[] = []
  for (const set of sets) {
    const technique = set.technique
    if (!technique || technique.stages.length === 0) {
      rows.push(set)
      continue
    }
    const group = `t${set.sourceIndex}`
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
        loadKg: stage.loadKg ?? null,
        repMin: stage.reps ?? null,
        repMax: stage.reps ?? null,
        restSec: last ? set.restSec : intraRestSec(technique, i + 1),
        techniqueStage: { group, kind, index: i + 1 },
      })
    })
  }
  return rows.map((row, i) => ({ ...row, setNumber: i + 1 }))
}

/** The pause AFTER stage `index`, seconds: what the stage authored, else 0
 *  (minimal rest IS the technique — a 2-minute gap makes it a straight set). */
function intraRestSec(technique: Technique, index: number): number {
  return technique.stages[index]?.restSec ?? 0
}
