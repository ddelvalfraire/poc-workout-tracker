/**
 * Sentry unresolved-issues snapshot for the ops board. Reads the project's
 * Issues API (the read-back twin of the error *reporting* SDK wired in
 * src/instrumentation*.ts) and returns the full triage row per issue —
 * level, culprit, event count, users affected, first/last seen — so the
 * errors panel answers "what broke, how often, who's affected?" without
 * opening sentry.io.
 *
 * `period` maps to Sentry's statsPeriod. Live-verified 2026-08-01: the API
 * accepts ONLY '', '24h', and '14d' ('7d' is a 400), so the panel's window
 * toggle is 24h|14d.
 *
 * Needs SENTRY_API_TOKEN + SENTRY_ORG_SLUG + SENTRY_PROJECT_SLUG; any absent
 * => 'unconfigured' and no network call. External payload is untrusted:
 * every field is shape-checked at the boundary.
 *
 * Server-only: never import from a Client Component.
 */
import { fetchJson } from './fetch'
import type { OpsResult } from './types'

/** Sentry stats windows the issues endpoint actually accepts. */
export type SentryPeriod = '24h' | '14d'

/** One unresolved issue, trimmed to what the errors table renders. */
export interface SentryIssue {
  title: string
  /** Severity as Sentry reports it: 'error' | 'warning' | 'fatal' | ... (display only). */
  level: string
  /** Code location Sentry blames, e.g. "app/api/chat/route" ('' when absent). */
  culprit: string
  /** Event count over the stats window, as Sentry reports it (a string). */
  count: string
  /** Distinct users affected over the window. */
  userCount: number
  permalink: string
  /** ISO-8601 timestamp of the first event ('' when absent). */
  firstSeen: string
  /** ISO-8601 timestamp of the most recent event. */
  lastSeen: string
}

export interface SentrySnapshot {
  /** Window the counts were computed over. */
  period: SentryPeriod
  /** Unresolved issues returned for the window (page-limited by Sentry). */
  unresolvedCount: number
  topIssues: SentryIssue[]
}

const MAX_ISSUES = 10

/** Narrows one raw issue to SentryIssue, or null when a required field is missing. */
function parseIssue(raw: unknown): SentryIssue | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.title !== 'string') return null
  if (typeof obj.permalink !== 'string') return null
  return {
    title: obj.title,
    level: typeof obj.level === 'string' ? obj.level : 'error',
    culprit: typeof obj.culprit === 'string' ? obj.culprit : '',
    count: typeof obj.count === 'string' ? obj.count : String(obj.count ?? '0'),
    userCount: typeof obj.userCount === 'number' ? obj.userCount : 0,
    permalink: obj.permalink,
    firstSeen: typeof obj.firstSeen === 'string' ? obj.firstSeen : '',
    lastSeen: typeof obj.lastSeen === 'string' ? obj.lastSeen : '',
  }
}

export async function getSentryIssues(
  period: SentryPeriod = '24h',
): Promise<OpsResult<SentrySnapshot>> {
  const token = process.env.SENTRY_API_TOKEN
  const org = process.env.SENTRY_ORG_SLUG
  const project = process.env.SENTRY_PROJECT_SLUG
  if (!token || !org || !project) return { ok: false, reason: 'unconfigured' }

  const url = `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(
    project,
  )}/issues/?query=${encodeURIComponent('is:unresolved')}&statsPeriod=${period}`

  const data = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } })
  // The issues endpoint returns a bare array.
  if (!Array.isArray(data)) return { ok: false, reason: 'unavailable' }

  const issues = data.map(parseIssue).filter((i): i is SentryIssue => i !== null)
  return {
    ok: true,
    data: { period, unresolvedCount: issues.length, topIssues: issues.slice(0, MAX_ISSUES) },
  }
}
