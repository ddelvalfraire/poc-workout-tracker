import { getRedis } from '@/lib/redis'
import type { OpsResult } from './types'

/**
 * Redis-backed TTL cache with stale-on-error for the ops vendor adapters.
 * Every /ops view fetched fresh (fetchJson is no-store, the page is
 * force-dynamic), which exhausts free-tier vendor quotas — Langfuse's daily
 * metrics endpoint allows 10 requests per window, so a few views plus the
 * 60s auto-refresh 429s it and the panel degrades. The cache turns "every
 * render" into "once per TTL" per vendor.
 *
 * Two keys per entry:
 * - `ops:{key}`        — fresh copy, per-vendor TTL. A hit skips the vendor.
 * - `ops:stale:{key}`  — long-lived copy (7d), rewritten on every ok fetch.
 *   When the vendor degrades AND a stale copy exists, it is served as
 *   `ok: true` with `staleAt` so panels can note "as of 3h ago" instead of
 *   blanking. No stale copy → the fetcher's degrade passes through.
 *
 * No Redis configured → straight passthrough: the degrade contract is
 * unchanged and adapters behave exactly as before. Redis errors fail soft on
 * every path (a cache must never take a panel down).
 *
 * Values are JSON strings ({ data, fetchedAt }); vendor snapshots are
 * JSON-safe by construction (all timestamps are ISO strings — no Dates).
 * Reads tolerate Upstash's automatic JSON deserialization, same as
 * coach/chat-store.ts.
 *
 * Server-only: never import from a Client Component.
 */

/** Stale copies outlive the fresh TTL by design: 7 days. */
export const OPS_STALE_TTL_SECONDS = 7 * 24 * 60 * 60

interface CacheEntry<T> {
  data: T
  /** ISO-8601 write time — surfaced as `staleAt` when served stale. */
  fetchedAt: string
}

/**
 * Narrows a stored value to a cache entry; null on any mismatch so corrupt
 * or legacy blobs fall through to a real fetch instead of crashing a panel.
 * `data` is trusted as T: this cache only ever stores what the typed fetcher
 * returned under the same key.
 */
function parseEntry<T>(stored: unknown): CacheEntry<T> | null {
  try {
    const value: unknown = typeof stored === 'string' ? JSON.parse(stored) : stored
    if (!value || typeof value !== 'object') return null
    const obj = value as Record<string, unknown>
    if (typeof obj.fetchedAt !== 'string' || !('data' in obj)) return null
    return { data: obj.data as T, fetchedAt: obj.fetchedAt }
  } catch {
    return null
  }
}

/**
 * Serves `key` from the fresh cache, else runs `fetcher`: ok results
 * populate both keys and return as-is; degraded results fall back to the
 * stale copy (as ok + staleAt) when one exists.
 *
 * Callers must check 'unconfigured' BEFORE calling (the adapters all do):
 * an unconfigured vendor should name its env var, not serve stale data.
 */
export async function cachedOpsFetch<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<OpsResult<T>>,
): Promise<OpsResult<T>> {
  const redis = getRedis()
  if (!redis) return fetcher()

  const freshKey = `ops:${key}`
  const staleKey = `ops:stale:${key}`

  try {
    const hit = parseEntry<T>(await redis.get(freshKey))
    if (hit) return { ok: true, data: hit.data }
  } catch (error: unknown) {
    console.error('[ops] cache read failed', error)
  }

  const result = await fetcher()

  if (result.ok) {
    const payload = JSON.stringify({
      data: result.data,
      fetchedAt: new Date().toISOString(),
    } satisfies CacheEntry<T>)
    try {
      await Promise.all([
        redis.set(freshKey, payload, { ex: ttlSeconds }),
        redis.set(staleKey, payload, { ex: OPS_STALE_TTL_SECONDS }),
      ])
    } catch (error: unknown) {
      console.error('[ops] cache write failed', error)
    }
    return result
  }

  try {
    const stale = parseEntry<T>(await redis.get(staleKey))
    if (stale) return { ok: true, data: stale.data, staleAt: stale.fetchedAt }
  } catch (error: unknown) {
    console.error('[ops] stale read failed', error)
  }
  return result
}
