import { isSameLocalDay } from '@/lib/local-day'
import { scheduleAnchor, scheduleAnchorToken, type ScheduleAnchor } from '@/lib/schedule-anchor'
import { formatVolume } from '@/lib/format'
import type { Line, Message } from '@/lib/message'
import type { WeightUnit } from '@/lib/units'

/**
 * The home page's STATUS zone brain — one pure function digesting the page's
 * already-fetched facts into an editorial headline + context sentence (the
 * Gentler Streak move: tell the user where they stand, in words). The status
 * NEVER vanishes; it CHANGES: trained-today is a state here, not a gate that
 * removes the hero (the "no hero card on my app" bug class).
 *
 * Local-calendar questions (trained today? how many days off?) live in here,
 * so every caller must be a client component running after mount with the
 * user's clock (lib/local-day.ts) — the server's "today" is not the user's.
 */

/** Days without a session before the status turns to drifting. Below it a
 *  scheduled off-day reads as an earned REST DAY, not a lapse. */
export const DRIFT_THRESHOLD_DAYS = 4

export interface HomeStatusFacts {
  /** The live session (resolveActiveSession) — wins over every other state. */
  session: { name: string | null; completedSetCount: number } | null
  /** The active program's up-next day, or null when no program is active. */
  nextDay: {
    dayName: string
    programName: string
    week: number
    mesocycleWeeks: number
    /** Weekday schedule 0–6 Sunday-first; empty = unscheduled (always due). */
    weekdays: number[]
    blockComplete: boolean
  } | null
  /** Recent completion instants (epoch ms) — the trained-today evidence.
   *  The server sends a 48h window; the local-day fork happens here. */
  recentCompletedAtTimes: number[]
  /** Newest completed workout overall, or null on true day one. */
  lastCompleted: { name: string | null; completedAtMs: number; volumeKg: number } | null
  /** Newest completed volume under the up-next day's name — the honest
   *  "last time" fact derivable from summaries already in memory. Null when
   *  no matching session exists (the context stays week-only). */
  lastTimeVolumeKg: number | null
  /** Client-computed consistency streak weeks; null/0 = nothing to protect. */
  streakWeeks: number | null
}

export type HomeState =
  | 'session-live'
  | 'trained-today'
  | 'block-complete'
  | 'program-due'
  | 'rest-day'
  | 'drifting'
  | 'fresh'

/** Catalog keys the hero's three lines can resolve to — every one of them
 *  lives under the `StatusHero` namespace, which is what renders them. */
export type StatusHeroKey =
  | 'eyebrow.live'
  | 'eyebrow.logged'
  | 'eyebrow.blockComplete'
  | 'eyebrow.upNext'
  | 'headline.live'
  | 'headline.done'
  | 'headline.due'
  | 'headline.dueSelfNamed'
  | 'headline.rest'
  | 'headline.drifting'
  | 'headline.ready'
  | 'headline.dayOne'
  | 'context.live'
  | 'context.trained'
  | 'context.trainedVolume'
  | 'context.blockWeeks'
  | 'context.week'
  | 'context.weekWithLastTime'
  | 'context.streak'
  | 'context.driftNext'
  | 'context.driftFallback'
  | 'context.rest'
  | 'context.freshReturning'
  | 'context.freshDayOne'
  | 'anchor'
  | 'lastSession'
  | 'unnamedSession'
  | 'untitledWorkout'

export type StatusHeroLine = Line<StatusHeroKey>

export interface HomeStatus {
  state: HomeState
  /** Small line above the headline (volt for live/achievement states); null =
   *  none. A literal here is a fact in the user's own words — the program's
   *  name, or the schedule anchor — not copy waiting for a translation. */
  eyebrow: StatusHeroLine | null
  /** The poster line — rendered in font-display caps by the hero. */
  headline: StatusHeroLine
  context: StatusHeroLine
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole LOCAL calendar days between an instant and now (23:59 → 00:01 is 1).
 *  Midnight-anchored subtraction, not ms division on the raw instants — the
 *  same day-boundary honesty as isSameLocalDay. */
export function localDayDiff(fromMs: number, now: Date): number {
  const from = new Date(fromMs)
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}

/** "Push" → "Push day." / "Leg Day" → "Leg Day." — never a stuttered
 *  "Leg Day day". The DECISION (does the name already end in "day"?) is what
 *  belongs here; both renderings are catalog messages, because the same fork
 *  is a different rule in every language. */
export function dueHeadline(dayName: string): Message<StatusHeroKey> {
  const name = dayName.trim()
  return /(^|\s)day$/i.test(name)
    ? { key: 'headline.dueSelfNamed', values: { day: name } }
    : { key: 'headline.due', values: { day: name } }
}

/** Catalog keys for the momentum panel's sublines — rendered by
 *  `MomentumPanel`, so they resolve against that namespace. */
export type MomentumKey = 'sessionsLine' | 'weekDeltaLevel' | 'weekDeltaUp' | 'weekDeltaDown'

/** The momentum panel's sessions subline: "3 sessions this week". */
export function momentumSessionsLine(count: number): Message<MomentumKey> {
  return { key: 'sessionsLine', values: { count } }
}

/** The lg momentum panel's week-over-week line ("Up 8 on last week").
 *  Null when last week logged nothing — a comparison against an empty
 *  window reads as noise (a brand-new user's first week isn't "up"),
 *  so silence over a hollow number. Counts are working sets, both from
 *  the rolling-window totals already fetched for the panel. */
export function momentumWeekDeltaLine(
  currentSets: number,
  previousSets: number,
): Message<MomentumKey> | null {
  if (previousSets === 0) return null
  const delta = currentSets - previousSets
  if (delta === 0) return { key: 'weekDeltaLevel' }
  return delta > 0
    ? { key: 'weekDeltaUp', values: { delta } }
    : { key: 'weekDeltaDown', values: { delta: -delta } }
}

/** The anchor's WORDS, as a nested descriptor. The hero owns its own copy of
 *  them (docs/I18N-KEYS.md §4) — the drawer renders the same anchor
 *  lowercased into its sub-line voice, which a shared key could not do. */
function anchorLine(anchor: ScheduleAnchor): Message<StatusHeroKey> {
  return { key: 'anchor', values: { anchor: scheduleAnchorToken(anchor) } }
}

function driftingStatus(
  facts: HomeStatusFacts,
  daysSince: number,
  nextLine: StatusHeroLine | null,
): HomeStatus {
  // Warm by contract (never guilt-toned): the headline states the fact, the
  // context offers the stake (streak) or the way back in — nothing scolds.
  const name = facts.lastCompleted?.name
  const context: StatusHeroLine =
    facts.streakWeeks !== null && facts.streakWeeks > 0
      ? { key: 'context.streak', values: { weeks: facts.streakWeeks } }
      : (nextLine ?? { key: 'context.driftFallback' })
  return {
    state: 'drifting',
    eyebrow: null,
    headline: {
      key: 'headline.drifting',
      values: { days: daysSince, session: name ?? { key: 'lastSession' } },
    },
    context,
  }
}

export function statusForHome(facts: HomeStatusFacts, unit: WeightUnit, now: Date): HomeStatus {
  const { session, nextDay, lastCompleted } = facts

  // Priority order IS the product: live > done-today > block payoff > the
  // program's answer > drift > fresh. Each state owns the screen alone.
  if (session !== null) {
    return {
      state: 'session-live',
      eyebrow: { key: 'eyebrow.live' },
      headline: { key: 'headline.live' },
      context: {
        key: 'context.live',
        values: {
          name: session.name ?? { key: 'unnamedSession' },
          sets: session.completedSetCount,
        },
      },
    }
  }

  const trainedToday = facts.recentCompletedAtTimes.some((t) => isSameLocalDay(new Date(t), now))
  if (trainedToday) {
    // PR counts aren't in the home reads (spike §5), so the fallback phrase
    // stands in whenever the volume fact is missing — never an empty slot.
    const name = lastCompleted?.name ?? { key: 'untitledWorkout' as const }
    const volume =
      lastCompleted !== null && lastCompleted.volumeKg > 0
        ? formatVolume(lastCompleted.volumeKg, unit)
        : null
    return {
      state: 'trained-today',
      eyebrow: { key: 'eyebrow.logged' },
      headline: { key: 'headline.done' },
      context:
        volume !== null
          ? { key: 'context.trainedVolume', values: { name, volume } }
          : { key: 'context.trained', values: { name } },
    }
  }

  if (nextDay?.blockComplete) {
    return {
      state: 'block-complete',
      eyebrow: { key: 'eyebrow.blockComplete' },
      headline: { literal: nextDay.programName },
      context: { key: 'context.blockWeeks', values: { weeks: nextDay.mesocycleWeeks } },
    }
  }

  const daysSince = lastCompleted !== null ? localDayDiff(lastCompleted.completedAtMs, now) : null

  if (nextDay !== null) {
    const anchor = scheduleAnchor(nextDay.weekdays, now)
    // Unscheduled programs are always "due" — the pre-schedule "Up next"
    // semantics; scheduled ones are due only on their local calendar day.
    // Branching on the KIND, never on the word: an anchor compared as a
    // display string stops matching the moment the copy is translated, and
    // the hero would silently take the wrong branch.
    if (anchor === null || anchor.kind === 'today') {
      const week = { week: nextDay.week, total: nextDay.mesocycleWeeks }
      const hasLastTime = facts.lastTimeVolumeKg !== null && facts.lastTimeVolumeKg > 0
      return {
        state: 'program-due',
        eyebrow: anchor !== null ? anchorLine(anchor) : { key: 'eyebrow.upNext' },
        headline: dueHeadline(nextDay.dayName),
        context: hasLastTime
          ? {
              key: 'context.weekWithLastTime',
              values: { ...week, volume: formatVolume(facts.lastTimeVolumeKg ?? 0, unit) },
            }
          : { key: 'context.week', values: week },
      }
    }
    if (daysSince !== null && daysSince >= DRIFT_THRESHOLD_DAYS) {
      return driftingStatus(facts, daysSince, {
        key: 'context.driftNext',
        values: { day: nextDay.dayName, anchor: anchorLine(anchor) },
      })
    }
    return {
      state: 'rest-day',
      eyebrow: { literal: nextDay.programName },
      headline: { key: 'headline.rest' },
      context: {
        key: 'context.rest',
        values: { day: nextDay.dayName, anchor: anchorLine(anchor) },
      },
    }
  }

  if (daysSince !== null && daysSince >= DRIFT_THRESHOLD_DAYS) {
    return driftingStatus(facts, daysSince, null)
  }

  // No program. Returning lifters get an open door, true day one gets the
  // invitation — with the old ProgramReminderCard's copy folded into the
  // context line (its job, without a dismissible extra card).
  if (lastCompleted !== null) {
    return {
      state: 'fresh',
      eyebrow: null,
      headline: { key: 'headline.ready' },
      context: { key: 'context.freshReturning' },
    }
  }
  return {
    state: 'fresh',
    eyebrow: null,
    headline: { key: 'headline.dayOne' },
    context: { key: 'context.freshDayOne' },
  }
}
