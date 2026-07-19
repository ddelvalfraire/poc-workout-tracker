/**
 * Pure template logic, kept free of React and the DB so both directions
 * unit-test as plain functions:
 *
 *   workout  → template  (`deriveTemplateFromWorkout` — the "Save as template"
 *                         sketch: exercises in order with a compact set plan)
 *   template → draft     (`templateToDraft` — the "Start from template" seed:
 *                         plannedSets empty sets per exercise, mirroring how
 *                         `detailToDraft` seeds the repeat flow)
 *
 * A template is a sketch, not a program: the derivation intentionally reduces
 * logged sets to plannedSets + a most-common-rep range and drops loads —
 * loads come back at log time as ghosts from history, exactly like a repeat.
 */
import type { WorkoutDetail } from '@/db/workouts'
import type { WorkoutTemplateDetail } from '@/db/workout-templates'
import type { WorkoutDraft } from '@/app/workout/new/workout-draft'
import {
  MIN_PLANNED_SETS,
  MAX_PLANNED_SETS,
  type WorkoutTemplateInput,
} from './template-input'

// Rep counts outside the template bounds (1–100) can't enter the rep range —
// a 0-rep or data-entry-glitch set must not become the prescription.
const MIN_TEMPLATE_REPS = 1
const MAX_TEMPLATE_REPS = 100

/** Fallback name when the workout is unnamed: first exercise (+ count). */
function nameFromExercises(names: string[]): string {
  if (names.length === 0) return 'Workout template'
  if (names.length === 1) return names[0]
  return `${names[0]} + ${names.length - 1} more`
}

/** The most common valid rep count among the given sets, or null when no set
 *  has usable reps. Ties break toward the count seen FIRST in set order —
 *  deterministic, and it favors the top-of-exercise scheme. */
function mostCommonReps(reps: (number | null)[]): number | null {
  const counts = new Map<number, number>()
  for (const r of reps) {
    if (r === null || !Number.isInteger(r)) continue
    if (r < MIN_TEMPLATE_REPS || r > MAX_TEMPLATE_REPS) continue
    counts.set(r, (counts.get(r) ?? 0) + 1)
  }
  let best: number | null = null
  let bestCount = 0
  // Map iteration preserves insertion order, so `>` (not `>=`) keeps the
  // first-seen winner on ties.
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

/**
 * Derives a template sketch from a logged workout. Rules:
 *  - Skipped exercises are dropped ("couldn't do this today" is a fact about
 *    that session, not part of the plan being saved).
 *  - Warm-up sets never shape the sketch: plannedSets counts WORKING sets
 *    only, and the rep range is computed over working sets only — warm-ups
 *    are preparation, not prescription (same rule scorers follow).
 *  - plannedSets is clamped to the template bounds (1–10).
 *  - repMin = repMax = the most common working-set rep count; both omitted
 *    when no working set logged usable reps.
 *  - loggingType/source/notes carry over; loads and restSec do not (a workout
 *    records neither a rest plan nor a reusable load — ghosts re-derive them).
 * Returns null when nothing derivable remains (every exercise skipped).
 */
export function deriveTemplateFromWorkout(workout: WorkoutDetail): WorkoutTemplateInput | null {
  const exercises = workout.exercises
    .filter((exercise) => !exercise.skipped)
    .map((exercise) => {
      const workingSets = exercise.sets.filter((set) => set.setType !== 'warmup')
      const plannedSets = Math.min(
        MAX_PLANNED_SETS,
        Math.max(MIN_PLANNED_SETS, workingSets.length),
      )
      const commonReps = mostCommonReps(workingSets.map((set) => set.reps))
      return {
        wgerExerciseId: exercise.wgerExerciseId,
        source: exercise.source,
        name: exercise.name,
        loggingType: exercise.loggingType,
        ...(exercise.notes !== null && { notes: exercise.notes }),
        plannedSets,
        ...(commonReps !== null && { repMin: commonReps, repMax: commonReps }),
      }
    })
  if (exercises.length === 0) return null

  const trimmedName = workout.name?.trim()
  return {
    name: trimmedName && trimmedName.length > 0
      ? trimmedName
      : nameFromExercises(exercises.map((exercise) => exercise.name)),
    exercises,
  }
}

/**
 * Seeds a fresh logger draft from a template — the template twin of
 * `detailToDraft`'s repeat seeding: plannedSets EMPTY sets per exercise
 * (values and ghosts come from history at log time, per the logger's normal
 * rules), loggingType/notes carried, nothing completed. The rep range and
 * restSec stay on the template's detail page — the draft has no target
 * fields, by design.
 *
 * Pure (no `crypto`): client ids derive from the template exercise row ids,
 * so the Server Component can call it. plannedSets is re-clamped on read —
 * stored rows are still data, and a corrupt value must not mint 0 or 500
 * set rows.
 */
export function templateToDraft(template: WorkoutTemplateDetail): {
  draft: WorkoutDraft
  name: string
} {
  const exercises = template.exercises.map((exercise) => ({
    id: exercise.id,
    wgerExerciseId: exercise.wgerExerciseId,
    source: exercise.source,
    name: exercise.name,
    category: '', // not persisted on templates, same as detailToDraft
    loggingType: exercise.loggingType,
    notes: exercise.notes ?? '',
    skipped: false,
    sets: Array.from(
      {
        length: Math.min(
          MAX_PLANNED_SETS,
          Math.max(MIN_PLANNED_SETS, exercise.plannedSets),
        ),
      },
      (_, i) => ({
        id: `${exercise.id}:set:${i + 1}`,
        reps: '',
        weight: '',
        completed: false,
        tag: 'working' as const,
      }),
    ),
  }))
  return { draft: { exercises, notes: '' }, name: template.name }
}
