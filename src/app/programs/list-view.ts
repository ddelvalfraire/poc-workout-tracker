/**
 * Pure view logic for the programs list — kept free of JSX so it unit-tests
 * as plain functions (repo convention for pure modules). Copy is returned as
 * message DESCRIPTORS (I18N-KEYS §9): the decision is made here, the words
 * live in the catalog, and the tests below assert the branch rather than an
 * English sentence.
 */

import type { Message } from '@/lib/message'
import { resolveDayState } from './[id]/week-view'

/** The statuses the catalog has words for. Anything else is a value the
 *  schema grew without the UI noticing. */
const KNOWN_STATUSES = ['active', 'proposed', 'draft', 'archived'] as const

export type ProgramStatusKey = `status.${(typeof KNOWN_STATUSES)[number]}`

/**
 * A program's status label, or null when no copy exists for the value — the
 * caller then renders the raw status rather than a blank. Title-casing an
 * unknown db value was only ever an English affordance, and dressing up a
 * string nobody wrote copy for hides the gap instead of showing it.
 */
export function programStatusLabel(status: string): Message<ProgramStatusKey> | null {
  return (KNOWN_STATUSES as readonly string[]).includes(status)
    ? { key: `status.${status}` as ProgramStatusKey }
    : null
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The staleness affordance for a pending proposal — its AGE as muted words
 * ("proposed 3 days ago"), never a countdown and never an auto-expiry (a
 * coach draft silently vanishing would be corruption; the words just let the
 * owner notice a stale ask). Lowercase on purpose: it rides meta lines; a
 * sentence-position caller capitalizes via CSS (`first-letter:uppercase`).
 * A future-dated or same-day timestamp reads "proposed today" (clock skew
 * must not produce "in -1 days").
 */
export type ProposalAgeKey =
  | 'proposalAge.today'
  | 'proposalAge.yesterday'
  | 'proposalAge.days'
  | 'proposalAge.weeks'
  | 'proposalAge.months'

export function proposalAgeLine(createdAt: Date, now: Date): Message<ProposalAgeKey> {
  const days = Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS)
  if (days <= 0) return { key: 'proposalAge.today' }
  if (days === 1) return { key: 'proposalAge.yesterday' }
  if (days < 7) return { key: 'proposalAge.days', values: { days } }
  if (days < 30) return { key: 'proposalAge.weeks', values: { weeks: Math.floor(days / 7) } }
  return { key: 'proposalAge.months', values: { months: Math.floor(days / 30) } }
}

/** The workout facts the week/block derivations read — a subset of the
 *  listProgramWorkouts row (already paid for by the hero; no new reads). */
export interface WorkoutFact {
  programDayId: string | null
  programWeek: number | null
  startedAt: Date
  completedAt: Date | null
}

export type ThisWeekState = 'done' | 'next' | 'upcoming'

export interface ThisWeekRow<D> {
  day: D
  state: ThisWeekState
}

/**
 * The "This week" band's rows: one per program day, in plan order, each
 * resolved against the current week's workouts. `done` comes from
 * resolveDayState (the detail page's exact rule — completed beats a lingering
 * in-progress duplicate); `next` is getNextProgramDay's pick, passed in so the
 * band and the home hero never disagree; everything else is `upcoming`.
 * An in-progress day intentionally reads as not-done rather than growing a
 * fourth state the band has no words for.
 */
export function buildThisWeekRows<D extends { id: string }>(
  days: readonly D[],
  workouts: readonly WorkoutFact[],
  currentWeek: number,
  nextDayId: string | null,
): { rows: ThisWeekRow<D>[]; doneCount: number } {
  const rows = days.map((day): ThisWeekRow<D> => {
    const dayWorkouts = workouts.filter(
      (w) => w.programDayId === day.id && w.programWeek === currentWeek,
    )
    if (resolveDayState(dayWorkouts)?.state === 'completed') return { day, state: 'done' }
    return { day, state: day.id === nextDayId ? 'next' : 'upcoming' }
  })
  return { rows, doneCount: rows.filter((r) => r.state === 'done').length }
}

/** The "Block so far" figures — all derivable from data the hero already
 *  loads (listProgramWorkouts + the detail's day count). */
export interface BlockSoFar {
  daysDone: number
  daysPlanned: number
  volumeKg: number
}

/**
 * Days done = DISTINCT completed (day, week) pairs within weeks 1..currentWeek
 * — the resume-on-start era still allows historical duplicate rows, and a
 * redone day must not count twice. Planned = day count × weeks elapsed
 * (including the current one — same retroactive-denominator drift the stats
 * page accepts). Volume = Σ volumeKg over completed workouts, all weeks.
 */
export function blockSoFar(
  dayCount: number,
  workouts: readonly (WorkoutFact & { volumeKg: number })[],
  currentWeek: number,
): BlockSoFar {
  const donePairs = new Set<string>()
  let volumeKg = 0
  for (const w of workouts) {
    if (w.completedAt === null) continue
    volumeKg += w.volumeKg
    if (
      w.programDayId !== null &&
      w.programWeek !== null &&
      w.programWeek >= 1 &&
      w.programWeek <= currentWeek
    ) {
      donePairs.add(`${w.programDayId}:${w.programWeek}`)
    }
  }
  return {
    daysDone: donePairs.size,
    daysPlanned: dayCount * Math.max(1, currentWeek),
    volumeKg,
  }
}

/** The list's zones, in render order. `hero` is the one program that gets the
 *  big active-hero card; any further actives stay plain rows above the zones. */
export interface ProgramZones<T> {
  hero: T | null
  /** Actives beyond the hero (nothing enforces a single active program). */
  otherActive: T[]
  /** Needs-your-decision — proposals lead the zones. */
  proposed: T[]
  drafts: T[]
  archived: T[]
}

/**
 * Buckets programs into the list's zones, preserving input order (listPrograms
 * returns most-recently-updated first, so the hero is the most recent active —
 * the same recency tiebreak getNextProgramDay uses to pick "the" active
 * program). Unknown statuses land with drafts: draft is the schema default,
 * and a mystery row should read as unstarted, not vanish.
 */
export function zonePrograms<T extends { status: string }>(programs: readonly T[]): ProgramZones<T> {
  const zones: ProgramZones<T> = { hero: null, otherActive: [], proposed: [], drafts: [], archived: [] }
  for (const program of programs) {
    switch (program.status) {
      case 'active':
        if (zones.hero === null) zones.hero = program
        else zones.otherActive.push(program)
        break
      case 'proposed':
        zones.proposed.push(program)
        break
      case 'archived':
        zones.archived.push(program)
        break
      default:
        zones.drafts.push(program)
    }
  }
  return zones
}
