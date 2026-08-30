import { muscleGroupFor } from '@/lib/exercises/muscle-groups'
import { canonicalLiftFor } from '@/lib/goals/trophies'
import type { CanonicalLift } from '@/lib/goals/trophy-kinds'
import type { ExerciseSource } from '@/lib/exercises/custom-exercise-input'
import type { ResolvedHomeSection } from './layout'
import { layoutForPreset, type HomePresetId } from './presets'

/**
 * What the app reads about how you train — and the layout that read would
 * suggest.
 *
 * THE FIREWALL. Everything here derives from LOGGED TRAINING DATA and nothing
 * else: what sets you logged, at what rep ranges, over which movements, and
 * what phase and targets you have already stated. Never which widget you
 * tapped, which preset you picked, or how long you looked at anything.
 *
 * That constraint is the design, not a detail. A recommender trained on
 * preferences its own recommendations shaped ends up fitting its
 * recommendation history rather than the person: show someone cardio widgets,
 * they engage with cardio widgets, the system concludes they are a runner.
 * Home changes what you SEE; it must never become an input to what the app
 * thinks you ARE. With the signal's inputs untouched by its outputs that loop
 * cannot form — which is why `TrainingFacts` has no field a home interaction
 * could fill, and why adding one would be the bug.
 *
 * IT NEVER SPEAKS FIRST. Nothing here renders on home. A line on home asking
 * you to confirm your training style is a teaser row, and teaser rows are
 * banned on the one surface that must never nag. The read is passive: it
 * seeds a home nobody has customized, and it is reported inside Customize
 * home, where someone who wants it goes looking.
 *
 * ORDER OF AUTHORITY: a saved layout beats this, and this beats the general
 * default. A layout you chose or edited is never overridden.
 */

/** How far back the classification looks. Eight weeks is long enough that one
 *  deload or a holiday cannot flip the verdict, and short enough to describe
 *  what you are doing now rather than what you did last year. */
export const SIGNAL_WINDOW_WEEKS = 8

/** Below this many working sets there is nothing to read. A verdict off four
 *  sets is a guess wearing a number, and a fresh account must land on the
 *  general default rather than on a coin flip. */
const MIN_WORKING_SETS = 20

/** Rep-range boundaries. At or below the low bound reads as strength work;
 *  the band up to the high bound reads as hypertrophy. Past it, rep count
 *  stops saying anything useful about intent. */
const STRENGTH_MAX_MEDIAN_REPS = 6
const HYPERTROPHY_MAX_MEDIAN_REPS = 20

/** How many muscle groups a block has to touch before "training everything"
 *  is a fair description of it. */
const HYPERTROPHY_MIN_MUSCLE_GROUPS = 5

/** The share of sets that must be duration or distance work before
 *  conditioning is the headline rather than a warm-up habit. */
const CONDITIONING_MIN_SHARE = 0.3

/**
 * The facts the classification reads. Every field is a training fact or a
 * stated intention — there is deliberately nowhere to put a tap, a dwell
 * time, or a preset previously suggested.
 */
export interface TrainingFacts {
  /** The active program's stated phase, when one is set. A stated fact, so it
   *  outranks anything inferred from rep ranges. */
  dietPhase: 'cutting' | 'bulking' | null
  /** The direction of an active bodyweight goal, when there is one. */
  bodyweightGoalDirection: 'down' | 'up' | null
  /** An active, unachieved strength goal exists. */
  hasStrengthGoal: boolean
  /** Median reps across completed working sets carrying reps. Null when no
   *  set in the window does. */
  medianWorkingReps: number | null
  /** Distinct muscle groups touched by completed working sets. */
  muscleGroupCount: number
  /** Squat, bench AND deadlift all appear in the window. */
  hasBigThree: boolean
  /** Completed working sets in the window, of any metric. */
  workingSetCount: number
  /** Of those, the ones logged as duration or distance work. */
  conditioningSetCount: number
}

/** The verdict, carrying the facts it rested on — the editor states its
 *  evidence rather than asking anyone to take the read on faith. */
export interface TrainingSignal {
  preset: HomePresetId
  medianWorkingReps: number | null
  muscleGroupCount: number
  windowWeeks: number
}

/**
 * The archetype these facts describe, or null when they describe nothing.
 *
 * A STATED FACT OUTRANKS AN INFERENCE. Phase and goal direction are things
 * you told the app; rep ranges are things it worked out about you. So a cut
 * stays a cut even while you train like a powerlifter — the common case, and
 * the more annoying error to get backwards.
 *
 * Below that the style read runs most-specific first: conditioning is a share
 * of the week the rep-range tests cannot see, powerlifting wants the rep
 * range AND the movements AND a stated strength target, and hypertrophy is
 * the broad middle. Anything else returns null and the caller falls back to
 * the general default — silence is a real answer here, not a failure.
 */
export function classifyTrainingSignal(facts: TrainingFacts): TrainingSignal | null {
  if (facts.workingSetCount < MIN_WORKING_SETS) return null

  const as = (preset: HomePresetId): TrainingSignal => ({
    preset,
    medianWorkingReps: facts.medianWorkingReps,
    muscleGroupCount: facts.muscleGroupCount,
    windowWeeks: SIGNAL_WINDOW_WEEKS,
  })

  if (facts.dietPhase === 'cutting') return as('cut')
  if (facts.dietPhase === 'bulking') return as('bulk')
  if (facts.bodyweightGoalDirection === 'down') return as('cut')
  if (facts.bodyweightGoalDirection === 'up') return as('bulk')

  if (facts.conditioningSetCount / facts.workingSetCount >= CONDITIONING_MIN_SHARE) {
    return as('conditioning')
  }

  const reps = facts.medianWorkingReps
  if (reps === null) return null

  if (reps <= STRENGTH_MAX_MEDIAN_REPS && facts.hasBigThree && facts.hasStrengthGoal) {
    return as('powerlifting')
  }
  if (
    reps <= HYPERTROPHY_MAX_MEDIAN_REPS &&
    facts.muscleGroupCount >= HYPERTROPHY_MIN_MUSCLE_GROUPS
  ) {
    return as('hypertrophy')
  }
  return null
}

/**
 * The layout a home with nothing saved should open on.
 *
 * The ONLY place the derived read touches what renders, and strictly as a
 * seed: the moment someone saves a layout, that layout wins forever and this
 * stops being consulted. A null signal — a fresh account, or one the facts do
 * not describe — lands on the general preset, which is a perfectly good home
 * rather than a placeholder.
 */
export function defaultLayoutFor(signal: TrainingSignal | null): ResolvedHomeSection[] {
  return layoutForPreset(signal?.preset ?? null)
}

/** The median of a list of reps. Exported because the read builds it from a
 *  flat row list, and the rule — AVERAGE the two middle values on an even
 *  count, so 5s and 8s read as 6.5 rather than silently picking a side —
 *  belongs beside the thresholds it is compared against. */
export function medianReps(reps: readonly number[]): number | null {
  if (reps.length === 0) return null
  const sorted = [...reps].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** One completed working set in the window, flattened, as the read returns
 *  it. Warm-ups never reach here — they are excluded in SQL, the same rule
 *  every other scoring read follows. */
export interface SignalSetRow {
  reps: number | null
  /** Loose like `ExerciseStatsRow.metricMode`: the column is app-enum'd text,
   *  and every consumer asks whether it IS `reps_weight` rather than
   *  switching over the union. */
  metricMode: string
  source: ExerciseSource
  wgerExerciseId: number
  exerciseName: string
  /** Primary muscles, wger English names. Null or empty for an exercise the
   *  catalog never tagged. */
  muscles: readonly string[] | null
}

/** The facts a person has STATED, which the rows cannot tell us. Separate
 *  from the rows because they come from different tables and, more to the
 *  point, because they outrank anything the rows imply. */
export interface StatedFacts {
  dietPhase: 'cutting' | 'bulking' | null
  bodyweightGoalDirection: 'down' | 'up' | null
  hasStrengthGoal: boolean
}

const SUM_LIFTS: readonly CanonicalLift[] = ['squat', 'bench', 'deadlift']

/**
 * Rolls the window's sets up into the facts the classification reads.
 *
 * Only `reps_weight` rows contribute a rep reading: a duration row carries no
 * reps, and letting a stray one through would drag the median toward a number
 * that describes nothing. Those rows are exactly what conditioning counts
 * instead, so every set lands in one bucket or the other.
 *
 * A muscle group is credited from the exercise's PRIMARY muscles only.
 * Secondary credit is right for volume — it is half a set of real work — but
 * wrong for "how much of the body does this person train": counting every
 * incidental stabiliser would make a bench-only routine look full-body.
 */
export function aggregateTrainingFacts(
  rows: readonly SignalSetRow[],
  stated: StatedFacts,
): TrainingFacts {
  const reps: number[] = []
  const groups = new Set<string>()
  const lifts = new Set<CanonicalLift>()
  let conditioningSetCount = 0

  for (const row of rows) {
    if (row.metricMode === 'reps_weight') {
      if (row.reps !== null) reps.push(row.reps)
    } else {
      conditioningSetCount += 1
    }
    for (const muscle of row.muscles ?? []) {
      const group = muscleGroupFor(muscle)
      // An untagged or unrecognized muscle is not a group anyone trains
      // "enough of" — it is a gap in the catalog, and inventing an 'Other'
      // group here would inflate the breadth this read is measuring.
      if (group !== null) groups.add(group)
    }
    const lift = canonicalLiftFor(row.source, row.wgerExerciseId, row.exerciseName)
    if (lift !== null) lifts.add(lift)
  }

  return {
    ...stated,
    medianWorkingReps: medianReps(reps),
    muscleGroupCount: groups.size,
    hasBigThree: SUM_LIFTS.every((lift) => lifts.has(lift)),
    workingSetCount: rows.length,
    conditioningSetCount,
  }
}
