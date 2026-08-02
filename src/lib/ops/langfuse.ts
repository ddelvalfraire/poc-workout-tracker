/**
 * Langfuse daily-metrics snapshot for the ops board — the read-back twin of
 * the coach's span exporter (src/lib/coach/telemetry.ts). Pulls the last 7
 * days of trace/cost/token totals so the card shows AI-coach usage without
 * opening cloud.langfuse.com.
 *
 * Endpoint verified against Langfuse's public API docs
 * (langfuse.com/docs/analytics/daily-metrics-api):
 *   GET {baseUrl}/api/public/metrics/daily?limit=7
 *   Basic auth = base64(LANGFUSE_PUBLIC_KEY:LANGFUSE_SECRET_KEY)
 *   -> { data: [{ date, countTraces, countObservations, totalCost,
 *                 usage: [{ totalUsage, ... }] }], meta }
 *
 * Both keys are ALREADY set in every environment, so this card works today.
 * Either absent => 'unconfigured'. External payload is untrusted:
 * shape-checked at the boundary.
 *
 * Server-only: never import from a Client Component.
 */
import { fetchJson } from './fetch'
import type { OpsResult } from './types'

const DEFAULT_BASE_URL = 'https://cloud.langfuse.com'
const DAYS = 7

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
  days: LangfuseDay[]
  /** 7-day totals — the headline numbers the card leads with. */
  totalTraces: number
  totalCost: number
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
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY
  if (!publicKey || !secretKey) return { ok: false, reason: 'unconfigured' }

  const baseUrl = (process.env.LANGFUSE_BASEURL || DEFAULT_BASE_URL).replace(/\/$/, '')
  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString('base64')

  const data = await fetchJson(`${baseUrl}/api/public/metrics/daily?limit=${DAYS}`, {
    headers: { Authorization: `Basic ${auth}` },
  })
  if (!data || typeof data !== 'object') return { ok: false, reason: 'unavailable' }
  const rawDays = (data as Record<string, unknown>).data
  if (!Array.isArray(rawDays)) return { ok: false, reason: 'unavailable' }

  const days = rawDays.map(parseDay).filter((d): d is LangfuseDay => d !== null)
  const totalTraces = days.reduce((total, d) => total + d.traces, 0)
  const totalCost = days.reduce((total, d) => total + d.totalCost, 0)
  return { ok: true, data: { days, totalTraces, totalCost } }
}
