import { kgToDisplay, type WeightUnit } from '@/lib/units'

/**
 * Template ⇄ workout recency join for the /templates alive rows — pure so
 * the heuristic unit-tests as plain functions over the summaries the page
 * already fetches for the session guard (zero new queries).
 *
 * PROVENANCE TRUTH: workouts carry NO template id. A workout started from a
 * template is seeded with the template's NAME (`templateToDraft`), so "last
 * run" is a DOCUMENTED HEURISTIC: newest COMPLETED summary whose name equals
 * the template's name (exact, case-sensitive — both sides come from the same
 * seed). A renamed workout or template honestly reads "Never run"; nothing
 * here fakes a linkage the data cannot prove.
 */

/** What the summaries can prove about a template's last run. */
export interface TemplateUsage {
  lastPerformedAt: Date
  lastVolumeKg: number
}

interface SummaryLike {
  name: string | null
  startedAt: Date
  completedAt: Date | null
  volumeKg: number
}

/** Newest completed summary per name — the heuristic's lookup table. */
export function templateUsageByName(summaries: readonly SummaryLike[]): Map<string, TemplateUsage> {
  const byName = new Map<string, TemplateUsage>()
  for (const summary of summaries) {
    if (summary.completedAt === null || summary.name === null) continue
    const existing = byName.get(summary.name)
    if (existing === undefined || summary.startedAt > existing.lastPerformedAt) {
      byName.set(summary.name, {
        lastPerformedAt: summary.startedAt,
        lastVolumeKg: summary.volumeKg,
      })
    }
  }
  return byName
}

/**
 * Last-performed desc; never-run templates follow in their incoming order
 * (the page's own newest-created-first read). Returns a fresh array.
 */
export function sortTemplatesByUsage<T extends { name: string }>(
  templates: readonly T[],
  usage: ReadonlyMap<string, TemplateUsage>,
): T[] {
  return [...templates].sort((a, b) => {
    const aAt = usage.get(a.name)?.lastPerformedAt.getTime() ?? null
    const bAt = usage.get(b.name)?.lastPerformedAt.getTime() ?? null
    if (aAt === null && bAt === null) return 0 // stable: keep incoming order
    if (aAt === null) return 1
    if (bAt === null) return -1
    return bAt - aAt
  })
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Message DESCRIPTORS for the `Templates` namespace (docs/I18N-KEYS.md §9):
 * this module decides WHICH recency word a row earns, the catalog owns the
 * word itself.
 */
export type LastRunMessage =
  | { key: 'lastRun.today' | 'lastRun.yesterday'; values?: undefined }
  | { key: 'lastRun.daysAgo'; values: { days: number } }
  | { key: 'lastRun.weeksAgo'; values: { weeks: number } }
  | { key: 'lastRun.monthsAgo'; values: { months: number } }

/** "Today" / "Yesterday" / "4d ago" / "3 wks ago" / "5 mo ago" — the
 *  template rows speak relative words throughout: a template's pull is
 *  "how long since I ran this", never a bookkeeping date. */
export function lastRunLabel(lastPerformedAt: Date, now: Date): LastRunMessage {
  const days = Math.floor((now.getTime() - lastPerformedAt.getTime()) / DAY_MS)
  if (days <= 0) return { key: 'lastRun.today' }
  if (days === 1) return { key: 'lastRun.yesterday' }
  if (days < 28) return { key: 'lastRun.daysAgo', values: { days } }
  if (days <= 84) return { key: 'lastRun.weeksAgo', values: { weeks: Math.round(days / 7) } }
  return { key: 'lastRun.monthsAgo', values: { months: Math.max(2, Math.round(days / 30.44)) } }
}

/**
 * The status line as a descriptor whose `when` argument is itself a
 * `LastRunMessage` the caller renders first. Three whole sentences rather
 * than one built from joined keys: where the separator sits and whether the
 * volume leads are the translator's business, and §5 bans composing a line
 * out of catalog entries.
 */
export type TemplateStatusMessage =
  | { key: 'status.neverRun'; values: { count: number } }
  | { key: 'status.lastRun'; values: { when: LastRunMessage } }
  | {
      key: 'status.lastRunVolume'
      values: { when: LastRunMessage; volume: number; unit: WeightUnit }
    }

/**
 * The row's status second line: "Last: 4d ago · 8,076 lb" when the heuristic
 * proves a run (zero volume drops the segment, like the drawer's recents);
 * otherwise the honest "{n} exercises · Never run".
 */
export function templateStatusLine(
  usage: TemplateUsage | null,
  exerciseCount: number,
  unit: WeightUnit,
  now: Date,
): TemplateStatusMessage {
  if (usage === null) return { key: 'status.neverRun', values: { count: exerciseCount } }
  const when = lastRunLabel(usage.lastPerformedAt, now)
  if (usage.lastVolumeKg <= 0) return { key: 'status.lastRun', values: { when } }
  return {
    key: 'status.lastRunVolume',
    values: { when, volume: Math.round(kgToDisplay(usage.lastVolumeKg, unit)), unit },
  }
}
