import { displayToKg } from '@/lib/units'
import { parseCsv, headerIndex, cell } from './csv'
import { buildSet, parseNumericCell } from './set-builder'
import {
  MAX_SESSION_SEC,
  parseWallTime,
  type ParsedImport,
  type ParsedWorkout,
  type SkippedRow,
} from './types'

/**
 * Hevy CSV → ParsedImport. One row per set:
 *   title, start_time, end_time, description, exercise_title, superset_id,
 *   exercise_notes, set_index, set_type, weight_kg (or weight_lbs), reps,
 *   distance_km, duration_seconds, rpe
 * The unit IS header-declared (weight_kg vs weight_lbs by account), so no
 * picker is needed. set_type warmup → 'warmup'; failure/dropset are performed
 * working sets. Supersets and RPE are dropped (workouts don't store either)
 * and surfaced as preview warnings, never silently.
 */
export function parseHevy(text: string): ParsedImport {
  const rows = parseCsv(text)
  if (rows.length === 0) throw new Error('empty file')
  const columns = headerIndex(rows[0])
  const weightColumn = columns.has('weight_kg') ? 'weight_kg' : 'weight_lbs'
  const sourceUnit = weightColumn === 'weight_kg' ? 'kg' : 'lb'

  const workouts = new Map<string, MutableWorkout>()
  const skipped: SkippedRow[] = []
  let sawRpe = false
  let sawSuperset = false

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const line = i + 1

    const startRaw = cell(row, columns, 'start_time')
    const startedAt = startRaw === '' ? null : parseWallTime(startRaw)
    if (!startedAt) {
      skipped.push({ row: line, reason: 'unparseable start_time' })
      continue
    }

    const exerciseName = cell(row, columns, 'exercise_title')
    if (exerciseName === '') {
      skipped.push({ row: line, reason: 'missing exercise name' })
      continue
    }

    if (cell(row, columns, 'rpe') !== '') sawRpe = true
    if (cell(row, columns, 'superset_id') !== '') sawSuperset = true

    const weightRaw = parseNumericCell(cell(row, columns, weightColumn))
    const repsRaw = parseNumericCell(cell(row, columns, 'reps'))
    const durationRaw = parseNumericCell(cell(row, columns, 'duration_seconds'))
    if (
      Number.isNaN(weightRaw ?? 0) ||
      Number.isNaN(repsRaw ?? 0) ||
      Number.isNaN(durationRaw ?? 0)
    ) {
      skipped.push({ row: line, reason: 'non-numeric weight/reps/duration' })
      continue
    }
    const distanceRaw = parseNumericCell(cell(row, columns, 'distance_km'))

    const setType = cell(row, columns, 'set_type').toLowerCase()
    const result = buildSet({
      reps: repsRaw,
      weightKg: weightRaw === null ? null : displayToKg(weightRaw, sourceUnit),
      durationSec: durationRaw === null ? null : Math.round(durationRaw),
      hasDistance: distanceRaw !== null && !Number.isNaN(distanceRaw) && distanceRaw > 0,
      isWarmup: setType === 'warmup',
    })
    if (!result.ok) {
      skipped.push({ row: line, reason: result.reason })
      continue
    }

    const title = cell(row, columns, 'title')
    const workoutKey = `${startedAt.toISOString()}|${title}`
    let workout = workouts.get(workoutKey)
    if (!workout) {
      const endRaw = cell(row, columns, 'end_time')
      workout = {
        name: title || undefined,
        startedAt,
        completedAt: endRaw === '' ? null : parseWallTime(endRaw),
        notes: undefined,
        exercises: new Map(),
      }
      workouts.set(workoutKey, workout)
    }

    const description = cell(row, columns, 'description')
    if (workout.notes === undefined && description !== '') workout.notes = description

    let exercise = workout.exercises.get(exerciseName)
    if (!exercise) {
      exercise = { notes: undefined, sets: [] }
      workout.exercises.set(exerciseName, exercise)
    }
    const exerciseNotes = cell(row, columns, 'exercise_notes')
    if (exercise.notes === undefined && exerciseNotes !== '') exercise.notes = exerciseNotes
    exercise.sets.push(result.set)
  }

  const warnings: string[] = []
  if (sawSuperset) {
    warnings.push("Supersets aren't preserved — workouts don't store superset groupings.")
  }
  if (sawRpe) warnings.push('RPE values are not imported (sets store performed work, not RPE).')

  return {
    source: 'hevy',
    sourceUnit,
    workouts: [...workouts.values()].map(finalizeWorkout),
    skipped,
    warnings,
  }
}

interface MutableExercise {
  notes: string | undefined
  sets: ParsedWorkout['exercises'][number]['sets']
}

interface MutableWorkout {
  name: string | undefined
  startedAt: Date
  completedAt: Date | null
  notes: string | undefined
  exercises: Map<string, MutableExercise>
}

function finalizeWorkout(w: MutableWorkout): ParsedWorkout {
  // end_time before start (clock weirdness) or absent → completedAt = start;
  // spans clamp to ≤ 6h (the formatWorkoutDuration plausibility rule).
  const rawSpanSec = w.completedAt
    ? Math.max(0, (w.completedAt.getTime() - w.startedAt.getTime()) / 1000)
    : 0
  const spanSec = Math.min(rawSpanSec, MAX_SESSION_SEC)
  return {
    ...(w.name !== undefined ? { name: w.name } : {}),
    startedAt: w.startedAt.toISOString(),
    completedAt: new Date(w.startedAt.getTime() + spanSec * 1000).toISOString(),
    ...(w.notes !== undefined ? { notes: w.notes } : {}),
    exercises: [...w.exercises.entries()].map(([name, e]) => ({
      name,
      ...(e.notes !== undefined ? { notes: e.notes } : {}),
      sets: e.sets,
    })),
  }
}
