/**
 * Sentry unresolved-issues snapshot for the ops board. Reads the project's
 * Issues API (the read-back twin of the error *reporting* SDK wired in
 * src/instrumentation*.ts) and returns the count plus the top five, so the
 * card links straight to each issue instead of us opening sentry.io.
 *
 * Needs SENTRY_API_TOKEN + SENTRY_ORG_SLUG + SENTRY_PROJECT_SLUG; any absent
 * => 'unconfigured' and no network call. External payload is untrusted:
 * every field is shape-checked at the boundary.
 *
 * Server-only: never import from a Client Component.
 */
import { fetchJson } from './fetch'
import type { OpsResult } from './types'

/** One unresolved issue, trimmed to what the card renders. */
export interface SentryIssue {
  title: string
  /** Event count over the stats window, as Sentry reports it (a string). */
  count: string
  permalink: string
  /** ISO-8601 timestamp of the most recent event. */
  lastSeen: string
}

export interface SentrySnapshot {
  /** Unresolved issues returned for the 24h window (page-limited by Sentry). */
  unresolvedCount: number
  topIssues: SentryIssue[]
}

const MAX_ISSUES = 5

/** Narrows one raw issue to SentryIssue, or null when a required field is missing. */
function parseIssue(raw: unknown): SentryIssue | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.title !== 'string') return null
  if (typeof obj.permalink !== 'string') return null
  return {
    title: obj.title,
    count: typeof obj.count === 'string' ? obj.count : String(obj.count ?? '0'),
    permalink: obj.permalink,
    lastSeen: typeof obj.lastSeen === 'string' ? obj.lastSeen : '',
  }
}

export async function getSentryIssues(): Promise<OpsResult<SentrySnapshot>> {
  const token = process.env.SENTRY_API_TOKEN
  const org = process.env.SENTRY_ORG_SLUG
  const project = process.env.SENTRY_PROJECT_SLUG
  if (!token || !org || !project) return { ok: false, reason: 'unconfigured' }

  const url = `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(
    project,
  )}/issues/?query=${encodeURIComponent('is:unresolved')}&statsPeriod=24h`

  const data = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } })
  // The issues endpoint returns a bare array.
  if (!Array.isArray(data)) return { ok: false, reason: 'unavailable' }

  const issues = data.map(parseIssue).filter((i): i is SentryIssue => i !== null)
  return {
    ok: true,
    data: { unresolvedCount: issues.length, topIssues: issues.slice(0, MAX_ISSUES) },
  }
}
