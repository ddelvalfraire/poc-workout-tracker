import type { WeightUnit } from '@/lib/units'

/**
 * The neutral shape both CSV parsers (strong.ts / hevy.ts) emit — everything
 * downstream (plan, preview, commit) speaks THIS, never a source format.
 * Dates are ISO strings (not Date) because a ParsedImport round-trips through
 * JSON: it's cached server-side between preview and confirm.
 */

export const IMPORT_SOURCES = ['strong', 'hevy'] as const
export type ImportSource = (typeof IMPORT_SOURCES)[number]

/** Narrows untrusted input (cached payloads) to an ImportSource. */
export function isImportSource(value: unknown): value is ImportSource {
  return (IMPORT_SOURCES as readonly unknown[]).includes(value)
}

/** One performed set. Imports carry only performed work, so completed is
 *  always true — these apps don't export planned/unfinished sets. */
export interface ParsedSet {
  reps: number | null
  /** Canonical kg — unit resolution happened in the parser. */
  weightKg: number | null
  /** Warm-up markers map to 'warmup' (never scores); Hevy failure/dropset
   *  collapse to 'working' — they're performed working sets. */
  setType: 'working' | 'warmup'
  /** 'duration' when the row is a timed set (seconds, no reps). */
  metricMode: 'reps_weight' | 'duration'
  durationSec: number | null
  completed: true
}

export interface ParsedExercise {
  /** Verbatim source name — matching happens later (match.ts). */
  name: string
  notes?: string
  sets: ParsedSet[]
}

export interface ParsedWorkout {
  name?: string
  /** Wall time from the file, ISO-serialized as UTC (v1: no timezone
   *  reconciliation — day-level precision is what stats need). */
  startedAt: string
  /** startedAt + duration / end_time, clamped to ≤ 6h after startedAt. */
  completedAt: string
  notes?: string
  exercises: ParsedExercise[]
}

/** A row the parser refused, with the 1-based CSV line and an honest reason. */
export interface SkippedRow {
  row: number
  reason: string
}

export interface ParsedImport {
  source: ImportSource
  /** The unit set weights were read in: header-declared (Hevy) or
   *  caller-supplied (Strong, which carries no unit column). */
  sourceUnit: WeightUnit
  workouts: ParsedWorkout[]
  skipped: SkippedRow[]
  /** File-level caveats for the preview (supersets dropped, RPE dropped, …). */
  warnings: string[]
}

/** Spans longer than this are implausible session lengths; completedAt clamps
 *  to startedAt + 6h (the formatWorkoutDuration plausibility rule). */
export const MAX_SESSION_SEC = 6 * 60 * 60

/**
 * Deterministic wall-time parser: the file's clock digits are preserved
 * verbatim into a UTC Date, regardless of the server's timezone (new Date()
 * on a zone-less string would shift by server offset). Accepts:
 *   "2024-01-15 17:32:11" / "2024-01-15T17:32" (Strong, ISO-ish)
 *   "15 Jan 2024, 17:32" (Hevy)
 * Returns null on anything else — callers skip the row with a reason.
 */
export function parseWallTime(raw: string): Date | null {
  const value = raw.trim()

  const isoLike = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value)
  if (isoLike) {
    const [, y, mo, d, h, mi, s] = isoLike
    return utcDate(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? '0'))
  }

  const dayFirst = /^(\d{1,2}) ([A-Za-z]{3,9}),? (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(
    value,
  )
  if (dayFirst) {
    const [, d, monthName, y, h, mi, s] = dayFirst
    const month = MONTHS[monthName.slice(0, 3).toLowerCase()]
    if (month === undefined) return null
    return utcDate(Number(y), month + 1, Number(d), Number(h), Number(mi), Number(s ?? '0'))
  }

  return null
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

/** Builds a UTC Date from wall-clock parts, rejecting out-of-range values
 *  (Date.UTC would silently roll "2024-13-45" into a real date). */
function utcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour > 23 || minute > 59 || second > 59) return null
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  // Reject rollovers (e.g. Feb 30 → Mar 1): the built date must echo its parts.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date
}
