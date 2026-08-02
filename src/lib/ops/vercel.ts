/**
 * Vercel production-deployment snapshot for the ops board. Reads the latest
 * few production deployments so the card shows the current state (READY /
 * ERROR / BUILDING) and when it shipped, without opening the Vercel
 * dashboard.
 *
 * Needs VERCEL_API_TOKEN + VERCEL_PROJECT_ID; either absent => 'unconfigured',
 * no network call. VERCEL_TEAM_ID is optional (required only for team-scoped
 * projects). External payload is untrusted: shape-checked at the boundary.
 *
 * Server-only: never import from a Client Component.
 */
import { fetchJson } from './fetch'
import type { OpsResult } from './types'

/** One production deployment, trimmed to what the card renders. */
export interface VercelDeployment {
  /** Deployment readyState, e.g. 'READY' | 'ERROR' | 'BUILDING' (display only). */
  state: string
  /** Creation time as epoch milliseconds (Vercel returns a number). */
  created: number
  /** Hostname without scheme, e.g. "poc-workout-tracker-abc123.vercel.app". */
  url: string
}

export interface VercelSnapshot {
  deployments: VercelDeployment[]
}

const LIMIT = 3

/** Narrows one raw deployment, or null when required fields are missing. */
function parseDeployment(raw: unknown): VercelDeployment | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  // Vercel exposes readiness as `state` on v6; older shapes used `readyState`.
  const state = typeof obj.state === 'string' ? obj.state : obj.readyState
  if (typeof state !== 'string') return null
  if (typeof obj.created !== 'number') return null
  return {
    state,
    created: obj.created,
    url: typeof obj.url === 'string' ? obj.url : '',
  }
}

export async function getVercelDeployments(): Promise<OpsResult<VercelSnapshot>> {
  const token = process.env.VERCEL_API_TOKEN
  const projectId = process.env.VERCEL_PROJECT_ID
  if (!token || !projectId) return { ok: false, reason: 'unconfigured' }

  const params = new URLSearchParams({
    projectId,
    target: 'production',
    limit: String(LIMIT),
  })
  const teamId = process.env.VERCEL_TEAM_ID
  if (teamId) params.set('teamId', teamId)

  const data = await fetchJson(`https://api.vercel.com/v6/deployments?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!data || typeof data !== 'object') return { ok: false, reason: 'unavailable' }
  const rawDeployments = (data as Record<string, unknown>).deployments
  if (!Array.isArray(rawDeployments)) return { ok: false, reason: 'unavailable' }

  const deployments = rawDeployments
    .map(parseDeployment)
    .filter((d): d is VercelDeployment => d !== null)
  return { ok: true, data: { deployments } }
}
