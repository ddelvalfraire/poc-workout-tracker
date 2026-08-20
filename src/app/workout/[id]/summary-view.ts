import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { bestScoredSet, type ScoredBestSet } from '@/lib/one-rep-max'
import { kgToDisplay, type WeightUnit } from '@/lib/units'
import type { LoggingType } from '@/lib/workout-input'

/**
 * Pure view logic for the workout summary page — the PR comparisons the page
 * used to compute inline and reduce to booleans, now kept whole so the
 * celebration zone can NAME its wins ("Bench · ~192 lb e1RM (+7)"), plus the
 * finish-headline copy table and the "vs last" delta labels. No JSX, no IO —
 * unit-tests as plain functions (the volume-view/stats-view convention).
 * Everything stays in the kg domain until an explicit display helper.
 */

/** The set facts one summary card carries (weights kg). */
export interface SummaryExerciseInput {
  id: string
  wgerExerciseId: number
  source: ExerciseSource
  name: string
  loggingType: LoggingType
  sets: readonly { reps: number | null; weight: number | null }[]
}

/** One flat prior-history set row (db/workouts.getExerciseHistoryBefore). */
export interface HistorySetRow {
  wgerExerciseId: number
  source: ExerciseSource
  reps: number | null
  weight: number | null
}

/** One exercise's session-vs-history comparison, whole — not just a badge. */
export interface ExerciseComparison {
  /** Composite identity — a custom exercise's id can collide with a wger id. */
  key: string
  /** Card id of the exercise's FIRST card: the PR badge renders once, there. */
  firstCardId: string
  name: string
  /** Best of THIS session across all the exercise's cards. */
  current: ScoredBestSet | null
  /** Best prior effort, scored under the exercise's CURRENT logging type —
   *  history rows carry no type of their own, and comparing a pull-up's past
   *  under today's reading is the comparison the lifter actually means. */
  prior: ScoredBestSet | null
  /** Like beats like: e1rm over prior e1rm, reps over prior reps — mixed
   *  kinds (bodyweight set after weighted history) never badge. */
  isPr: boolean
}

/**
 * Compares every exercise's best set this session against its prior history.
 * A PR is a property of the exercise + workout, not a single card: an
 * exercise logged in more than one card is judged by its best set across the
 * whole workout. Result order = first-appearance order in the workout.
 */
export function compareExercises(
  exercises: readonly SummaryExerciseInput[],
  history: readonly HistorySetRow[],
  bodyweightKg: number | null,
): ExerciseComparison[] {
  const priorByExercise = new Map<string, { reps: number | null; weight: number | null }[]>()
  for (const row of history) {
    const key = `${row.source}:${row.wgerExerciseId}`
    const list = priorByExercise.get(key) ?? []
    list.push({ reps: row.reps, weight: row.weight })
    priorByExercise.set(key, list)
  }

  const firstCards = new Map<string, { id: string; name: string; loggingType: LoggingType }>()
  const currentByExercise = new Map<string, { reps: number | null; weight: number | null }[]>()
  for (const ex of exercises) {
    const key = `${ex.source}:${ex.wgerExerciseId}`
    const list = currentByExercise.get(key) ?? []
    for (const s of ex.sets) list.push({ reps: s.reps, weight: s.weight })
    currentByExercise.set(key, list)
    if (!firstCards.has(key)) {
      firstCards.set(key, { id: ex.id, name: ex.name, loggingType: ex.loggingType })
    }
  }

  return [...firstCards.entries()].map(([key, card]) => {
    const current = bestScoredSet(currentByExercise.get(key) ?? [], card.loggingType, bodyweightKg)
    const prior = bestScoredSet(priorByExercise.get(key) ?? [], card.loggingType, bodyweightKg)
    const isPr =
      current !== null &&
      prior !== null &&
      ((current.kind === 'e1rm' && prior.kind === 'e1rm' && current.e1rm > prior.e1rm) ||
        (current.kind === 'reps' && prior.kind === 'reps' && current.reps > prior.reps))
    return { key, firstCardId: card.id, name: card.name, current, prior, isPr }
  })
}

/** One named PR line for the celebration zone (kg domain; page formats). */
export type PrHighlight =
  | { name: string; kind: 'e1rm'; e1rmKg: number; deltaKg: number }
  | { name: string; kind: 'reps'; reps: number; deltaReps: number }

/** The session's PRs as nameable facts, in workout order. */
export function prHighlights(comparisons: readonly ExerciseComparison[]): PrHighlight[] {
  return comparisons.flatMap((c): PrHighlight[] => {
    if (!c.isPr || c.current === null || c.prior === null) return []
    if (c.current.kind === 'e1rm' && c.prior.kind === 'e1rm') {
      return [
        {
          name: c.name,
          kind: 'e1rm',
          e1rmKg: c.current.e1rm,
          deltaKg: c.current.e1rm - c.prior.e1rm,
        },
      ]
    }
    if (c.current.kind === 'reps' && c.prior.kind === 'reps') {
      return [
        {
          name: c.name,
          kind: 'reps',
          reps: c.current.reps,
          deltaReps: c.current.reps - c.prior.reps,
        },
      ]
    }
    return []
  })
}

/**
 * Which headline the session earned, plus its arguments — a MESSAGE CHOICE,
 * not a sentence. The copy (including the "Two PRs." / "7 PRs." word-vs-
 * numeral split, now an ICU plural) lives in the catalog: a string built
 * here would be assembled before any request and could never be translated.
 */
export type FinishHeadline =
  | { key: 'prs'; values: { count: number } }
  | { key: 'pr'; values: { exercise: string } }
  | { key: 'blockClosed'; values: { week: number } }
  | { key: 'complete'; values: Record<string, never> }

/**
 * The finished-session headline — the most specific true thing, not a
 * generic stamp. Copy table, first match wins (CSS uppercases the render):
 *   2+ PRs                      → "Two PRs." / "7 PRs."
 *   1 PR                        → "{Exercise} PR."
 *   block-closing program week  → "Week {N} closed."
 *   otherwise                   → "Workout complete."
 * PRs outrank the block close: strength won today beats calendar admin.
 */
export function finishHeadline(input: {
  /** PR exercise names in workout order. */
  prNames: readonly string[]
  /** True when this session completed the mesocycle (up-next 'block-complete'). */
  blockClosed: boolean
  programWeek: number | null
}): FinishHeadline {
  const count = input.prNames.length
  if (count > 1) return { key: 'prs', values: { count } }
  if (count === 1) return { key: 'pr', values: { exercise: input.prNames[0] } }
  if (input.blockClosed && input.programWeek !== null) {
    return { key: 'blockClosed', values: { week: input.programWeek } }
  }
  return { key: 'complete', values: {} }
}

/**
 * An e1RM delta's display magnitude: 1dp in EITHER unit. Deltas are small
 * numbers — the kg identity of `kgToDisplay` would leak Epley's repeating
 * decimals ("+3.3333333333333335") straight into copy.
 */
export function e1rmDeltaDisplay(deltaKg: number, unit: WeightUnit): number {
  return Math.round(kgToDisplay(Math.abs(deltaKg), unit) * 10) / 10
}

/**
 * Direction suffix for an e1RM readout with a prior — "↑ +5" / "↓ −3" in the
 * display unit. Null when there's no visible movement after display rounding
 * ("↑ +0" is noise, not direction).
 */
export function e1rmDirectionSuffix(deltaKg: number, unit: WeightUnit): string | null {
  const magnitude = e1rmDeltaDisplay(deltaKg, unit)
  if (magnitude === 0) return null
  return deltaKg > 0 ? `↑ +${magnitude}` : `↓ −${magnitude}`
}

/**
 * Signed volume delta vs the last same-name session — "+480 lb" — computed
 * over ROUNDED display values so the label never disagrees with the whole-
 * unit volumes shown beside it. Null when flat after rounding.
 */
export function volumeVsLastLabel(
  currentKg: number,
  previousKg: number,
  unit: WeightUnit,
): string | null {
  const delta = Math.round(kgToDisplay(currentKg, unit)) - Math.round(kgToDisplay(previousKg, unit))
  if (delta === 0) return null
  const sign = delta > 0 ? '+' : '−'
  return `${sign}${Math.abs(delta).toLocaleString('en-US')} ${unit}`
}

/**
 * Signed duration delta in minutes — "+6 min" — null when either session has
 * no plausible duration (lib/format's rule) or the delta is zero.
 */
export function durationVsLastLabel(
  currentMin: number | null,
  previousMin: number | null,
): string | null {
  if (currentMin === null || previousMin === null) return null
  const delta = currentMin - previousMin
  if (delta === 0) return null
  const sign = delta > 0 ? '+' : '−'
  return `${sign}${Math.abs(delta)} min`
}
