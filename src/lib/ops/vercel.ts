/**
 * Vercel production-deployment snapshot for the ops board. Reads the latest
 * eight production deployments — state, commit sha/message, age, build
 * duration — so the delivery panel answers "did the deploy work?" without
 * opening the Vercel dashboard.
 *
 * Live-verified 2026-08-01 against v6: commit info rides in `meta`
 * (githubCommitSha / githubCommitMessage) and `ready`/`createdAt` are epoch
 * ms, so build duration = ready - createdAt.
 *
 * Needs VERCEL_API_TOKEN + VERCEL_PROJECT_ID; either absent => 'unconfigured',
 * no network call. VERCEL_TEAM_ID is optional (required only for team-scoped
 * projects). External payload is untrusted: shape-checked at the boundary.
 *
 * Server-only: never import from a Client Component.
 */
import { fetchJson } from './fetch'
import { cachedOpsFetch } from './cache'
import type { OpsResult } from './types'

/** Deployment states that mean the deploy did NOT ship. */
const FAILED_STATES = new Set(['ERROR', 'CANCELED'])
const SHA_SHORT_LENGTH = 7

/** One production deployment, trimmed to what the delivery table renders. */
export interface VercelDeployment {
  /** Deployment readyState, e.g. 'READY' | 'ERROR' | 'BUILDING' (display only). */
  state: string
  /** True for ERROR/CANCELED — the row the table must make loud. */
  isFailed: boolean
  /** Short commit sha ('' when the deploy didn't come from git). */
  sha7: string
  /** Commit message first line ('' when absent). */
  commitMessage: string
  /** Creation time as epoch milliseconds. */
  createdAt: number
  /** Build wall-clock ms (ready - createdAt), or null while building/failed. */
  durationMs: number | null
  /** Hostname without scheme, e.g. "poc-workout-tracker-abc123.vercel.app". */
  url: string
}

export interface VercelSnapshot {
  deployments: VercelDeployment[]
}

const LIMIT = 8

/** Narrows one raw deployment, or null when required fields are missing. */
function parseDeployment(raw: unknown): VercelDeployment | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  // Vercel exposes readiness as `state` on v6; older shapes used `readyState`.
  const state = typeof obj.state === 'string' ? obj.state : obj.readyState
  if (typeof state !== 'string') return null
  const createdAt =
    typeof obj.createdAt === 'number'
      ? obj.createdAt
      : typeof obj.created === 'number'
        ? obj.created
        : null
  if (createdAt === null) return null

  const meta =
    obj.meta && typeof obj.meta === 'object' ? (obj.meta as Record<string, unknown>) : {}
  const sha = typeof meta.githubCommitSha === 'string' ? meta.githubCommitSha : ''
  const message = typeof meta.githubCommitMessage === 'string' ? meta.githubCommitMessage : ''
  const ready = typeof obj.ready === 'number' ? obj.ready : null

  return {
    state,
    isFailed: FAILED_STATES.has(state),
    sha7: sha.slice(0, SHA_SHORT_LENGTH),
    commitMessage: message.split('\n')[0],
    createdAt,
    durationMs: ready !== null && ready >= createdAt ? ready - createdAt : null,
    url: typeof obj.url === 'string' ? obj.url : '',
  }
}

// Deploy state is the freshest signal the board carries — short TTL.
const TTL_SECONDS = 120

export async function getVercelDeployments(): Promise<OpsResult<VercelSnapshot>> {
  const token = process.env.VERCEL_API_TOKEN
  const projectId = process.env.VERCEL_PROJECT_ID
  // Unconfigured stays uncached: name the env var, never serve stale data.
  if (!token || !projectId) return { ok: false, reason: 'unconfigured' }
  return cachedOpsFetch('vercel', TTL_SECONDS, () => fetchDeployments(token, projectId))
}

async function fetchDeployments(
  token: string,
  projectId: string,
): Promise<OpsResult<VercelSnapshot>> {
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
