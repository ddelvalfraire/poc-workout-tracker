import type { WorkoutEventKind } from '@/db/workout-events'

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
  actor: 'ui' | 'mcp' | 'coach' | 'system'
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
