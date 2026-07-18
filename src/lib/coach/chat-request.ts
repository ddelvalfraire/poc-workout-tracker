import type { UIMessage } from 'ai'

/**
 * Server-side validation for the /api/chat request body. The route casts to
 * UIMessage[] only after this structural check passes, so malformed entries
 * become a clean 400 instead of exploding inside convertToModelMessages as a
 * 500. Validation is shape-level (roles, parts arrays, part types) — the AI
 * SDK owns deeper semantics.
 */

/** Payload bounds: the step cap limits loop iterations, not input volume —
 *  without these, the daily request cap still admits arbitrarily large
 *  provider calls. Sized generously above real chat usage. */
export const MAX_MESSAGES = 60
export const MAX_BODY_BYTES = 120_000

const ROLES = new Set(['user', 'assistant', 'system'])

export type ChatMessagesResult =
  | { ok: true; messages: UIMessage[] }
  | { ok: false; error: string }

export function parseChatMessages(value: unknown): ChatMessagesResult {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: '`messages` must be a non-empty array' }
  }
  if (value.length > MAX_MESSAGES) {
    return {
      ok: false,
      error: `Conversation too long — send at most the last ${MAX_MESSAGES} messages`,
    }
  }
  for (const [index, message] of value.entries()) {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      return { ok: false, error: `Malformed message at index ${index}` }
    }
    const candidate = message as Record<string, unknown>
    if (typeof candidate.role !== 'string' || !ROLES.has(candidate.role)) {
      return { ok: false, error: `Malformed message at index ${index}: bad role` }
    }
    if (candidate.id !== undefined && typeof candidate.id !== 'string') {
      return { ok: false, error: `Malformed message at index ${index}: bad id` }
    }
    if (!Array.isArray(candidate.parts)) {
      return { ok: false, error: `Malformed message at index ${index}: parts must be an array` }
    }
    for (const part of candidate.parts) {
      if (typeof part !== 'object' || part === null || Array.isArray(part)) {
        return { ok: false, error: `Malformed message at index ${index}: bad part` }
      }
      const partCandidate = part as Record<string, unknown>
      if (typeof partCandidate.type !== 'string') {
        return { ok: false, error: `Malformed message at index ${index}: part has no type` }
      }
      if (partCandidate.type === 'text' && typeof partCandidate.text !== 'string') {
        return { ok: false, error: `Malformed message at index ${index}: text part has no text` }
      }
    }
  }
  return { ok: true, messages: value as UIMessage[] }
}
