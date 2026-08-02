/**
 * Healthchecks.io check roster for the ops board. Reads the checks list API
 * (the read-back twin of the cron dead-man ping at HEALTHCHECK_PING_URL) plus
 * each check's recent status flips, so the delivery panel shows the cron's
 * up/down/grace state AND its recent transitions without opening
 * healthchecks.io.
 *
 * Live-verified 2026-08-01 with the read-only key: the list returns
 * `unique_key` (never `uuid` — read-only keys don't expose ping URLs), and
 * GET /api/v3/checks/<unique_key>/flips/ answers 200 with { flips: [...] }.
 * A flip is { timestamp: ISO-8601, up: 0|1 }.
 *
 * Needs HEALTHCHECKS_API_KEY; absent => 'unconfigured', no network call.
 * A failed flips fetch degrades to an empty list for that check only — the
 * roster itself is the panel's spine and must survive. External payload is
 * untrusted: shape-checked at the boundary.
 *
 * Server-only: never import from a Client Component.
 */
import { fetchJson } from './fetch'
import { cachedOpsFetch } from './cache'
import type { OpsResult } from './types'

const FLIPS_LIMIT = 5

/** One up/down transition. */
export interface CheckFlip {
  /** ISO-8601 moment of the transition. */
  timestamp: string
  /** True when the check came back up, false when it went down. */
  up: boolean
}

/** One monitored check, trimmed to what the delivery panel renders. */
export interface HealthCheck {
  name: string
  /** Healthchecks status: 'up' | 'down' | 'grace' | 'paused' | 'new' (unnarrowed — display only). */
  status: string
  /** ISO-8601 of the last received ping, or null if never pinged. */
  lastPing: string | null
  /** ISO-8601 the next ping is expected by, or null when not scheduled. */
  nextPing: string | null
  /** Most recent status transitions, newest first (empty when none or fetch failed). */
  flips: CheckFlip[]
}

export interface HealthchecksSnapshot {
  checks: HealthCheck[]
  /** Checks not currently 'up' — the count the panel leads with. */
  downCount: number
}

/** The list row plus the read-only key's identifier for the flips call. */
interface ParsedCheck {
  check: HealthCheck
  uniqueKey: string | null
}

/** Narrows one raw check, or null when the name is missing. */
function parseCheck(raw: unknown): ParsedCheck | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.name !== 'string') return null
  return {
    check: {
      name: obj.name,
      status: typeof obj.status === 'string' ? obj.status : 'unknown',
      lastPing: typeof obj.last_ping === 'string' ? obj.last_ping : null,
      nextPing: typeof obj.next_ping === 'string' ? obj.next_ping : null,
      flips: [],
    },
    uniqueKey: typeof obj.unique_key === 'string' ? obj.unique_key : null,
  }
}

/** Narrows one raw flip, or null when malformed. */
function parseFlip(raw: unknown): CheckFlip | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.timestamp !== 'string') return null
  return { timestamp: obj.timestamp, up: obj.up === 1 || obj.up === true }
}

/** Last few transitions for one check; [] on any failure (soft, per-check). */
async function fetchFlips(uniqueKey: string, apiKey: string): Promise<CheckFlip[]> {
  const data = await fetchJson(
    `https://healthchecks.io/api/v3/checks/${encodeURIComponent(uniqueKey)}/flips/`,
    { headers: { 'X-Api-Key': apiKey } },
  )
  if (!data || typeof data !== 'object') return []
  const rawFlips = (data as Record<string, unknown>).flips
  if (!Array.isArray(rawFlips)) return []
  return rawFlips
    .map(parseFlip)
    .filter((f): f is CheckFlip => f !== null)
    .slice(0, FLIPS_LIMIT)
}

// Cron state moves slowly; 5min keeps the checks+flips fan-out off every render.
const TTL_SECONDS = 300

export async function getHealthchecks(): Promise<OpsResult<HealthchecksSnapshot>> {
  const apiKey = process.env.HEALTHCHECKS_API_KEY
  // Unconfigured stays uncached: name the env var, never serve stale data.
  if (!apiKey) return { ok: false, reason: 'unconfigured' }
  return cachedOpsFetch('healthchecks', TTL_SECONDS, () => fetchChecks(apiKey))
}

async function fetchChecks(apiKey: string): Promise<OpsResult<HealthchecksSnapshot>> {
  const data = await fetchJson('https://healthchecks.io/api/v3/checks/', {
    headers: { 'X-Api-Key': apiKey },
  })
  if (!data || typeof data !== 'object') return { ok: false, reason: 'unavailable' }
  const rawChecks = (data as Record<string, unknown>).checks
  if (!Array.isArray(rawChecks)) return { ok: false, reason: 'unavailable' }

  const parsed = rawChecks.map(parseCheck).filter((c): c is ParsedCheck => c !== null)
  const checks = await Promise.all(
    parsed.map(async ({ check, uniqueKey }) => ({
      ...check,
      flips: uniqueKey ? await fetchFlips(uniqueKey, apiKey) : [],
    })),
  )
  const downCount = checks.filter((c) => c.status !== 'up' && c.status !== 'new').length
  return { ok: true, data: { checks, downCount } }
}
