import { formatVolume } from '@/lib/format'
import type { WeightUnit } from '@/lib/units'

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

/** "Today" / "Yesterday" / "4d ago" / "3 wks ago" / "5 mo ago" — the
 *  template rows speak relative words throughout: a template's pull is
 *  "how long since I ran this", never a bookkeeping date. */
export function lastRunLabel(lastPerformedAt: Date, now: Date): string {
  const days = Math.floor((now.getTime() - lastPerformedAt.getTime()) / DAY_MS)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 28) return `${days}d ago`
  if (days <= 84) {
    const weeks = Math.round(days / 7)
    return `${weeks} ${weeks === 1 ? 'wk' : 'wks'} ago`
  }
  const months = Math.max(2, Math.round(days / 30.44))
  return `${months} mo ago`
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
): string {
  if (usage === null) {
    return `${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'} · Never run`
  }
  const parts = [`Last: ${lastRunLabel(usage.lastPerformedAt, now)}`]
  if (usage.lastVolumeKg > 0) parts.push(formatVolume(usage.lastVolumeKg, unit))
  return parts.join(' · ')
}
