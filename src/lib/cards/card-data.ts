import type { ExerciseAllTimeStats } from '@/db/exercise-stats'
import type { TrophyRow } from '@/db/trophies'
import { formatWorkoutDuration } from '@/lib/format'
import {
  trophyContextLine,
  trophyLabel,
  type TrophyContextMessage,
  type TrophyLabelMessage,
} from '@/lib/trophies'
import { TROPHY_KINDS, type TrophyKind } from '@/lib/trophy-kinds'
import { kgToDisplay, type WeightUnit } from '@/lib/units'

/**
 * Pure data mappers for the /api/cards/* share images: rows in, card copy
 * out. The routes own auth + loading; everything here is testable without a
 * database. Copy discipline (the PRD's hard lines): numbers in the USER'S
 * unit, dates coarse (month/year only), and no body data can even arrive —
 * the input types carry none.
 */

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

/** Coarse card date — "Aug 2026". Cards leave the app; day precision stays in. */
export function formatCardMonthYear(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(date)
}

/** Narrows an untrusted route param to a TrophyKind. */
export function isTrophyKind(value: string): value is TrophyKind {
  return (TROPHY_KINDS as readonly string[]).includes(value)
}

export interface TrophyCardData {
  /** The trophy's name — the card's headline ("315 Squat Club"). */
  title: string
  /** Fact + coarse date ("e1RM 317 lb · Aug 2026"), or just the date when the
   *  kind records no number (block_complete). */
  context: string
}

/**
 * Card data for the user's EARNED trophy of `kindParam`, or null when the
 * param isn't a kind or the trophy isn't earned — the route collapses both
 * into one constant-shape 404 (an unknown kind and an unearned one must be
 * indistinguishable to a probing client).
 */
/**
 * Renders a `Trophies` descriptor. A card is an IMAGE — the words have to be
 * resolved before it rasterizes — so the route hands its own translator in
 * rather than this mapper reaching for one; that keeps the mapper testable
 * without a request and lets the test feed the real catalog.
 */
export type RenderTrophyMessage = (message: TrophyLabelMessage | TrophyContextMessage) => string

export function trophyCardData(
  rows: readonly TrophyRow[],
  kindParam: string,
  unit: WeightUnit,
  render: RenderTrophyMessage,
): TrophyCardData | null {
  if (!isTrophyKind(kindParam)) return null
  const row = rows.find((r) => r.kind === kindParam)
  if (!row) return null
  const fact = trophyContextLine(row, unit)
  const date = formatCardMonthYear(row.achievedAt)
  return {
    title: render(trophyLabel(row.kind)),
    context: fact === null ? date : `${render(fact)} · ${date}`,
  }
}

/** The completed-session facts the workout card reads (weights kg). */
export interface WorkoutCardInput {
  name: string | null
  startedAt: Date
  completedAt: Date | null
  exercises: readonly { sets: readonly { reps: number | null; weight: number | null }[] }[]
}

export interface WorkoutCardData {
  /** The session's name — the card headline. */
  title: string
  /** The one big volt number: total volume, or the set count when no set
   *  carried a load (BW / machine-max sessions still get their moment). */
  value: string
  unitLabel: string
  /** Remaining facts + coarse date ("18 sets · 42 min · Aug 2026"). */
  context: string
}

/** Card data for a COMPLETED workout, or null for one still in progress —
 *  the route collapses missing and unfinished into one constant 404. */
export function workoutCardData(
  workout: WorkoutCardInput,
  unit: WeightUnit,
): WorkoutCardData | null {
  if (workout.completedAt === null) return null
  const totalSets = workout.exercises.reduce((n, e) => n + e.sets.length, 0)
  const volumeKg = workout.exercises.reduce(
    (sum, e) => sum + e.sets.reduce((s, set) => s + (set.reps ?? 0) * (set.weight ?? 0), 0),
    0,
  )
  const setsText = `${totalSets} ${totalSets === 1 ? 'set' : 'sets'}`
  const duration = formatWorkoutDuration(workout.startedAt, workout.completedAt)
  const date = formatCardMonthYear(workout.startedAt)
  const hasVolume = volumeKg > 0
  const context = [hasVolume ? setsText : null, duration, date]
    .filter((part): part is string => part !== null)
    .join(' · ')
  return {
    title: workout.name ?? 'Workout',
    value: hasVolume
      ? Math.round(kgToDisplay(volumeKg, unit)).toLocaleString('en-US')
      : String(totalSets),
    unitLabel: hasVolume ? unit : totalSets === 1 ? 'set' : 'sets',
    context,
  }
}

export interface PrCardData {
  exerciseName: string
  /** Best e1RM in the display unit, already rounded ("317"-style number text). */
  value: string
  unit: WeightUnit
  /** Coarse date of the record session. */
  dateText: string
}

/** Card data for the exercise's best-e1RM PR, or null when there's no
 *  completed history or no e1RM-scorable record to brag about. */
export function prCardData(
  stats: ExerciseAllTimeStats | null,
  unit: WeightUnit,
): PrCardData | null {
  const best = stats?.records.bestE1rm ?? null
  if (stats === null || best === null) return null
  return {
    exerciseName: stats.exercise.name,
    value: String(kgToDisplay(best.e1rm, unit)),
    unit,
    dateText: formatCardMonthYear(best.performedAt),
  }
}

export interface TrendCardData {
  exerciseName: string
  /** "315 → 340 lb" — first session's e1RM to the all-time best, display unit. */
  headline: string
  /** "in 8 weeks" — first session to the best session (whole trend span when
   *  the series never beat session one). */
  subline: string
  /** The full e1RM series in the display unit — the sparkline's values. */
  values: number[]
}

/**
 * Card data for the e1RM trend story, or null when fewer than two scorable
 * sessions exist (one point is a dot, not a trend — same rule as the stats
 * page's chart).
 */
export function trendCardData(
  stats: ExerciseAllTimeStats | null,
  unit: WeightUnit,
): TrendCardData | null {
  if (stats === null || stats.trend.length < 2) return null
  const { trend } = stats
  const first = trend[0]
  // Strictly-greater keeps ties on the earliest session (records-board policy).
  let best = first
  for (const point of trend) {
    if (point.e1rm > best.e1rm) best = point
  }
  // The span the headline covers: to the best session — or across the whole
  // series when session one was never beaten (a flat/declining story is still
  // an honest one; "in 0 weeks" is not).
  const end = best.e1rm > first.e1rm ? best.performedAt : trend[trend.length - 1].performedAt
  const weeks = Math.max(1, Math.round((end.getTime() - first.performedAt.getTime()) / MS_PER_WEEK))
  return {
    exerciseName: stats.exercise.name,
    headline: `${kgToDisplay(first.e1rm, unit)} → ${kgToDisplay(best.e1rm, unit)} ${unit}`,
    subline: `in ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`,
    values: trend.map((point) => kgToDisplay(point.e1rm, unit)),
  }
}

/** Stroke allowance so min/max points aren't clipped at the svg edge. */
const SPARKLINE_INSET = 6

/**
 * An SVG path ("M x y L x y …") plotting `values` left-to-right across a
 * `width`×`height` box, min–max normalized with a stroke inset. A flat series
 * draws the horizontal midline. Coordinates round to 1dp.
 */
export function sparklinePath(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  const innerHeight = height - SPARKLINE_INSET * 2
  const step = values.length > 1 ? width / (values.length - 1) : 0
  const round1 = (n: number) => Math.round(n * 10) / 10
  return values
    .map((value, index) => {
      const x = round1(index * step)
      const y =
        range === 0
          ? round1(height / 2)
          : round1(SPARKLINE_INSET + (1 - (value - min) / range) * innerHeight)
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')
}
