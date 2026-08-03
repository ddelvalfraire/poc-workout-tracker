import { isSameLocalDay } from '@/lib/local-day'
import { scheduleAnchor } from '@/lib/schedule-anchor'
import { formatVolume } from '@/lib/format'
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

export interface HomeStatus {
  state: HomeState
  /** Small line above the headline (volt for live/achievement states); null = none. */
  eyebrow: string | null
  /** The poster line — rendered in font-display caps by the hero. */
  headline: string
  context: string
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
 *  "Leg Day day". The trailing period is the editorial voice, not grammar. */
export function dueHeadline(dayName: string): string {
  const name = dayName.trim()
  return /(^|\s)day$/i.test(name) ? `${name}.` : `${name} day.`
}

/** The momentum panel's sessions subline: "3 sessions this week". */
export function momentumSessionsLine(count: number): string {
  return `${count} ${count === 1 ? 'session' : 'sessions'} this week`
}

function pluralSets(count: number): string {
  return `${count} set${count === 1 ? '' : 's'}`
}

function driftingStatus(
  facts: HomeStatusFacts,
  daysSince: number,
  nextLine: string | null,
): HomeStatus {
  // Warm by contract (never guilt-toned): the headline states the fact, the
  // context offers the stake (streak) or the way back in — nothing scolds.
  const sinceName = facts.lastCompleted?.name ?? 'your last session'
  const context =
    facts.streakWeeks !== null && facts.streakWeeks > 0
      ? `Your ${facts.streakWeeks}-week streak is on the line — one session keeps it.`
      : (nextLine ?? 'Pick up where you left off.')
  return {
    state: 'drifting',
    eyebrow: null,
    headline: `${daysSince} days since ${sinceName}.`,
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
      eyebrow: 'Workout in progress',
      headline: 'In the middle of it.',
      context: `${session.name ?? 'Unnamed session'} · ${pluralSets(session.completedSetCount)} logged`,
    }
  }

  const trainedToday = facts.recentCompletedAtTimes.some((t) => isSameLocalDay(new Date(t), now))
  if (trainedToday) {
    // PR counts aren't in the home reads (spike §5), so the fallback phrase
    // stands in whenever the volume fact is missing — never an empty slot.
    const name = lastCompleted?.name ?? 'Workout'
    const fact =
      lastCompleted !== null && lastCompleted.volumeKg > 0
        ? formatVolume(lastCompleted.volumeKg, unit)
        : 'showed up — that counts'
    return {
      state: 'trained-today',
      eyebrow: 'Session logged',
      headline: 'Done for today.',
      context: `${name} · ${fact}`,
    }
  }

  if (nextDay?.blockComplete) {
    return {
      state: 'block-complete',
      eyebrow: 'Block complete',
      headline: nextDay.programName,
      context: `${nextDay.mesocycleWeeks} week${nextDay.mesocycleWeeks === 1 ? '' : 's'}`,
    }
  }

  const daysSince = lastCompleted !== null ? localDayDiff(lastCompleted.completedAtMs, now) : null

  if (nextDay !== null) {
    const anchor = scheduleAnchor(nextDay.weekdays, now)
    // Unscheduled programs are always "due" — the pre-schedule "Up next"
    // semantics; scheduled ones are due only on their local calendar day.
    if (anchor === null || anchor === 'Today') {
      const context = [
        `Week ${nextDay.week} of ${nextDay.mesocycleWeeks}`,
        facts.lastTimeVolumeKg !== null && facts.lastTimeVolumeKg > 0
          ? `last time: ${formatVolume(facts.lastTimeVolumeKg, unit)}`
          : null,
      ]
        .filter((p): p is string => p !== null)
        .join(' · ')
      return {
        state: 'program-due',
        eyebrow: anchor ?? 'Up next',
        headline: dueHeadline(nextDay.dayName),
        context,
      }
    }
    if (daysSince !== null && daysSince >= DRIFT_THRESHOLD_DAYS) {
      return driftingStatus(facts, daysSince, `Next up: ${nextDay.dayName} · ${anchor}`)
    }
    return {
      state: 'rest-day',
      eyebrow: nextDay.programName,
      headline: 'Rest day.',
      context: `Next: ${nextDay.dayName} · ${anchor}`,
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
      headline: 'Ready when you are.',
      context: 'No plan today — quick-log a session, or pick a program.',
    }
  }
  return {
    state: 'fresh',
    eyebrow: null,
    headline: 'Day one.',
    context: 'Log your first session — a program gives every set a target.',
  }
}
