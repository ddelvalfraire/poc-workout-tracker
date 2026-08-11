/**
 * The pre-deploy migration guard's brain: decide whether the DB has applied
 * every migration this checkout's journal knows about.
 *
 * Exists because of the 0041 outage: code selecting `diet_phase` reached
 * production while the DB's migrations stopped at 0040 — the migrate step
 * was believed run but never verified. The guard makes "believed"
 * insufficient: `npm run deploy` refuses to ship while anything is pending.
 *
 * The comparison mirrors drizzle-kit's OWN apply rule: each applied row's
 * `created_at` stores the journal entry's `when`, and the migrator applies
 * entries with `when` greater than the DB's max. Hashes are deliberately
 * NOT compared — early migration files were edited after being applied
 * (0002's DB hash matches no current file), and drizzle tolerates that;
 * a guard stricter than the tool it guards would fail forever on history.
 */

export interface JournalEntry {
  /** Journal tag, e.g. "0041_diet_phase" — names the file `drizzle/<tag>.sql`. */
  tag: string
  /** The journal's apply-order timestamp (epoch ms) — drizzle's comparison key. */
  when: number
}

export interface MigrationDiff {
  ok: boolean
  /** Journal tags the DB has not applied yet, in apply order. */
  pending: string[]
  /** Set when the DB's newest applied `when` is beyond every journal entry —
   *  this checkout is BEHIND the database and must not deploy either. */
  dbAhead: boolean
}

export function diffMigrations(journal: JournalEntry[], appliedWhens: number[]): MigrationDiff {
  const maxApplied = appliedWhens.length > 0 ? Math.max(...appliedWhens) : 0
  const maxJournal = journal.length > 0 ? Math.max(...journal.map((e) => e.when)) : 0

  const pending = journal.filter((e) => e.when > maxApplied).map((e) => e.tag)
  const dbAhead = maxApplied > maxJournal

  return { ok: pending.length === 0 && !dbAhead, pending, dbAhead }
}
