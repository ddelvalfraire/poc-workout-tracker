import type { ExerciseSource } from './custom-exercise-input'
import type { LoggingType } from './workout-input'
import { bestScoredSet } from './one-rep-max'

/**
 * Personal-record detection, shared by the completed-workout detail page (the
 * post-hoc badge) and — later — the live logger badge and the records surface.
 *
 * Exercise identity is the composite `(source, wgerExerciseId)`: the id column
 * is reused for custom-exercise ids, so `source` is required to keep a custom
 * movement from colliding with a wger one that happens to share the numeric id.
 * All keying here goes through `exerciseKey` so no caller re-derives that rule.
 */

/** Stable identity key for an exercise: the `(source, id)` composite as a string. */
export function exerciseKey(source: ExerciseSource, wgerExerciseId: number): string {
  return `${source}:${wgerExerciseId}`
}

/** The two comparable fields of a logged set (weight in kg, per the domain). */
export interface ScorableSet {
  reps: number | null
  weight: number | null
}

/**
 * A logged exercise in the workout under review. A PR is decided on its best
 * set across ALL its sets; `id` is the `workout_exercises` row the badge
 * renders on. An exercise logged in more than one card shares an identity but
 * keeps distinct `id`s — the badge lands on the first card (see below).
 */
export interface PrExercise {
  id: string
  source: ExerciseSource
  wgerExerciseId: number
  loggingType: LoggingType
  sets: readonly ScorableSet[]
}

/** A prior set row carrying its exercise identity — the comparison corpus. */
export interface PriorSet extends ScorableSet {
  source: ExerciseSource
  wgerExerciseId: number
}

/**
 * The `workout_exercises` row ids that earned a PR badge.
 *
 * A PR is a property of the exercise + workout, not a single card: an exercise
 * logged in more than one card is judged by its best set across the whole
 * workout, and the id is returned once — for the FIRST card of that exercise.
 *
 * Prior sets are scored under the CURRENT exercise's logging type (history rows
 * carry no type of their own, and comparing a pull-up's past under today's
 * reading is the comparison the lifter actually means). "Like beats like": an
 * e1rm PR needs a prior e1rm, a rep PR a prior rep count — mixed kinds (a
 * bodyweight set after weighted history) don't badge, since there's no honest
 * axis to compare on.
 */
export function detectPrBadges(
  exercises: readonly PrExercise[],
  prior: readonly PriorSet[],
  bodyweightKg: number | null,
): Set<string> {
  const priorByKey = new Map<string, ScorableSet[]>()
  for (const row of prior) {
    const key = exerciseKey(row.source, row.wgerExerciseId)
    const list = priorByKey.get(key) ?? []
    list.push({ reps: row.reps, weight: row.weight })
    priorByKey.set(key, list)
  }

  // Best set is judged across every card of the exercise, so aggregate the
  // current sets by identity before scoring — mirrors the prior-corpus keying.
  const currentByKey = new Map<string, ScorableSet[]>()
  for (const ex of exercises) {
    const key = exerciseKey(ex.source, ex.wgerExerciseId)
    const list = currentByKey.get(key) ?? []
    for (const s of ex.sets) list.push({ reps: s.reps, weight: s.weight })
    currentByKey.set(key, list)
  }

  const badgeRowIds = new Set<string>()
  const decided = new Set<string>()
  for (const ex of exercises) {
    const key = exerciseKey(ex.source, ex.wgerExerciseId)
    if (decided.has(key)) continue // badge once, on the first card
    decided.add(key)
    const cur = bestScoredSet(currentByKey.get(key) ?? [], ex.loggingType, bodyweightKg)
    const pri = bestScoredSet(priorByKey.get(key) ?? [], ex.loggingType, bodyweightKg)
    if (cur === null || pri === null) continue
    if (
      (cur.kind === 'e1rm' && pri.kind === 'e1rm' && cur.e1rm > pri.e1rm) ||
      (cur.kind === 'reps' && pri.kind === 'reps' && cur.reps > pri.reps)
    ) {
      badgeRowIds.add(ex.id)
    }
  }
  return badgeRowIds
}
