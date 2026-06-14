import { Redis } from '@upstash/redis'

/**
 * Lazily-constructed Upstash Redis client (REST-based, safe on serverless — no
 * connection pooling to exhaust). Returns `null` when the credentials are not
 * configured so callers can gracefully fall back to their source of truth
 * (e.g. fetching directly from wger). The client is memoised across requests
 * via a module-level singleton.
 *
 * Server-only: never import this into a Client Component.
 */

let client: Redis | null | undefined

export function getRedis(): Redis | null {
  if (client !== undefined) return client

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  client = url && token ? new Redis({ url, token }) : null
  return client
}
