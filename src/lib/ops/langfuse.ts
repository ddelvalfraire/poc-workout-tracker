/**
 * Langfuse snapshots for the ops board — the read-back twin of the coach's
 * span exporter (src/lib/coach/telemetry.ts). Two reads:
 *
 * 1. Daily metrics, last 14 days (the coach panel's chart window):
 *      GET {baseUrl}/api/public/metrics/daily?limit=14
 *    Shape confirmed against langfuse.com/docs/analytics/daily-metrics-api.
 *    Live-verified 2026-08-01: the endpoint still answers 200 but carries a
 *    `_deprecation` notice pointing at GET /api/public/v2/metrics — migrate
 *    there when this stops responding.
 *
 * 2. Recent generations for the traces table:
 *      GET {baseUrl}/api/public/v2/observations?limit=15&type=GENERATION
 *          &fields=core,basic,model,usage,metrics
 *    This IS the documented-current path: the deprecated v1 traces list names
 *    it as its replacement, and the OpenAPI spec (ObservationV2) was checked
 *    live for field names — `latency` is in SECONDS, cost lives in
 *    `totalCost`/`costDetails.total`, tokens in `usageDetails.total`, model
 *    in `providedModelName`.
 *
 * Basic auth = base64(LANGFUSE_PUBLIC_KEY:LANGFUSE_SECRET_KEY); either absent
 * => 'unconfigured'. External payload is untrusted: shape-checked at the
 * boundary.
 *
 * Server-only: never import from a Client Component.
 */
import { fetchJson } from './fetch'
import type { OpsResult } from './types'

const DEFAULT_BASE_URL = 'https://cloud.langfuse.com'
const DAYS = 14
const PILL_WINDOW_DAYS = 7
const TRACES_LIMIT = 15

/** One day's rolled-up coach telemetry. */
export interface LangfuseDay {
  /** Calendar date, "YYYY-MM-DD" as Langfuse returns it. */
  date: string
  traces: number
  /** Total model cost for the day, in USD. */
  totalCost: number
  /** Total tokens (summed across every model's usage row). */
  tokens: number
}

export interface LangfuseSnapshot {
  /** Newest-first, up to 14 days (only days with data are present). */
  days: LangfuseDay[]
  /** 14-day totals for the panel header. */
  totalTraces: number
  totalCost: number
  /** 7-day cost — the status-strip pill's number. */
  totalCost7d: number
}

/** One recent model call for the traces table. */
export interface LangfuseTrace {
  /** ISO-8601 start time. */
  time: string
  name: string
  /** Wall-clock latency in ms, or null when Langfuse hasn't computed it. */
  latencyMs: number | null
  /** Cost in USD. */
  totalCost: number
  tokens: number
  model?: string
}

export interface LangfuseTracesSnapshot {
  traces: LangfuseTrace[]
}

interface LangfuseAuth {
  baseUrl: string
  header: string
}

function resolveAuth(): LangfuseAuth | null {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY
  if (!publicKey || !secretKey) return null
  return {
    baseUrl: (process.env.LANGFUSE_BASEURL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    header: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`,
  }
}

/** Sums token usage across the day's per-model breakdown. */
function sumTokens(usage: unknown): number {
  if (!Array.isArray(usage)) return 0
  return usage.reduce<number>((total, row) => {
    if (!row || typeof row !== 'object') return total
    const value = (row as Record<string, unknown>).totalUsage
    return total + (typeof value === 'number' ? value : 0)
  }, 0)
}

/** Narrows one raw day, or null when the date is missing. */
function parseDay(raw: unknown): LangfuseDay | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.date !== 'string') return null
  return {
    date: obj.date,
    traces: typeof obj.countTraces === 'number' ? obj.countTraces : 0,
    totalCost: typeof obj.totalCost === 'number' ? obj.totalCost : 0,
    tokens: sumTokens(obj.usage),
  }
}

export async function getLangfuseDaily(): Promise<OpsResult<LangfuseSnapshot>> {
  const auth = resolveAuth()
  if (!auth) return { ok: false, reason: 'unconfigured' }

  const data = await fetchJson(`${auth.baseUrl}/api/public/metrics/daily?limit=${DAYS}`, {
    headers: { Authorization: auth.header },
  })
  if (!data || typeof data !== 'object') return { ok: false, reason: 'unavailable' }
  const rawDays = (data as Record<string, unknown>).data
  if (!Array.isArray(rawDays)) return { ok: false, reason: 'unavailable' }

  const days = rawDays.map(parseDay).filter((d): d is LangfuseDay => d !== null)
  const totalTraces = days.reduce((total, d) => total + d.traces, 0)
  const totalCost = days.reduce((total, d) => total + d.totalCost, 0)
  // Days arrive newest-first; the 7d pill window is the first seven entries.
  const totalCost7d = days
    .slice(0, PILL_WINDOW_DAYS)
    .reduce((total, d) => total + d.totalCost, 0)
  return { ok: true, data: { days, totalTraces, totalCost, totalCost7d } }
}

/** Total tokens from the v2 `usageDetails` map (its `total` key). */
function parseTokens(usageDetails: unknown): number {
  if (!usageDetails || typeof usageDetails !== 'object') return 0
  const total = (usageDetails as Record<string, unknown>).total
  return typeof total === 'number' ? total : 0
}

/** Narrows one raw v2 observation to a table row, or null without a start time. */
function parseObservation(raw: unknown): LangfuseTrace | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.startTime !== 'string') return null
  // ObservationV2.latency is in seconds (nullable double).
  const latencyMs = typeof obj.latency === 'number' ? Math.round(obj.latency * 1000) : null
  return {
    time: obj.startTime,
    name: typeof obj.name === 'string' ? obj.name : '(unnamed)',
    latencyMs,
    totalCost: typeof obj.totalCost === 'number' ? obj.totalCost : 0,
    tokens: parseTokens(obj.usageDetails),
    ...(typeof obj.providedModelName === 'string' ? { model: obj.providedModelName } : {}),
  }
}

export async function getLangfuseTraces(): Promise<OpsResult<LangfuseTracesSnapshot>> {
  const auth = resolveAuth()
  if (!auth) return { ok: false, reason: 'unconfigured' }

  const params = new URLSearchParams({
    limit: String(TRACES_LIMIT),
    type: 'GENERATION',
    fields: 'core,basic,model,usage,metrics',
  })
  const data = await fetchJson(`${auth.baseUrl}/api/public/v2/observations?${params.toString()}`, {
    headers: { Authorization: auth.header },
  })
  if (!data || typeof data !== 'object') return { ok: false, reason: 'unavailable' }
  const rawObservations = (data as Record<string, unknown>).data
  if (!Array.isArray(rawObservations)) return { ok: false, reason: 'unavailable' }

  const traces = rawObservations
    .map(parseObservation)
    .filter((t): t is LangfuseTrace => t !== null)
  return { ok: true, data: { traces } }
}
