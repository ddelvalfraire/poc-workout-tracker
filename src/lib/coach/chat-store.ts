import type { UIMessage } from 'ai'
import { getRedis } from '@/lib/redis'
import { MAX_MESSAGES, parseStoredChatMessages } from './chat-request'

/**
 * Redis-backed coach conversation persistence — one thread per user, saved
 * after each completed turn, loaded when /coach mounts. Redis is the right
 * home BECAUSE chat history is disposable: a TTL'd or evicted conversation
 * is an acceptable loss, so every operation fails soft (chat still works
 * with no Redis, it just forgets on refresh). Promote to Postgres only if
 * conversations become a first-class artifact (threads, search).
 */

const TTL_SECONDS = 30 * 24 * 60 * 60

export function coachChatKey(userId: string): string {
  return `coach:chat:${userId}`
}

export async function loadCoachChat(userId: string): Promise<UIMessage[]> {
  const redis = getRedis()
  if (!redis) return []
  try {
    const stored = await redis.get(coachChatKey(userId))
    if (!stored) return []
    // Upstash auto-deserializes JSON values; tolerate a raw string anyway.
    const value: unknown = typeof stored === 'string' ? JSON.parse(stored) : stored
    // Shape-only validation (no request caps): loading must accept anything
    // saving wrote — a corrupt or stale-format blob resets to an empty
    // thread instead of crashing chat, but a big-but-valid thread loads.
    const parsed = parseStoredChatMessages(value)
    return parsed.ok ? parsed.messages : []
  } catch (error: unknown) {
    console.error('[coach] chat load failed', error)
    return []
  }
}

export async function saveCoachChat(userId: string, messages: UIMessage[]): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    // Keep only what the request path will accept back.
    const trimmed = messages.slice(-MAX_MESSAGES)
    await redis.set(coachChatKey(userId), JSON.stringify(trimmed), { ex: TTL_SECONDS })
  } catch (error: unknown) {
    console.error('[coach] chat save failed', error)
  }
}

export async function clearCoachChat(userId: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.del(coachChatKey(userId))
  } catch (error: unknown) {
    console.error('[coach] chat clear failed', error)
  }
}
