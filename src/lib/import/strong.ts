import { displayToKg, type WeightUnit } from '@/lib/units'
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
 * Strong CSV → ParsedImport. One row per set:
 *   Date, Workout Name, Duration, Exercise Name, Set Order, Weight, Reps,
 *   Distance, Seconds, Notes, Workout Notes, RPE
 * The file carries NO unit column — `unit` is the import-time picker's value
 * and every weight is read in it. Warm-ups appear as Set Order "W"; other
 * letter markers (failure/drop) are performed working sets. RPE is dropped
 * (workout sets don't store actual RPE — documented in the PRD).
 */
export function parseStrong(text: string, unit: WeightUnit): ParsedImport {
  const rows = parseCsv(text)
  if (rows.length === 0) throw new Error('empty file')
  const columns = headerIndex(rows[0])

  // Keyed by (date, workout name) — Strong repeats both on every set row.
  const workouts = new Map<string, MutableWorkout>()
  const skipped: SkippedRow[] = []
  let sawRpe = false

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const line = i + 1 // 1-based CSV line for skip reports

    const dateRaw = cell(row, columns, 'date')
    const startedAt = dateRaw === '' ? null : parseWallTime(dateRaw)
    if (!startedAt) {
      skipped.push({ row: line, reason: 'unparseable date' })
      continue
    }

    const exerciseName = cell(row, columns, 'exercise name')
    if (exerciseName === '') {
      skipped.push({ row: line, reason: 'missing exercise name' })
      continue
    }

    if (cell(row, columns, 'rpe') !== '') sawRpe = true

    const weightRaw = parseNumericCell(cell(row, columns, 'weight'))
    const repsRaw = parseNumericCell(cell(row, columns, 'reps'))
    const secondsRaw = parseNumericCell(cell(row, columns, 'seconds'))
    if (
      Number.isNaN(weightRaw ?? 0) ||
      Number.isNaN(repsRaw ?? 0) ||
      Number.isNaN(secondsRaw ?? 0)
    ) {
      skipped.push({ row: line, reason: 'non-numeric weight/reps/seconds' })
      continue
    }
    const distanceRaw = parseNumericCell(cell(row, columns, 'distance'))

    const setOrder = cell(row, columns, 'set order')
    const result = buildSet({
      reps: repsRaw,
      weightKg: weightRaw === null ? null : displayToKg(weightRaw, unit),
      durationSec: secondsRaw === null ? null : Math.round(secondsRaw),
      hasDistance: distanceRaw !== null && !Number.isNaN(distanceRaw) && distanceRaw > 0,
      isWarmup: setOrder.toLowerCase() === 'w',
    })
    if (!result.ok) {
      skipped.push({ row: line, reason: result.reason })
      continue
    }

    const workoutName = cell(row, columns, 'workout name')
    const workoutKey = `${startedAt.toISOString()}|${workoutName}`
    let workout = workouts.get(workoutKey)
    if (!workout) {
      workout = {
        name: workoutName || undefined,
        startedAt,
        durationSec: parseStrongDuration(cell(row, columns, 'duration')),
        notes: undefined,
        exercises: new Map(),
      }
      workouts.set(workoutKey, workout)
    }

    const workoutNotes = cell(row, columns, 'workout notes')
    if (workout.notes === undefined && workoutNotes !== '') workout.notes = workoutNotes

    let exercise = workout.exercises.get(exerciseName)
    if (!exercise) {
      exercise = { notes: undefined, sets: [] }
      workout.exercises.set(exerciseName, exercise)
    }
    const exerciseNotes = cell(row, columns, 'notes')
    if (exercise.notes === undefined && exerciseNotes !== '') exercise.notes = exerciseNotes
    exercise.sets.push(result.set)
  }

  const warnings: string[] = []
  if (sawRpe) warnings.push('RPE values are not imported (sets store performed work, not RPE).')

  return {
    source: 'strong',
    sourceUnit: unit,
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
  durationSec: number | null
  notes: string | undefined
  exercises: Map<string, MutableExercise>
}

function finalizeWorkout(w: MutableWorkout): ParsedWorkout {
  const spanSec = Math.min(w.durationSec ?? 0, MAX_SESSION_SEC)
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

/** "1h 12m" / "45m" / "1h" / "90s" → seconds; unrecognized → null. */
export function parseStrongDuration(raw: string): number | null {
  if (raw === '') return null
  const match = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/.exec(raw.trim())
  if (!match || (match[1] === undefined && match[2] === undefined && match[3] === undefined)) {
    return null
  }
  const [, h, m, s] = match
  return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)
}
