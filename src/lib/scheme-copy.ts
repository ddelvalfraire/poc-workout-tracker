import type { Progression } from './program-input'
import { kgToDisplay, type WeightUnit } from './units'
import { LOAD_INCREMENT_KG, LOAD_INCREMENT_LB, quantizeDisplayLoad } from './load-quantize'

/**
 * Plain-English voice for every progression scheme (#228) — ONE module owns
 * the templates so the three consumers can never drift apart:
 *  1. the builder's scheme line (name + one-line subtitle — Liftosaur's
 *     picker pattern),
 *  2. the program detail's muted "how this progresses" sentence with the
 *     exercise's ACTUAL numbers (Stronglifts' conditional-sentence pattern:
 *     "Hit 12 reps on every set at 65 lb → +5 lb next session."),
 *  3. the autoreg/derivation reason lines (`autoregReason` shares the
 *     double-progression hold clause via `repFillHoldReason`).
 * Research takeaway (issue comment): conditional sentences with the lifter's
 * real numbers beat scheme names in every consumer app observed. Every
 * displayed load quantizes (#226) and speaks the user's unit — never raw kg
 * in a lb account, never "undefined".
 */

export type ProgressionScheme = Progression['scheme']

/** Mirrors `AUTOREG_DEFAULT_STEP_KG` (lib/autoregulate.ts): the step a
 *  double-progression fill applies when the config carries no usable
 *  increment. Declared locally so autoregulate.ts can import THIS module for
 *  shared reason clauses without an import cycle. */
const DEFAULT_STEP_KG = 2.5

const NAMES: Record<ProgressionScheme, string> = {
  linear: 'Linear',
  'double-progression': 'Double progression',
  'percent-1rm': 'Percent of 1RM',
  'rpe-target': 'RPE target',
  'weekly-volume': 'Weekly volume',
  'rep-progression': 'Rep progression',
  'amrap-cycle': 'AMRAP cycle',
}

/** The researched one-liners (issue #228 comment) — no numbers needed, the
 *  picker/degradation voice. */
const SUBTITLES: Record<ProgressionScheme, string> = {
  linear: 'Add weight every session you complete all sets.',
  'double-progression':
    'Work up to the top of your rep range, then the weight goes up and reps start over.',
  'percent-1rm':
    'Weights are percentages of your training max, which bumps a small fixed amount each cycle.',
  'rpe-target':
    'Loads are picked from your estimated max to hit a target effort — heavier on good days, lighter on bad.',
  'weekly-volume':
    'Start at minimum growth volume, add sets weekly until recovery caps, then deload.',
  'rep-progression': 'Same weight, more reps each session.',
  'amrap-cycle':
    'Each week ends with an as-many-reps-as-possible set; beat your record to earn the next training-max bump.',
}

/** Human name for the scheme discriminator (the technical id stays in data). */
export function schemeName(scheme: ProgressionScheme): string {
  return NAMES[scheme]
}

/** The picker one-liner — plain language, no numbers required. */
export function schemeSubtitle(scheme: ProgressionScheme): string {
  return SUBTITLES[scheme]
}

/** What `schemeSentence` needs beyond the progression config itself. */
export interface SchemeSentenceContext {
  unit: WeightUnit
  /** Today's working load (kg) where known — lets double progression speak
   *  "at 65 lb". Absent/null/0 = omit the load clause, never guess. */
  currentLoadKg?: number | null
}

/** A displayable positive number, else null (NaN/∞/≤0 all mean "missing"). */
function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** `"5 lb"` / `"2.5 kg"` — the quantized display form of a kg load. */
function load(kg: number, unit: WeightUnit): string {
  return `${quantizeDisplayLoad(kg, unit)} ${unit}`
}

/**
 * The display form of an INCREMENT (a delta, not a bar load). Increments of
 * at least one display increment keep the quantized grid form (#226); a
 * configured micro-increment BELOW one increment prints its exact converted
 * value (2 dp, trimmed) — "+1.1 lb" for 0.5 kg, never the one-increment
 * floor's "+2.5 lb" (2.27× the configured step, #228's actual-numbers bar).
 */
function increment(kg: number, unit: WeightUnit): string {
  const display = kgToDisplay(kg, unit)
  const grid = unit === 'kg' ? LOAD_INCREMENT_KG : LOAD_INCREMENT_LB
  if (display < grid) return `${Number(display.toFixed(2))} ${unit}`
  return load(kg, unit)
}

/**
 * The "how this progresses" conditional sentence with the exercise's ACTUAL
 * numbers, e.g. "Hit 12 reps on every set at 65 lb → +5 lb next session."
 * Loads quantize to the display unit (#226). Missing/partial config degrades
 * to the scheme's subtitle — never "undefined", never raw kg in a lb account.
 */
export function schemeSentence(progression: Progression, context: SchemeSentenceContext): string {
  const { unit } = context
  switch (progression.scheme) {
    case 'linear': {
      const inc = positive(progression.incrementKg)
      if (inc === null) break
      return `Complete all sets → +${increment(inc, unit)} next session.`
    }
    case 'double-progression': {
      const top = positive(progression.repMax)
      if (top === null) break
      const inc = positive(progression.incrementKg) ?? DEFAULT_STEP_KG
      const at = positive(context.currentLoadKg)
      const atClause = at === null ? '' : ` at ${load(at, unit)}`
      return `Hit ${top} reps on every set${atClause} → +${increment(inc, unit)} next session.`
    }
    case 'percent-1rm': {
      const tm = positive(progression.trainingMaxKg)
      const percents = progression.weekPercents.map((p) => Math.round(p * 100)).filter((p) => p > 0)
      if (tm === null || percents.length === 0) break
      const min = Math.min(...percents)
      const max = Math.max(...percents)
      const span = min === max ? `${min}%` : `${min}–${max}%`
      return `Week loads are ${span} of your ${load(tm, unit)} training max.`
    }
    case 'rpe-target': {
      const rpe = positive(progression.targetRpe)
      if (rpe === null) break
      return `Loads picked from your estimated max to land at RPE ${rpe}.`
    }
    case 'weekly-volume': {
      const mev = positive(progression.mevSets)
      const mrv = positive(progression.mrvSets)
      if (mev === null || mrv === null || mrv < mev) break
      return `${mev} → ${mrv} sets across the block, added weekly.`
    }
    case 'rep-progression': {
      const reps = positive(progression.incrementReps)
      if (reps !== null) {
        const cap = positive(progression.maxReps)
        return `+${reps} rep${reps === 1 ? '' : 's'} each session${cap === null ? '' : `, up to ${cap}`}.`
      }
      const sec = positive(progression.incrementSec)
      if (sec !== null) {
        const cap = positive(progression.maxSec)
        return `+${sec} sec each session${cap === null ? '' : `, up to ${cap} sec`}.`
      }
      break
    }
    case 'amrap-cycle': {
      const inc = positive(progression.incrementKg)
      if (inc === null) break
      return `Beat your rep record on the last set to earn the next training-max bump (+${increment(inc, unit)}).`
    }
  }
  return schemeSubtitle(progression.scheme)
}

/**
 * The shared double-progression HOLD clause — what `autoregReason` prints
 * when the rep tops aren't filled yet ("Stay at 65 lb — hit 12 reps on every
 * set, then the weight goes up"). Owned here so the reason line and the
 * scheme sentence speak one voice. `repTop` 0 = the governing top is unknown
 * (mixed/renumbered template) — the clause stays imperative without a count.
 */
export function repFillHoldReason(loadLabel: string, repTop: number): string {
  return repTop > 0
    ? `Stay at ${loadLabel} — hit ${repTop} reps on every set, then the weight goes up`
    : `Stay at ${loadLabel} — add reps on every set, then the weight goes up`
}
