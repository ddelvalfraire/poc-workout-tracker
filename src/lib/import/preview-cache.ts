import { gzipSync, gunzipSync } from 'node:zlib'
import { getRedis } from '@/lib/redis'
import { isImportSource, type ParsedImport } from './types'

/**
 * Server-side stash of a parsed import between preview and confirm, so the
 * confirm click doesn't re-upload a 20MB file. Keyed by a random token the
 * client holds; the key is ALSO scoped by userId, so a leaked/guessed token
 * can never commit another user's file. Gzip+base64 because the JSON of a
 * long history can flirt with Upstash's request ceiling; 15-minute TTL —
 * a preview is a moment's decision, not a saved artifact.
 *
 * Server-only (node:zlib): never import into a Client Component.
 */

const TTL_SECONDS = 15 * 60

export interface CachedPreview {
  parsed: ParsedImport
  fileName: string | null
}

function cacheKey(userId: string, token: string): string {
  return `import:preview:${userId}:${token}`
}

/** Stores the parsed payload; returns the confirm token, or null when Redis
 *  isn't configured (the route degrades to an honest "unavailable"). */
export async function storePreview(userId: string, payload: CachedPreview): Promise<string | null> {
  const redis = getRedis()
  if (!redis) return null
  const token = crypto.randomUUID()
  const encoded = gzipSync(JSON.stringify(payload)).toString('base64')
  await redis.set(cacheKey(userId, token), encoded, { ex: TTL_SECONDS })
  return token
}

/** Loads a stashed preview; null on miss/expiry/malformed payload. */
export async function loadPreview(userId: string, token: string): Promise<CachedPreview | null> {
  const redis = getRedis()
  if (!redis) return null
  const encoded = await redis.get<string>(cacheKey(userId, token))
  if (typeof encoded !== 'string' || encoded === '') return null
  try {
    const payload: unknown = JSON.parse(gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'))
    return isCachedPreview(payload) ? payload : null
  } catch {
    // A corrupt cache entry reads as a miss — the user re-uploads; never a 500.
    return null
  }
}

/** Removes a stashed preview after a successful commit (single-use token). */
export async function deletePreview(userId: string, token: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.del(cacheKey(userId, token))
}

/** Shape check for the round-tripped payload. Our own writes are the only
 *  producer, but cache content is still external state — verify, don't trust. */
function isCachedPreview(value: unknown): value is CachedPreview {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  if (obj.fileName !== null && typeof obj.fileName !== 'string') return false
  const parsed = obj.parsed as Record<string, unknown> | null | undefined
  if (!parsed || typeof parsed !== 'object') return false
  return (
    isImportSource(parsed.source) &&
    (parsed.sourceUnit === 'kg' || parsed.sourceUnit === 'lb') &&
    Array.isArray(parsed.workouts) &&
    Array.isArray(parsed.skipped) &&
    Array.isArray(parsed.warnings)
  )
}
