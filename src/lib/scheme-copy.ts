import type { Progression } from './program-input'
import { kgToDisplay, type WeightUnit } from './units'
import { LOAD_INCREMENT_KG, LOAD_INCREMENT_LB, quantizeDisplayLoad } from './workout/load-quantize'

/**
 * The voice for every progression scheme (#228) — ONE module decides which
 * sentence each consumer gets (the `SchemeCopy` catalog namespace owns the
 * words), so the three can never drift apart:
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

/**
 * Message DESCRIPTORS for the `SchemeCopy` namespace (docs/I18N-KEYS.md §9).
 * The voice moved into `messages/en.json` word for word; this module keeps
 * only the DECISION — which scheme, which branch, which numbers — so a copy
 * edit can no longer break its tests, and a second locale gets the whole
 * voice rather than translated chrome around English sentences.
 */
/**
 * The catalog leaf per scheme. The discriminator itself is kebab-case because
 * it is DATA (it round-trips through the program jsonb); message keys must
 * stay camelCase, since an Android `strings.xml` export turns each one into a
 * Java identifier and hyphens are illegal there (I18N-KEYS.md §3).
 */
const SCHEME_LEAF = {
  linear: 'linear',
  'double-progression': 'doubleProgression',
  'percent-1rm': 'percent1rm',
  'rpe-target': 'rpeTarget',
  'weekly-volume': 'weeklyVolume',
  'rep-progression': 'repProgression',
  'amrap-cycle': 'amrapCycle',
} as const satisfies Record<ProgressionScheme, string>

type SchemeLeaf = (typeof SCHEME_LEAF)[ProgressionScheme]

export type SchemeNameMessage = { key: `name.${SchemeLeaf}`; values?: undefined }
export type SchemeSubtitleMessage = { key: `subtitle.${SchemeLeaf}`; values?: undefined }

/** Human name for the scheme discriminator (the technical id stays in data). */
export function schemeName(scheme: ProgressionScheme): SchemeNameMessage {
  return { key: `name.${SCHEME_LEAF[scheme]}` }
}

/** The picker one-liner — plain language, no numbers required. */
export function schemeSubtitle(scheme: ProgressionScheme): SchemeSubtitleMessage {
  return { key: `subtitle.${SCHEME_LEAF[scheme]}` }
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

/** The quantized display NUMBER for a kg load. The unit rides as its own ICU
 *  argument and the digits are formatted by `Intl` at render, so nothing here
 *  bakes in a decimal separator. */
function load(kg: number, unit: WeightUnit): number {
  return quantizeDisplayLoad(kg, unit)
}

/**
 * The display value of an INCREMENT (a delta, not a bar load). Increments of
 * at least one display increment keep the quantized grid form (#226); a
 * configured micro-increment BELOW one increment yields its exact converted
 * value (2 dp, trimmed) — 1.1 lb for 0.5 kg, never the one-increment floor's
 * 2.5 lb (2.27× the configured step, #228's actual-numbers bar).
 */
function increment(kg: number, unit: WeightUnit): number {
  const display = kgToDisplay(kg, unit)
  const grid = unit === 'kg' ? LOAD_INCREMENT_KG : LOAD_INCREMENT_LB
  if (display < grid) return Number(display.toFixed(2))
  return load(kg, unit)
}

/** Every branch of the "how this progresses" sentence, plus the subtitle it
 *  degrades to when the config can't support one. */
export type SchemeSentenceMessage =
  | SchemeSubtitleMessage
  | { key: 'sentence.linear'; values: { increment: number; unit: WeightUnit } }
  | {
      key: 'sentence.doubleProgression'
      values: { reps: number; increment: number; unit: WeightUnit }
    }
  | {
      key: 'sentence.doubleProgressionAtLoad'
      values: { reps: number; load: number; increment: number; unit: WeightUnit }
    }
  | { key: 'sentence.percent1rm'; values: { percent: number; trainingMax: number; unit: WeightUnit } }
  | {
      key: 'sentence.percent1rmRange'
      values: { min: number; max: number; trainingMax: number; unit: WeightUnit }
    }
  | { key: 'sentence.rpeTarget'; values: { rpe: number } }
  | { key: 'sentence.weeklyVolume'; values: { mev: number; mrv: number } }
  | { key: 'sentence.repProgression'; values: { reps: number } }
  | { key: 'sentence.repProgressionCapped'; values: { reps: number; cap: number } }
  | { key: 'sentence.secProgression'; values: { seconds: number } }
  | { key: 'sentence.secProgressionCapped'; values: { seconds: number; cap: number } }
  | { key: 'sentence.amrapCycle'; values: { increment: number; unit: WeightUnit } }

/**
 * The "how this progresses" conditional sentence with the exercise's ACTUAL
 * numbers, e.g. "Hit 12 reps on every set at 65 lb → +5 lb next session."
 * Loads quantize to the display unit (#226). Missing/partial config degrades
 * to the scheme's subtitle — never "undefined", never raw kg in a lb account.
 */
export function schemeSentence(
  progression: Progression,
  context: SchemeSentenceContext,
): SchemeSentenceMessage {
  const { unit } = context
  switch (progression.scheme) {
    case 'linear': {
      const inc = positive(progression.incrementKg)
      if (inc === null) break
      return { key: 'sentence.linear', values: { increment: increment(inc, unit), unit } }
    }
    case 'double-progression': {
      const top = positive(progression.repMax)
      if (top === null) break
      const inc = increment(positive(progression.incrementKg) ?? DEFAULT_STEP_KG, unit)
      const at = positive(context.currentLoadKg)
      return at === null
        ? { key: 'sentence.doubleProgression', values: { reps: top, increment: inc, unit } }
        : {
            key: 'sentence.doubleProgressionAtLoad',
            values: { reps: top, load: load(at, unit), increment: inc, unit },
          }
    }
    case 'percent-1rm': {
      const tm = positive(progression.trainingMaxKg)
      const percents = progression.weekPercents.map((p) => Math.round(p * 100)).filter((p) => p > 0)
      if (tm === null || percents.length === 0) break
      const min = Math.min(...percents)
      const max = Math.max(...percents)
      const trainingMax = load(tm, unit)
      return min === max
        ? { key: 'sentence.percent1rm', values: { percent: min, trainingMax, unit } }
        : { key: 'sentence.percent1rmRange', values: { min, max, trainingMax, unit } }
    }
    case 'rpe-target': {
      const rpe = positive(progression.targetRpe)
      if (rpe === null) break
      return { key: 'sentence.rpeTarget', values: { rpe } }
    }
    case 'weekly-volume': {
      const mev = positive(progression.mevSets)
      const mrv = positive(progression.mrvSets)
      if (mev === null || mrv === null || mrv < mev) break
      return { key: 'sentence.weeklyVolume', values: { mev, mrv } }
    }
    case 'rep-progression': {
      const reps = positive(progression.incrementReps)
      if (reps !== null) {
        const cap = positive(progression.maxReps)
        return cap === null
          ? { key: 'sentence.repProgression', values: { reps } }
          : { key: 'sentence.repProgressionCapped', values: { reps, cap } }
      }
      const sec = positive(progression.incrementSec)
      if (sec !== null) {
        const cap = positive(progression.maxSec)
        return cap === null
          ? { key: 'sentence.secProgression', values: { seconds: sec } }
          : { key: 'sentence.secProgressionCapped', values: { seconds: sec, cap } }
      }
      break
    }
    case 'amrap-cycle': {
      const inc = positive(progression.incrementKg)
      if (inc === null) break
      return { key: 'sentence.amrapCycle', values: { increment: increment(inc, unit), unit } }
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
