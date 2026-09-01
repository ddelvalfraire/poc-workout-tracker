import { kgToDisplay, type WeightUnit } from '@/lib/units'
import { formatVolume } from '@/lib/format'
import { isSameLocalDay } from '@/lib/local-day'
import type { Line, Message } from '@/lib/message'
import { scheduleAnchorToken, type ScheduleAnchor } from '@/lib/home/schedule-anchor'
import { statusForHome, type HomeState } from '@/lib/home/home-status'

/**
 * The nav drawer's status-line language — every drawer row carries a one-line
 * LIVE fact under its label (the Gentler Streak principle: tell the user
 * their status before they tap). Pure string/number functions so the voice
 * unit-tests as plain functions; the drawer client feeds them the /api/drawer
 * payload. A null return means "no honest fact" — the row degrades to its
 * label (plus the row's own empty-state invitation, decided in the drawer).
 */

/** GET /api/drawer response — every slice independently nullable: a failed or
 *  empty read degrades ONLY its row (the ops degrade contract, applied to
 *  nav). Instants travel as epoch ms for stable JSON serialization; all
 *  local-calendar interpretation happens client-side (lib/local-day.ts). */
export interface DrawerData {
  /** Live session — the hero becomes RESUME (single-active-session guard). */
  resume: { key: string; name: string | null } | null
  /** The up-next program day the hero starts; null when a session is live,
   *  no program is active, or the block just finished. */
  upNext: { dayId: string; dayName: string; week: number; weekdays: number[] } | null
  /** The active program, kept even while a session is live or the block just
   *  finished — the Programs row and the hero's block-complete state read it. */
  program: {
    id: string
    name: string
    week: number
    mesocycleWeeks: number
    blockComplete: boolean
  } | null
  /** Completion instants from the last 48h (epoch ms) — the trained-today
   *  evidence, forked on the LOCAL day client-side like home's StatusHero. */
  recentCompletedAtTimes: number[]
  /** Newest completed session overall — the hero's trained-today receipt and
   *  the drift clock; null on true day one. */
  lastCompleted: { id: string; name: string | null; completedAtMs: number; volumeKg: number } | null
  stats: {
    /** Raw completed sets in the rolling 7×24h window (getVolumeTotals). */
    weekSets: number
    /** Completed sets bucketed into seven rolling 24h blocks, oldest first —
     *  tz-free like volumeWindows('rolling'), honest for a micro-sparkbar. */
    daySets: number[]
  } | null
  goals: {
    activeCount: number
    /** goalLabel() of the top goal, server-rendered in the user's unit. */
    topGoalLabel: string
    /** Strength goals only — % toward target; null renders no bar. */
    percent: number | null
    /** StreakChip evidence (client-computed weeks — local-day principle). */
    streak: {
      completedAtTimes: number[]
      scheduledWeekdays: number[]
      allowedMissesPerWeek: number
    } | null
  } | null
  trophies: { earned: number; newestLabel: string | null } | null
  body: {
    weightKg: number | null
    /** ~7-day bodyweight delta (kg), or null when history can't prove one. */
    deltaKg: number | null
    checkInDue: boolean
    daysSinceLast: number | null
  } | null
  exercises: {
    /** Newest club-family trophy label — the cheap honest PR-ish fact. */
    lastPrLabel: string | null
    loggedCount: number
  } | null
  coach: boolean
  recents: { id: string; name: string | null; startedAtMs: number; volumeKg: number }[]
  unit: WeightUnit
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Sparkbar width — seven rolling 24h blocks (also the bodyweight-delta
 *  window in /api/drawer). */
export const SPARKBAR_DAYS = 7

/** Completed sets bucketed into seven rolling 24h blocks ending now, oldest
 *  first — derived from summaries already fetched (no extra read). Rolling
 *  blocks, not local calendar days: the server can't know the user's day
 *  (lib/local-day.ts), and a tz-free window is honest for a micro-sparkbar.
 *  Shared by /api/drawer and the home momentum panel — one week, one shape. */
export function bucketDaySets(
  summaries: readonly { startedAt: Date; completedAt: Date | null; completedSetCount: number }[],
  now: Date,
): number[] {
  const buckets = new Array<number>(SPARKBAR_DAYS).fill(0)
  for (const workout of summaries) {
    if (workout.completedAt === null) continue
    const age = Math.floor((now.getTime() - workout.startedAt.getTime()) / DAY_MS)
    if (age < 0 || age >= SPARKBAR_DAYS) continue
    buckets[SPARKBAR_DAYS - 1 - age] += workout.completedSetCount
  }
  return buckets
}

/** Catalog keys the drawer's status language resolves to — all under the
 *  `NavDrawer` namespace, which is what renders them. */
export type NavDrawerKey =
  | 'anchor'
  | 'startContext'
  | 'startContextAnchor'
  | 'status.program'
  | 'status.volume'
  | 'status.bodyCheckInDue'
  | 'status.bodyCheckedInToday'
  | 'status.bodyCheckedInDaysAgo'
  | 'status.trophies'
  | 'status.trophiesNewest'
  | 'status.lastPr'
  | 'status.movements'
  | 'day.today'
  | 'day.yesterday'
  | 'day.date'
  | 'hero.contextRest'
  | 'hero.contextBlockComplete'
  | 'untitledWorkout'

export type NavDrawerLine = Line<NavDrawerKey>

/**
 * Which hero the drawer shows — the SAME seven-state brain as home's
 * StatusHero (lib/home-status.ts), fed from the drawer payload, so the two
 * surfaces can never disagree about whether there is a workout to do. Volt
 * belongs only to states with something to start or resume; done-for-today,
 * rest-day and block-complete are quiet. Local-calendar forks inside
 * (trained today? scheduled today?) mean callers run this client-side with
 * the user's clock. The home-only context facts (last-time volume, streak
 * weeks) never change the STATE, so they are passed as unknown.
 */
export function drawerHeroState(data: DrawerData, now: Date): HomeState {
  return statusForHome(
    {
      session: data.resume !== null ? { name: data.resume.name, completedSetCount: 0 } : null,
      nextDay:
        data.program !== null
          ? {
              dayName: data.upNext?.dayName ?? '',
              programName: data.program.name,
              week: data.upNext?.week ?? data.program.week,
              mesocycleWeeks: data.program.mesocycleWeeks,
              weekdays: data.upNext?.weekdays ?? [],
              blockComplete: data.program.blockComplete,
            }
          : null,
      recentCompletedAtTimes: data.recentCompletedAtTimes,
      lastCompleted: data.lastCompleted,
      lastTimeVolumeKg: null,
      streakWeeks: null,
    },
    data.unit,
    now,
  ).state
}

/** Trained-today hero context: "Push A · 8,076 lb" as segments — the session
 *  name (or the untitled fallback) and, when there was load, its volume. */
export function doneContextLine(
  lastCompleted: { name: string | null; volumeKg: number },
  unit: WeightUnit,
): NavDrawerLine[] {
  const segments: NavDrawerLine[] = [
    lastCompleted.name !== null ? { literal: lastCompleted.name } : { key: 'untitledWorkout' },
  ]
  if (lastCompleted.volumeKg > 0) segments.push({ literal: formatVolume(lastCompleted.volumeKg, unit) })
  return segments
}

/** Rest-day hero context: "Next: Legs · tomorrow" — the anchor rides in as a
 *  nested descriptor so the drawer's lowercase anchor words apply. */
export function restContextLine(dayName: string, anchor: ScheduleAnchor): Message<NavDrawerKey> {
  return {
    key: 'hero.contextRest',
    values: {
      day: dayName,
      anchor: { key: 'anchor', values: { anchor: scheduleAnchorToken(anchor) } },
    },
  }
}

/** Block-complete hero context: "Upper/Lower Hybrid · 7 weeks". */
export function blockCompleteContextLine(
  programName: string,
  mesocycleWeeks: number,
): Message<NavDrawerKey> {
  return { key: 'hero.contextBlockComplete', values: { name: programName, weeks: mesocycleWeeks } }
}

/** Hero CTA second line: "Legs · Week 3 · today". The anchor is
 *  scheduleAnchor() computed CLIENT-side (local calendar); null (unscheduled)
 *  drops the segment.
 *
 *  The drawer's copy of the anchor words is lowercased in the CATALOG rather
 *  than by calling toLowerCase() on a rendered word — casing is a per-language
 *  rule (German nouns stay capitalized), so it belongs to the translator. */
export function startContextLine(
  dayName: string,
  week: number,
  anchor: ScheduleAnchor | null,
): Message<NavDrawerKey> {
  return anchor !== null
    ? {
        key: 'startContextAnchor',
        values: {
          day: dayName,
          week,
          anchor: { key: 'anchor', values: { anchor: scheduleAnchorToken(anchor) } },
        },
      }
    : { key: 'startContext', values: { day: dayName, week } }
}

/** "Upper/Lower Hybrid · Wk 3/7" */
export function programStatusLine(
  name: string,
  week: number,
  mesocycleWeeks: number,
): Message<NavDrawerKey> {
  return { key: 'status.program', values: { name, week, total: mesocycleWeeks } }
}

/** Block progress for the thin bar, 0–100 (current week counts as underway). */
export function programProgressPercent(week: number, mesocycleWeeks: number): number {
  if (!(mesocycleWeeks > 0)) return 0
  return Math.max(0, Math.min(100, Math.round((week / mesocycleWeeks) * 100)))
}

/** "42 sets this week"; null at zero — the row invites instead. */
export function volumeStatusLine(weekSets: number): Message<NavDrawerKey> | null {
  if (weekSets <= 0) return null
  return { key: 'status.volume', values: { count: weekSets } }
}

/** Below this ~7-day change (kg) the arrow reads steady, not up/down —
 *  bodyweight noise is larger than scale precision. */
const TREND_DEAD_BAND_KG = 0.2

/** Direction glyph for the body row; null when no delta is provable. */
export function trendArrow(deltaKg: number | null): '↗' | '↘' | '→' | null {
  if (deltaKg === null) return null
  if (deltaKg > TREND_DEAD_BAND_KG) return '↗'
  if (deltaKg < -TREND_DEAD_BAND_KG) return '↘'
  return '→'
}

/** "185 lb ↘ · check-in due" / "185 lb ↗ · last 3d ago" as its segments, in
 *  render order; empty when there is neither a weight nor a due check-in to
 *  report. The weight segment is a LITERAL — a number, a unit and a direction
 *  glyph are data, not copy. */
export function bodyStatusLine(
  body: {
    weightKg: number | null
    deltaKg: number | null
    checkInDue: boolean
    daysSinceLast: number | null
  },
  unit: WeightUnit,
): NavDrawerLine[] {
  const segments: NavDrawerLine[] = []
  if (body.weightKg !== null) {
    const arrow = trendArrow(body.deltaKg)
    segments.push({
      literal: `${kgToDisplay(body.weightKg, unit)} ${unit}${arrow !== null ? ` ${arrow}` : ''}`,
    })
  }
  if (body.checkInDue) segments.push({ key: 'status.bodyCheckInDue' })
  else if (body.daysSinceLast !== null) {
    segments.push(
      body.daysSinceLast === 0
        ? { key: 'status.bodyCheckedInToday' }
        : { key: 'status.bodyCheckedInDaysAgo', values: { days: body.daysSinceLast } },
    )
  }
  return segments
}

/** "12 earned · newest: 315 Squat Club"; null when nothing is earned yet. */
export function trophyStatusLine(
  earned: number,
  newestLabel: string | null,
): Message<NavDrawerKey> | null {
  if (earned <= 0) return null
  return newestLabel !== null
    ? { key: 'status.trophiesNewest', values: { count: earned, newest: newestLabel } }
    : { key: 'status.trophies', values: { count: earned } }
}

/** "Last PR: 315 Squat Club", else "{n} logged movements", else null. */
export function exercisesStatusLine(
  lastPrLabel: string | null,
  loggedCount: number,
): Message<NavDrawerKey> | null {
  if (lastPrLabel !== null) return { key: 'status.lastPr', values: { label: lastPrLabel } }
  if (loggedCount > 0) return { key: 'status.movements', values: { count: loggedCount } }
  return null
}

/** Which day-word an instant gets, relative to the user's calendar. The
 *  branch is the decision; the words (and the date FORMAT, which is
 *  `Intl.DateTimeFormat` under the reader's locale, never a fixed 'en-US')
 *  belong to the renderer. */
function relativeDay(atMs: number, now: Date): { kind: 'today' | 'yesterday' } | { kind: 'date' } {
  const at = new Date(atMs)
  if (isSameLocalDay(at, now)) return { kind: 'today' }
  const dayBefore = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  return isSameLocalDay(at, dayBefore) ? { kind: 'yesterday' } : { kind: 'date' }
}

/** "Today" / "Yesterday" / "Aug 26" — LOCAL calendar words, so callers must
 *  run this client-side with the user's clock (local-day.ts principle). */
export function relativeDayMessage(atMs: number, now: Date): Message<NavDrawerKey> {
  const day = relativeDay(atMs, now)
  if (day.kind === 'today') return { key: 'day.today' }
  if (day.kind === 'yesterday') return { key: 'day.yesterday' }
  // The date renders through ICU (`{date, date, ::MMMd}`), so the month
  // abbreviation and the field order follow the reader's locale.
  return { key: 'day.date', values: { date: new Date(atMs) } }
}

/** English-only day words, kept for `components/notes/note-view.ts` until the
 *  notes view rows are migrated to descriptors of their own. Do not add new
 *  callers — use `relativeDayMessage`. */
export function relativeDayLabel(atMs: number, now: Date): string {
  const day = relativeDay(atMs, now)
  if (day.kind === 'today') return 'Today'
  if (day.kind === 'yesterday') return 'Yesterday'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(atMs))
}

/** RECENT row status: "Yesterday · 8,076 lb" as its segments (zero volume
 *  drops out). The volume is a formatted number — data, not copy. */
export function recentWorkoutLine(
  recent: { startedAtMs: number; volumeKg: number },
  unit: WeightUnit,
  now: Date,
): NavDrawerLine[] {
  const segments: NavDrawerLine[] = [relativeDayMessage(recent.startedAtMs, now)]
  if (recent.volumeKg > 0) segments.push({ literal: formatVolume(recent.volumeKg, unit) })
  return segments
}

/** Whether a nav href owns the current pathname: exact match or a sub-route
 *  ("/programs/abc" lights Programs). "/" matches only itself — every path
 *  starts with it. */
export function isActiveRoute(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}
