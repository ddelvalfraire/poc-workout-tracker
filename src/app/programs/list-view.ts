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
