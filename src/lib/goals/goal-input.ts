import type { ExerciseSource } from '../exercises/custom-exercise-input'

/**
 * Validation boundary for goal writes ("goal tracking we can create our own
 * version of goals" — the create action funnels untrusted client input through
 * here before anything reaches the db layer). Goals are FACTS ABOUT TARGETS:
 * a goal row stores only the target; progress is always derived from truths
 * the app already computes (e1RM records, bodyweight logs, schedule
 * adherence) — never written back.
 *
 * All weights here are CANONICAL KG — the server action converts from the
 * user's display unit before parsing (the setBodyweightAction pattern), so a
 * stale client can never convert against the wrong unit.
 */

export type GoalKind = 'strength' | 'bodyweight' | 'consistency'

export const GOAL_KINDS = ['strength', 'bodyweight', 'consistency'] as const satisfies readonly GoalKind[]

/** Target est. 1RM for one exercise, canonical kg. */
export interface StrengthTarget {
  e1rmKg: number
}

/** Target bodyweight, canonical kg. `direction` disambiguates progress: a cut
 *  and a bulk pass through the same number from opposite sides. */
export interface BodyweightTarget {
  weightKg: number
  direction: 'down' | 'up'
}

/**
 * A scheduled-days streak target. `allowedMissesPerWeek` is the user's OWN
 * grace setting ("user should be able to setup streak grace idk") — per goal,
 * not global: 0 = strict, 1 (default) or 2 misses forgiven per week.
 * `targetWeeks` makes the goal achievable — a target needs a number.
 */
export interface ConsistencyTarget {
  targetWeeks: number
  allowedMissesPerWeek: 0 | 1 | 2
}

export type GoalTarget = StrengthTarget | BodyweightTarget | ConsistencyTarget

// Sanity bands, canonical kg. The e1RM ceiling clears every human lift with
// room; the bodyweight band matches the app's stored-bodyweight ceiling with
// a floor that keeps a unit mix-up (20 lb as kg) from minting an absurd goal.
export const GOAL_E1RM_MIN_KG = 1
export const GOAL_E1RM_MAX_KG = 1000
export const GOAL_BODYWEIGHT_MIN_KG = 20
export const GOAL_BODYWEIGHT_MAX_KG = 500
// Streak bounds: a 1-week goal is the floor; two years of weeks the ceiling.
export const GOAL_TARGET_WEEKS_MIN = 1
export const GOAL_TARGET_WEEKS_MAX = 104
/** The forgiving default ("default 1"); strict (0) stays available. */
export const DEFAULT_ALLOWED_MISSES_PER_WEEK = 1

const MAX_EXERCISE_NAME_LENGTH = 200

/** What the create path persists — the discriminated, validated shape. */
export type ParsedGoalInput =
  | {
      kind: 'strength'
      target: StrengthTarget
      exercise: { wgerExerciseId: number; source: ExerciseSource; name: string }
      deadline: string | null
    }
  | { kind: 'bodyweight'; target: BodyweightTarget; deadline: string | null }
  | { kind: 'consistency'; target: ConsistencyTarget; deadline: string | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseKgInBand(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number`)
  }
  if (value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max} kg`)
  }
  // Column precision (2dp) — same rounding as displayToKg.
  return Math.round(value * 100) / 100
}

// Calendar-date shape; validity is checked by round-tripping through Date so
// 2026-02-31 fails, not just malformed strings.
const DEADLINE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseDeadline(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error('deadline must be a YYYY-MM-DD date')
  const match = DEADLINE_RE.exec(value)
  if (!match) throw new Error('deadline must be a YYYY-MM-DD date')
  const [, y, m, d] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  const roundTrips =
    date.getFullYear() === Number(y) &&
    date.getMonth() === Number(m) - 1 &&
    date.getDate() === Number(d)
  if (!roundTrips) throw new Error('deadline must be a real calendar date')
  return value
}

function parseExerciseRef(value: unknown): {
  wgerExerciseId: number
  source: ExerciseSource
  name: string
} {
  if (!isRecord(value)) throw new Error('a strength goal needs an exercise')
  const { wgerExerciseId, source, name } = value
  if (!Number.isInteger(wgerExerciseId) || (wgerExerciseId as number) <= 0) {
    throw new Error('invalid exercise id')
  }
  if (source !== 'wger' && source !== 'custom') {
    throw new Error("invalid exercise source: must be 'wger' or 'custom'")
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('invalid exercise name')
  }
  if (name.trim().length > MAX_EXERCISE_NAME_LENGTH) {
    throw new Error('exercise name too long')
  }
  return { wgerExerciseId: wgerExerciseId as number, source, name: name.trim() }
}

/**
 * Validates an untrusted goal payload into the persisted shape, throwing on
 * anything malformed. Kind gates the target fields exhaustively; a
 * non-strength goal must NOT carry an exercise ref (the columns stay null by
 * construction, not by convention).
 */
export function parseGoalInput(input: unknown): ParsedGoalInput {
  if (!isRecord(input)) throw new Error('invalid goal input')
  const { kind, target, exercise } = input
  if (kind !== 'strength' && kind !== 'bodyweight' && kind !== 'consistency') {
    throw new Error("goal kind must be 'strength', 'bodyweight' or 'consistency'")
  }
  if (!isRecord(target)) throw new Error('invalid goal target')
  const deadline = parseDeadline(input.deadline)

  if (kind === 'strength') {
    const e1rmKg = parseKgInBand(target.e1rmKg, GOAL_E1RM_MIN_KG, GOAL_E1RM_MAX_KG, 'target est. 1RM')
    return { kind, target: { e1rmKg }, exercise: parseExerciseRef(exercise), deadline }
  }

  if (exercise !== undefined && exercise !== null) {
    throw new Error(`a ${kind} goal must not carry an exercise`)
  }

  if (kind === 'bodyweight') {
    const weightKg = parseKgInBand(
      target.weightKg,
      GOAL_BODYWEIGHT_MIN_KG,
      GOAL_BODYWEIGHT_MAX_KG,
      'target bodyweight',
    )
    if (target.direction !== 'down' && target.direction !== 'up') {
      throw new Error("bodyweight goal direction must be 'down' or 'up'")
    }
    return { kind, target: { weightKg, direction: target.direction }, deadline }
  }

  const { targetWeeks } = target
  if (
    !Number.isInteger(targetWeeks) ||
    (targetWeeks as number) < GOAL_TARGET_WEEKS_MIN ||
    (targetWeeks as number) > GOAL_TARGET_WEEKS_MAX
  ) {
    throw new Error(
      `target weeks must be an integer between ${GOAL_TARGET_WEEKS_MIN} and ${GOAL_TARGET_WEEKS_MAX}`,
    )
  }
  // Absent grace takes the forgiving default; present grace must be exact.
  const misses = target.allowedMissesPerWeek ?? DEFAULT_ALLOWED_MISSES_PER_WEEK
  if (misses !== 0 && misses !== 1 && misses !== 2) {
    throw new Error('allowed misses per week must be 0, 1 or 2')
  }
  return {
    kind,
    target: { targetWeeks: targetWeeks as number, allowedMissesPerWeek: misses },
    deadline,
  }
}
