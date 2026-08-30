import type { WorkoutEventActor, WorkoutEventKind } from '@/db/workout-events'

/**
 * Pure view logic for the session change log — kept free of JSX so it unit
 * tests as plain functions (the ./workout-changelog component is then only
 * markup), the same split the program detail page uses.
 */

/** One event as the changelog renders it: the row's identity, its provenance,
 *  when it happened, and the ONE line the write path already composed.
 *
 *  `summary` is deliberately the whole rendering of an intent — the write
 *  path folded every field a single edit touched into it ("Set 3 of Squat —
 *  weight 100 → 102.5, reps 5 → 6"), so a renderer never fans one intent out
 *  into a row per field. */
export interface WorkoutChangelogEntry {
  id: string
  kind: WorkoutEventKind
  actor: WorkoutEventActor
  occurredAt: Date
  summary: string
}

/**
 * The kinds that CONTRADICT what was recorded — the default view.
 *
 * This mirrors `AMENDMENT_KINDS` in the db layer, which cannot be imported
 * here: that module opens the database connection, and this one is rendered
 * in the browser. `workout-changelog-view.test.ts` pins the two together
 * across the whole `WorkoutEventKind` union, so the copy can never drift.
 */
export function isAmendmentKind(kind: WorkoutEventKind): boolean {
  return kind === 'amendment'
}

/** The permanent amended mark's values: how many corrections, and how long
 *  after the session the most recent one landed. Null when nothing was ever
 *  amended — the surface is then absent entirely, not an empty state. */
export interface AmendedMark {
  count: number
  days: number
}

/** Whole elapsed days between two instants, floored and never negative.
 *
 *  Elapsed rather than CALENDAR days on purpose: "two days after the
 *  session" should mean two days' worth of time, the same in every timezone,
 *  rather than a count of midnights that a 9pm session and a 1am edit would
 *  inflate to "one day" four hours later. */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000))
}

/**
 * The amended mark for a session, from the FULL event stream.
 *
 * The delta is measured to the most recent amendment (entries arrive newest
 * first), because that is the age of what the reader is looking at now — an
 * old first correction says nothing about how current the record is.
 */
export function amendedMark(
  entries: readonly WorkoutChangelogEntry[],
  sessionAt: Date,
): AmendedMark | null {
  const amendments = entries.filter((entry) => isAmendmentKind(entry.kind))
  if (amendments.length === 0) return null
  const latest = amendments.reduce((newest, entry) =>
    entry.occurredAt > newest.occurredAt ? entry : newest,
  )
  return { count: amendments.length, days: daysBetween(sessionAt, latest.occurredAt) }
}

/** A summary split into the SUBJECT and the deltas that follow it. */
export interface SummaryParts {
  subject: string
  /** The change itself — null when the line is a whole sentence with no
   *  delta tail ("Set 3 of Squat added"). */
  detail: string | null
}

/** The em-dash the write path composes summaries around
 *  (`describeSetChange`): `Set 3 of Squat — weight 100 → 102.5`. */
const SUMMARY_SEPARATOR = ' — '

/**
 * Splits one summary into what changed and what it changed TO, so the row can
 * ink them differently — the subject in the reading ink, the numbers muted
 * behind it. A line without the separator is all subject: an add or a removal
 * is a whole statement, not a delta, and greying half of it would be a lie
 * about where the sentence divides.
 */
export function splitSummary(summary: string): SummaryParts {
  const at = summary.indexOf(SUMMARY_SEPARATOR)
  if (at === -1) return { subject: summary, detail: null }
  return {
    subject: summary.slice(0, at),
    detail: summary.slice(at + SUMMARY_SEPARATOR.length),
  }
}

/**
 * The clock time a change landed, e.g. "9:12 AM".
 *
 * Clock time rather than a relative phrase because the rows are already
 * grouped under a calendar-day header: "2 days ago" under "16 Aug" says the
 * same thing twice and reads less precisely than the log register wants.
 */
export function formatClockTime(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(date)
}
