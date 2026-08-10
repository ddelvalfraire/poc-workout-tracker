/**
 * Pure view logic for the programs list — kept free of JSX so it unit-tests
 * as plain functions (repo convention for pure modules).
 */

/** Raw status strings as the user reads them — never render the db value. */
const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  proposed: 'Proposed',
  draft: 'Draft',
  archived: 'Archived',
}

/** A program's status label; unknown values title-case rather than leak raw. */
export function programStatusLabel(status: string): string {
  const known = STATUS_LABELS[status]
  if (known) return known
  return status.length > 0 ? status[0].toUpperCase() + status.slice(1) : status
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
export function proposalAgeLine(createdAt: Date, now: Date): string {
  const days = Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS)
  if (days <= 0) return 'proposed today'
  if (days === 1) return 'proposed yesterday'
  if (days < 7) return `proposed ${days} days ago`
  if (days < 30) {
    const weeks = Math.floor(days / 7)
    return `proposed ${weeks} week${weeks === 1 ? '' : 's'} ago`
  }
  const months = Math.floor(days / 30)
  return `proposed ${months} month${months === 1 ? '' : 's'} ago`
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
