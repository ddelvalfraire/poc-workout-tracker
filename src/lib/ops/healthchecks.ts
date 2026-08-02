/**
 * Healthchecks.io check roster for the ops board. Reads the checks list API
 * (the read-back twin of the cron dead-man ping at HEALTHCHECK_PING_URL) so
 * the card shows each cron's up/down/grace state and last ping without
 * opening healthchecks.io.
 *
 * Needs HEALTHCHECKS_API_KEY; absent => 'unconfigured', no network call.
 * External payload is untrusted: shape-checked at the boundary.
 *
 * Server-only: never import from a Client Component.
 */
import { fetchJson } from './fetch'
import type { OpsResult } from './types'

/** One monitored check, trimmed to what the card renders. */
export interface HealthCheck {
  name: string
  /** Healthchecks status: 'up' | 'down' | 'grace' | 'paused' | 'new' (unnarrowed — display only). */
  status: string
  /** ISO-8601 of the last received ping, or null if never pinged. */
  lastPing: string | null
  /** ISO-8601 the next ping is expected by, or null when not scheduled. */
  nextPing: string | null
}

export interface HealthchecksSnapshot {
  checks: HealthCheck[]
  /** Checks not currently 'up' — the count the card leads with. */
  downCount: number
}

/** Narrows one raw check, or null when the name is missing. */
function parseCheck(raw: unknown): HealthCheck | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.name !== 'string') return null
  return {
    name: obj.name,
    status: typeof obj.status === 'string' ? obj.status : 'unknown',
    lastPing: typeof obj.last_ping === 'string' ? obj.last_ping : null,
    nextPing: typeof obj.next_ping === 'string' ? obj.next_ping : null,
  }
}

export async function getHealthchecks(): Promise<OpsResult<HealthchecksSnapshot>> {
  const apiKey = process.env.HEALTHCHECKS_API_KEY
  if (!apiKey) return { ok: false, reason: 'unconfigured' }

  const data = await fetchJson('https://healthchecks.io/api/v3/checks/', {
    headers: { 'X-Api-Key': apiKey },
  })
  if (!data || typeof data !== 'object') return { ok: false, reason: 'unavailable' }
  const rawChecks = (data as Record<string, unknown>).checks
  if (!Array.isArray(rawChecks)) return { ok: false, reason: 'unavailable' }

  const checks = rawChecks.map(parseCheck).filter((c): c is HealthCheck => c !== null)
  const downCount = checks.filter((c) => c.status !== 'up' && c.status !== 'new').length
  return { ok: true, data: { checks, downCount } }
}
