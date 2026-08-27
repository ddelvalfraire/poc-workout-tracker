/**
 * The subject snapshot the workout change log stores, and the diff that turns
 * two of them into ONE intent row.
 *
 * A set is ~6 scalar performed fields plus its addressing, so the log keeps
 * whole snapshots rather than field-level deltas — and denormalises the list
 * of touched columns into `changed` at write time, so a renderer never has to
 * re-diff the JSONB to decide what to show.
 */

/** The subject of a set-level event: what it IS (addressing) plus what was
 *  performed. Addressing rides inside the snapshot so a row is
 *  self-describing from `before` alone (a removal) or `after` alone (an add). */
export interface WorkoutSetSnapshot {
  source: string
  wgerExerciseId: number
  exerciseName: string
  setNumber: number
  reps: number | null
  weight: number | null
  completed: boolean
  rir: number | null
  rpe: number | null
  metricMode: string
  durationSec: number | null
  distanceM: number | null
}

/** The PERFORMED fields — the ones a correction can contradict. Addressing is
 *  deliberately absent: a set at a different position is a different subject,
 *  not a changed field. */
export const WORKOUT_SET_DIFF_FIELDS = [
  'reps',
  'weight',
  'completed',
  'rir',
  'rpe',
  'metricMode',
  'durationSec',
  'distanceM',
] as const satisfies readonly (keyof WorkoutSetSnapshot)[]

export type WorkoutSetDiffField = (typeof WORKOUT_SET_DIFF_FIELDS)[number]

/** The composite this module keys sets by — the SAME (source, exerciseId,
 *  setNumber) identity `priorFactKey` uses in workouts.ts, so the before-image
 *  and the prescribed_* facts align row for row. */
export function setSnapshotKey(source: string, wgerExerciseId: number, setNumber: number): string {
  return `${source}:${wgerExerciseId}:${setNumber}`
}

/** The performed fields that actually differ, in declaration order. Empty
 *  means "nothing changed" — the caller writes no event at all rather than
 *  manufacturing an empty amendment. */
export function diffSetSnapshots(
  before: WorkoutSetSnapshot,
  after: WorkoutSetSnapshot,
): WorkoutSetDiffField[] {
  return WORKOUT_SET_DIFF_FIELDS.filter((field) => before[field] !== after[field])
}

/**
 * True when the snapshot carries NO logged fact — the shape
 * `instantiate_program_day` writes: addressing and prescribed_* targets only,
 * nothing performed. Writing into one of these RECORDS a set for the first
 * time; writing over anything else CONTRADICTS what was recorded, and that is
 * the whole difference between an original and an amendment.
 *
 * Every performed field counts, effort and cardio included: an rir with no
 * reps is still something the lifter logged. `metricMode` deliberately does
 * NOT — it is how the set reads, fixed at instantiation, not a performed
 * value (it is also NOT NULL, so it could never be blank).
 */
export function isBlankSetSnapshot(snapshot: WorkoutSetSnapshot): boolean {
  return (
    snapshot.reps === null &&
    snapshot.weight === null &&
    snapshot.rir === null &&
    snapshot.rpe === null &&
    snapshot.durationSec === null &&
    snapshot.distanceM === null &&
    !snapshot.completed
  )
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

/** `Set 3 of Squat` — the human handle for a set-level subject. */
export function describeSetSubject(snapshot: WorkoutSetSnapshot): string {
  return `Set ${snapshot.setNumber} of ${snapshot.exerciseName}`
}

/** One compact line for a correction, e.g.
 *  `Set 3 of Squat — weight 100 → 102.5, reps 5 → 6`. */
export function describeSetChange(
  before: WorkoutSetSnapshot,
  after: WorkoutSetSnapshot,
  changed: readonly WorkoutSetDiffField[],
): string {
  const parts = changed.map(
    (field) => `${field} ${formatValue(before[field])} → ${formatValue(after[field])}`,
  )
  return `${describeSetSubject(after)} — ${parts.join(', ')}`
}
