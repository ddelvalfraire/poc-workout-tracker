import { MAX_RELIABLE_REPS } from '@/lib/one-rep-max'
import type {
  ExerciseWeekPoint,
  ProgramWeekStats,
  ProgramExercisePR,
  ProgramExercisePRPoint,
  ProgramExerciseProgression,
} from '@/db/program-stats'
import type { VolumeWeek } from '@/db/volume-progression'
import type { VolumeGroup } from '@/db/muscle-volume'
import type { MuscleVerdict } from '@/lib/volume-progression'

/**
 * Pure view logic for the program stats page — kept free of JSX so it
 * unit-tests as plain functions (same convention as ../week-view).
 * Everything stays in the kg domain; display conversion happens in the
 * page's format helpers.
 */

/** A week is "all-zero" when nothing was even started — a week with only an
 *  empty started workout still shows (started counts). */
function isZeroWeek(w: ProgramWeekStats): boolean {
  return w.daysStarted === 0 && w.completedSets === 0
}

/**
 * The weeks worth rendering: trims trailing all-zero future weeks (an
 * untouched 7-week block shouldn't render 7 empty rows) but never below
 * `currentWeek`, and always keeps any later week that carries data (manual
 * overshoot included). Returns a new array; relies on the data layer's
 * materialized 1..N shape (`weeks[i].week === i + 1`).
 */
export function visibleWeeks(
  weeks: readonly ProgramWeekStats[],
  currentWeek: number,
): ProgramWeekStats[] {
  let last = weeks.length
  while (last > currentWeek && isZeroWeek(weeks[last - 1])) last--
  return weeks.slice(0, last)
}

/**
 * A week's volume bar width as a whole percent of the block's max tonnage.
 * A zero max (machine-only or empty block) yields 0, never NaN/Infinity.
 */
export function volumeBarWidthPct(tonnageKg: number, maxTonnageKg: number): number {
  if (maxTonnageKg <= 0) return 0
  return Math.round((tonnageKg / maxTonnageKg) * 100)
}

/** Whether the block has any training at all — false drives the whole-page
 *  teach empty state. Started days count even before any set completes. */
export function hasAnyTraining(weeks: readonly ProgramWeekStats[]): boolean {
  return weeks.some((w) => !isZeroWeek(w))
}

/** The block's e1RM gain for one exercise, kg (0 for a single scored week —
 *  baseline and best are the same point). Never negative: best ≥ baseline
 *  by construction. */
export function prDeltaKg(pr: ProgramExercisePR): number {
  return pr.best.e1rm - pr.baseline.e1rm
}

/** Whether a PR endpoint's estimate came from a rep count past the reliable
 *  Epley range — the UI flags these rather than presenting them as solid. */
export function isHighRepEstimate(point: ProgramExercisePRPoint): boolean {
  return point.reps > MAX_RELIABLE_REPS
}

/**
 * Adherence over the COMPLETED portion of the block: Σ daysCompleted / Σ
 * plannedDays across weeks 1..currentWeek−1 as a whole percent. The current,
 * partial week is excluded — an honest Tuesday must not read as slacking.
 * Null when there's nothing behind you yet (week 1, or a dayless program) —
 * that's the early-block signal, not a zero.
 */
export function blockAdherencePct(
  weeks: readonly ProgramWeekStats[],
  currentWeek: number,
): number | null {
  let done = 0
  let planned = 0
  for (const w of weeks) {
    if (w.week >= currentWeek) continue
    done += w.daysCompleted
    planned += w.plannedDays
  }
  if (planned <= 0) return null
  return Math.round((done / planned) * 100)
}

/**
 * Week-over-week tonnage direction across the last two TRAINED completed
 * weeks (untrained gaps skipped — a vacation week is absence, not a crash).
 * −1 / 0 / +1, or null with fewer than two trained prior weeks.
 */
export function volumeTrendSign(
  weeks: readonly ProgramWeekStats[],
  currentWeek: number,
): number | null {
  const trained = weeks.filter((w) => w.week < currentWeek && !isZeroWeek(w))
  if (trained.length < 2) return null
  return Math.sign(
    trained[trained.length - 1].tonnageKg - trained[trained.length - 2].tonnageKg,
  )
}

/** The verdict hero's two lines (CSS uppercases the headline). */
export interface ProgramVerdict {
  headline: string
  context: string
}

/**
 * The block's status told in words — a digest of PR count, adherence, and
 * the volume trend sign (all already computed for the sections below).
 * Copy table:
 *   nothing behind you yet → "Early days."       + teach line
 *   any real e1RM gain     → "Getting stronger." + "N lifts up · X% of planned days trained"
 *   otherwise              → "Showing up."       + "X% of planned days trained"
 * A non-flat volume trend appends "· volume up/down week over week". The
 * context always carries the honest percentage — the headline motivates, the
 * sentence informs.
 */
export function programVerdict(
  weeks: readonly ProgramWeekStats[],
  currentWeek: number,
  prCount: number,
): ProgramVerdict {
  const adherence = blockAdherencePct(weeks, currentWeek)
  if (adherence === null) {
    return { headline: 'Early days.', context: 'The block picture builds as you train.' }
  }
  const trend = volumeTrendSign(weeks, currentWeek)
  const trendSuffix =
    trend === null || trend === 0
      ? ''
      : ` · volume ${trend > 0 ? 'up' : 'down'} week over week`
  const adherenceText = `${adherence}% of planned days trained`
  if (prCount > 0) {
    return {
      headline: 'Getting stronger.',
      context: `${prCount} ${prCount === 1 ? 'lift' : 'lifts'} up this block · ${adherenceText}${trendSuffix}`,
    }
  }
  return { headline: 'Showing up.', context: `${adherenceText}${trendSuffix}` }
}

/** One plotted sparkline point (viewBox coordinates, 1dp). */
export interface SparklinePoint {
  week: number
  x: number
  y: number
  /** Set a NEW running max that week — the volt dot. The baseline point is
   *  never marked: being first isn't an achievement. */
  isRunningMax: boolean
}

/** Stroke/dot allowance so extreme points aren't clipped at the svg edge. */
const SPARKLINE_INSET = 3

/**
 * A tiny e1RM-over-weeks sparkline for one exercise: x is the WEEK NUMBER
 * (time-true across the observed span — a skipped week leaves a visible gap
 * in slope), y the min–max-normalized e1RM. Only e1rm-scorable weeks plot;
 * null with fewer than two (one point is a dot, not a trend — the share-card
 * rule). Coordinates round to 1dp; a flat series draws the midline.
 */
export function e1rmSparkline(
  weeks: readonly ExerciseWeekPoint[],
  width: number,
  height: number,
): { path: string; points: SparklinePoint[] } | null {
  const scored = weeks.flatMap((w) =>
    w.best?.kind === 'e1rm' ? [{ week: w.week, e1rm: w.best.e1rm }] : [],
  )
  if (scored.length < 2) return null
  const minWeek = scored[0].week
  const maxWeek = scored[scored.length - 1].week
  const values = scored.map((p) => p.e1rm)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  const innerWidth = width - SPARKLINE_INSET * 2
  const innerHeight = height - SPARKLINE_INSET * 2
  const round1 = (n: number) => Math.round(n * 10) / 10

  let runningMax = scored[0].e1rm
  const points = scored.map((p) => {
    const isRunningMax = p.e1rm > runningMax
    if (isRunningMax) runningMax = p.e1rm
    return {
      week: p.week,
      x: round1(SPARKLINE_INSET + ((p.week - minWeek) / (maxWeek - minWeek)) * innerWidth),
      y:
        range === 0
          ? round1(height / 2)
          : round1(SPARKLINE_INSET + (1 - (p.e1rm - min) / range) * innerHeight),
      isRunningMax,
    }
  })
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  return { path, points }
}

/** The muscle chip's status word (CSS handles emphasis; volt is reserved for
 *  on-track — the quiet good state, per the volume-progression plan). */
export function volumeStatusLabel(status: MuscleVerdict['status']): string {
  switch (status) {
    case 'increase':
      return '+1 earned'
    case 'hold':
      return 'hold'
    case 'on-track':
      return 'on track'
  }
}

/**
 * The tier-2 evidence sentence: WHO drove the verdict, in words. Null for
 * on-track (nothing to explain — the trend below is the content).
 */
export function volumeDriversLine(verdict: MuscleVerdict): string | null {
  if (verdict.drivers.length === 0) return null
  const names = verdict.drivers.join(', ')
  if (verdict.status === 'increase') {
    return `${names} beat top of range 2 weeks running`
  }
  if (verdict.status === 'hold') {
    return `${names} stalled — hold volume while recovery catches up`
  }
  return null
}

/**
 * One muscle's per-week credited-set series, ascending — the trend (last
 * `limit` weeks) and the per-week table both read from this. Weeks with zero
 * credited sets for the muscle are kept: an untrained week is a fact.
 */
export function muscleWeekSeries(
  weeks: readonly VolumeWeek[],
  group: VolumeGroup,
  limit?: number,
): { week: number; sets: number }[] {
  const series = weeks.map((w) => ({
    week: w.week,
    sets: w.groups.find((g) => g.group === group)?.sets ?? 0,
  }))
  return limit !== undefined ? series.slice(-limit) : series
}

/** Credited set counts render halves honestly ("7.5") and integers bare. */
export function formatCreditedSets(sets: number): string {
  return Number.isInteger(sets) ? String(sets) : sets.toFixed(1)
}

/**
 * The block's biggest wins: exercises with a real e1RM gain (pr present AND
 * delta > 0 — a single-week baseline is not a gain), sorted by gain
 * descending, capped at `count`. Feeds the completion card, which needs the
 * exercise name plus both PR endpoints — hence full rows, not bare deltas.
 */
export function topPRs(
  exercises: readonly ProgramExerciseProgression[],
  count: number,
): (ProgramExerciseProgression & { pr: ProgramExercisePR })[] {
  return exercises
    .filter(
      (e): e is ProgramExerciseProgression & { pr: ProgramExercisePR } =>
        e.pr !== null && prDeltaKg(e.pr) > 0,
    )
    .sort((a, b) => prDeltaKg(b.pr) - prDeltaKg(a.pr))
    .slice(0, count)
}
