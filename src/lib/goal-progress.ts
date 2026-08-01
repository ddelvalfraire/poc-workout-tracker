import type { BodyweightTarget, ConsistencyTarget, GoalKind, GoalTarget } from './goal-input'
import { kgToDisplay, type WeightUnit } from './units'

/**
 * Pure goal-progress math — no I/O, no db. Everything here derives from
 * already-computed truths (exercise-stats trend points, the current
 * bodyweight, completed-workout instants vs the program's scheduled
 * weekdays); nothing is ever written back. Composition over db reads lives
 * in lib/goals.ts.
 *
 * Timezone: the streak buckets completions into Sunday-first calendar weeks
 * of the RUNTIME's timezone. Display surfaces run it client-side after mount
 * (the local-day.ts principle); the server-side achievement check runs it in
 * UTC — accepted drift, bounded to the week boundary and absorbed by grace
 * in the common case.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Backstop for the walk-back loop; the trained-week requirement already ends
// it at the earliest completion, this just bounds hostile inputs.
const MAX_STREAK_WEEKS = 520

/** Local midnight starting the Sunday-first week containing `d`. */
function startOfWeek(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay())
}

export interface StreakInput {
  /** Distinct scheduled weekdays (0–6, Sunday-first) across the active
   *  program's days — the week's training obligations. */
  scheduledWeekdays: readonly number[]
  /** Completion instants of COMPLETED workouts (any workout — training on a
   *  scheduled day counts regardless of which plan it came from). */
  completions: readonly Date[]
  /** The goal's grace: misses forgiven per week (0 strict, 1 default, 2). */
  allowedMissesPerWeek: number
  now: Date
}

/**
 * Consecutive-week streak counted back from the current week. Exact rules:
 *  - A week's misses = scheduled weekdays with NO completion that week.
 *  - A past (full) week EXTENDS the streak iff misses <= grace AND at least
 *    one scheduled weekday was trained — a zero-training week never counts,
 *    even when a tiny schedule plus generous grace would technically forgive
 *    it (a streak week must contain training).
 *  - The CURRENT week: a scheduled weekday counts as missed only once it has
 *    fully elapsed (weekday strictly before today's); today untrained is not
 *    yet a miss. If the misses-so-far already exceed grace the streak is
 *    dead → 0. Otherwise the current week adds 1 iff it already has a
 *    trained scheduled day (still satisfiable but untrained = doesn't count
 *    yet), and the walk continues into past weeks either way.
 *  - No scheduled weekdays at all → every week is unscheduled → 0 (nothing
 *    to adhere to; the surfaces show a "schedule your days" state instead).
 */
export function weeklyStreak({
  scheduledWeekdays,
  completions,
  allowedMissesPerWeek,
  now,
}: StreakInput): number {
  const scheduled = [
    ...new Set(scheduledWeekdays.filter((w) => Number.isInteger(w) && w >= 0 && w <= 6)),
  ]
  if (scheduled.length === 0) return 0
  const grace =
    Number.isInteger(allowedMissesPerWeek) && allowedMissesPerWeek >= 0 ? allowedMissesPerWeek : 0

  // Bucket completions: week-start epoch → set of trained weekdays.
  const trainedByWeek = new Map<number, Set<number>>()
  for (const at of completions) {
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) continue
    const week = startOfWeek(at).getTime()
    const days = trainedByWeek.get(week) ?? new Set<number>()
    days.add(at.getDay())
    trainedByWeek.set(week, days)
  }

  const currentWeekStart = startOfWeek(now)
  const trainedThisWeek = trainedByWeek.get(currentWeekStart.getTime()) ?? new Set<number>()
  const missesSoFar = scheduled.filter((w) => w < now.getDay() && !trainedThisWeek.has(w)).length
  if (missesSoFar > grace) return 0

  let streak = scheduled.some((w) => trainedThisWeek.has(w)) ? 1 : 0

  for (let back = 1; back <= MAX_STREAK_WEEKS; back += 1) {
    // Date arithmetic (not ms subtraction) so DST-shifted weeks stay aligned
    // to local midnights.
    const weekStart = new Date(
      currentWeekStart.getFullYear(),
      currentWeekStart.getMonth(),
      currentWeekStart.getDate() - back * 7,
    )
    const trained = trainedByWeek.get(weekStart.getTime()) ?? new Set<number>()
    const trainedScheduled = scheduled.filter((w) => trained.has(w)).length
    const misses = scheduled.length - trainedScheduled
    if (trainedScheduled === 0 || misses > grace) break
    streak += 1
  }
  return streak
}

// ── Pace projection ──────────────────────────────────────────────────────────

export interface PacePoint {
  at: Date
  value: number
}

// Recent-slope window: the last N trend points. Small on purpose — pace is
// about the CURRENT trajectory, not the lifetime average.
const PACE_RECENT_POINTS = 8
// Silence over speculation: a projection further out than this says more
// about noise than about the lifter.
const PACE_MAX_HORIZON_DAYS = 730

/**
 * "On pace for {date}": least-squares slope over the recent trend points,
 * extrapolated from the latest value to the target. Null — silence — unless
 * the slope is positive, there are >= 2 points, and the projected date lands
 * within a sane horizon. A latest value already at/over the target also
 * returns null (the achievement surface owns that moment).
 */
export function paceProjection(
  points: readonly PacePoint[],
  targetValue: number,
  now: Date,
): Date | null {
  if (!Number.isFinite(targetValue)) return null
  const recent = points.slice(-PACE_RECENT_POINTS)
  if (recent.length < 2) return null
  const last = recent[recent.length - 1]
  if (last.value >= targetValue) return null

  const xs = recent.map((p) => p.at.getTime())
  const ys = recent.map((p) => p.value)
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length
  let num = 0
  let den = 0
  for (let i = 0; i < xs.length; i += 1) {
    num += (xs[i] - xMean) * (ys[i] - yMean)
    den += (xs[i] - xMean) ** 2
  }
  if (den === 0) return null
  const slopePerMs = num / den
  if (!(slopePerMs > 0)) return null

  const msToTarget = (targetValue - last.value) / slopePerMs
  const projected = last.at.getTime() + msToTarget
  if (projected - now.getTime() > PACE_MAX_HORIZON_DAYS * MS_PER_DAY) return null
  // A projection already behind `now` means the pace says "any session now".
  return new Date(Math.max(projected, now.getTime()))
}

// ── Progress + achievement predicates ────────────────────────────────────────

/** Percent toward a strength target, clamped 0–100 (integer, for display). */
export function strengthPercent(bestE1rmKg: number | null, targetE1rmKg: number): number {
  if (bestE1rmKg === null || !(targetE1rmKg > 0)) return 0
  return Math.max(0, Math.min(100, Math.round((bestE1rmKg / targetE1rmKg) * 100)))
}

/** Kg still to move in the target's direction; 0 = there. Null = no current
 *  bodyweight on record (progress is unknowable, not zero). */
export function bodyweightRemainingKg(
  currentKg: number | null,
  target: BodyweightTarget,
): number | null {
  if (currentKg === null || !Number.isFinite(currentKg)) return null
  const remaining =
    target.direction === 'down' ? currentKg - target.weightKg : target.weightKg - currentKg
  return Math.max(0, Math.round(remaining * 100) / 100)
}

export function isStrengthAchieved(bestE1rmKg: number | null, targetE1rmKg: number): boolean {
  return bestE1rmKg !== null && bestE1rmKg >= targetE1rmKg
}

export function isBodyweightAchieved(currentKg: number | null, target: BodyweightTarget): boolean {
  return bodyweightRemainingKg(currentKg, target) === 0
}

export function isConsistencyAchieved(streakWeeks: number, target: ConsistencyTarget): boolean {
  return streakWeeks >= target.targetWeeks
}

// ── Labels ───────────────────────────────────────────────────────────────────

/** The narrow shape `goalLabel` needs — a GoalRow satisfies it. */
export interface GoalLabelInput {
  kind: GoalKind
  target: GoalTarget
  exerciseName: string | null
}

/**
 * One human line naming the goal ("Squat 315 lb", "Bodyweight 80 kg",
 * "8-week streak") — shared by cards, the completion surface, the push and
 * the MCP payload so every surface says the same words.
 */
export function goalLabel(goal: GoalLabelInput, unit: WeightUnit): string {
  if (goal.kind === 'strength' && 'e1rmKg' in goal.target) {
    const value = kgToDisplay(goal.target.e1rmKg, unit)
    return `${goal.exerciseName ?? 'Exercise'} ${value} ${unit}`
  }
  if (goal.kind === 'bodyweight' && 'weightKg' in goal.target) {
    return `Bodyweight ${kgToDisplay(goal.target.weightKg, unit)} ${unit}`
  }
  if (goal.kind === 'consistency' && 'targetWeeks' in goal.target) {
    return `${goal.target.targetWeeks}-week streak`
  }
  // Corrupt kind/target pairing (jsonb is only app-validated): stay quiet.
  return 'Goal'
}
