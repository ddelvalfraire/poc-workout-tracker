/**
 * Pure view logic for the programs list — kept free of JSX so it unit-tests
 * as plain functions (repo convention for pure modules). Copy is returned as
 * message DESCRIPTORS (I18N-KEYS §9): the decision is made here, the words
 * live in the catalog, and the tests below assert the branch rather than an
 * English sentence.
 */

import type { Message } from '@/lib/message'

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
