import { kgToDisplay, type WeightUnit } from '@/lib/units'
import { formatVolume } from '@/lib/format'
import { isSameLocalDay } from '@/lib/local-day'

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
  program: { name: string; week: number; mesocycleWeeks: number } | null
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

/** Hero CTA second line: "Legs · Week 3 · today". The anchor is
 *  scheduleAnchor() computed CLIENT-side (local calendar) and lowercased into
 *  the sub-line voice; null anchor (unscheduled) drops the segment. */
export function startContextLine(dayName: string, week: number, anchor: string | null): string {
  const parts = [dayName, `Week ${week}`]
  if (anchor !== null) parts.push(anchor.toLowerCase())
  return parts.join(' · ')
}

/** "Upper/Lower Hybrid · Wk 3/7" */
export function programStatusLine(name: string, week: number, mesocycleWeeks: number): string {
  return `${name} · Wk ${week}/${mesocycleWeeks}`
}

/** Block progress for the thin bar, 0–100 (current week counts as underway). */
export function programProgressPercent(week: number, mesocycleWeeks: number): number {
  if (!(mesocycleWeeks > 0)) return 0
  return Math.max(0, Math.min(100, Math.round((week / mesocycleWeeks) * 100)))
}

/** "42 sets this week"; null at zero — the row invites instead. */
export function volumeStatusLine(weekSets: number): string | null {
  if (weekSets <= 0) return null
  return `${weekSets} ${weekSets === 1 ? 'set' : 'sets'} this week`
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

/** "185 lb ↘ · check-in due" / "185 lb ↗ · last 3d ago"; null when there is
 *  neither a weight nor a due check-in to report. */
export function bodyStatusLine(
  body: {
    weightKg: number | null
    deltaKg: number | null
    checkInDue: boolean
    daysSinceLast: number | null
  },
  unit: WeightUnit,
): string | null {
  const weight =
    body.weightKg !== null
      ? [`${kgToDisplay(body.weightKg, unit)} ${unit}`, trendArrow(body.deltaKg)]
          .filter((p): p is string => p !== null)
          .join(' ')
      : null
  const checkIn = body.checkInDue
    ? 'check-in due'
    : body.daysSinceLast !== null
      ? body.daysSinceLast === 0
        ? 'checked in today'
        : `last ${body.daysSinceLast}d ago`
      : null
  const parts = [weight, checkIn].filter((p): p is string => p !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** "12 earned · newest: 315 Squat Club"; null when nothing is earned yet. */
export function trophyStatusLine(earned: number, newestLabel: string | null): string | null {
  if (earned <= 0) return null
  return newestLabel !== null ? `${earned} earned · newest: ${newestLabel}` : `${earned} earned`
}

/** "Last PR: 315 Squat Club", else "{n} logged movements", else null. */
export function exercisesStatusLine(
  lastPrLabel: string | null,
  loggedCount: number,
): string | null {
  if (lastPrLabel !== null) return `Last PR: ${lastPrLabel}`
  if (loggedCount > 0) {
    return `${loggedCount} logged ${loggedCount === 1 ? 'movement' : 'movements'}`
  }
  return null
}

// en-US matches formatWorkoutDate — one locale for all date display.
const recentDayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

/** "Today" / "Yesterday" / "Aug 26" — LOCAL calendar words, so callers must
 *  run this client-side with the user's clock (local-day.ts principle). */
export function relativeDayLabel(atMs: number, now: Date): string {
  const at = new Date(atMs)
  if (isSameLocalDay(at, now)) return 'Today'
  const dayBefore = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (isSameLocalDay(at, dayBefore)) return 'Yesterday'
  return recentDayFormat.format(at)
}

/** RECENT row status: "Yesterday · 8,076 lb" (zero volume drops out). */
export function recentWorkoutLine(
  recent: { startedAtMs: number; volumeKg: number },
  unit: WeightUnit,
  now: Date,
): string {
  const parts = [relativeDayLabel(recent.startedAtMs, now)]
  if (recent.volumeKg > 0) parts.push(formatVolume(recent.volumeKg, unit))
  return parts.join(' · ')
}

/** Whether a nav href owns the current pathname: exact match or a sub-route
 *  ("/programs/abc" lights Programs). "/" matches only itself — every path
 *  starts with it. */
export function isActiveRoute(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}
