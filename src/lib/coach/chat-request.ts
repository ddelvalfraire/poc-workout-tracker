import type { UIMessage } from 'ai'

/**
 * Server-side validation for the /api/chat request body. The route casts to
 * UIMessage only after these structural checks pass, so malformed entries
 * become a clean 400 instead of exploding inside convertToModelMessages as a
 * 500. Validation is shape-level (roles, parts arrays, part types) — the AI
 * SDK owns deeper semantics.
 */

/** Payload bounds: the step cap limits loop iterations, not input volume —
 *  without these, the daily request cap still admits arbitrarily large
 *  provider calls. MAX_MESSAGES doubles as the model-context window: the
 *  route slices the reconciled thread to the last 60 rather than rejecting. */
export const MAX_MESSAGES = 60
export const MAX_BODY_BYTES = 120_000
/** Bound for the single tail message the current client sends — a typed user
 *  message or an approval-response assistant tail (which carries the tool
 *  input being approved, so it is not tiny). */
export const MAX_MESSAGE_BYTES = 32_000

const ROLES = new Set(['user', 'assistant', 'system'])

export type ChatMessagesResult =
  | { ok: true; messages: UIMessage[] }
  | { ok: false; error: string }

export type ChatMessageResult = { ok: true; message: UIMessage } | { ok: false; error: string }

/** Shape check for one message; returns an error string or null when valid. */
function messageShapeError(message: unknown, label: string): string | null {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return `Malformed message${label}`
  }
  const candidate = message as Record<string, unknown>
  if (typeof candidate.role !== 'string' || !ROLES.has(candidate.role)) {
    return `Malformed message${label}: bad role`
  }
  if (candidate.id !== undefined && typeof candidate.id !== 'string') {
    return `Malformed message${label}: bad id`
  }
  if (!Array.isArray(candidate.parts)) {
    return `Malformed message${label}: parts must be an array`
  }
  for (const part of candidate.parts) {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) {
      return `Malformed message${label}: bad part`
    }
    const partCandidate = part as Record<string, unknown>
    if (typeof partCandidate.type !== 'string') {
      return `Malformed message${label}: part has no type`
    }
    if (partCandidate.type === 'text' && typeof partCandidate.text !== 'string') {
      return `Malformed message${label}: text part has no text`
    }
  }
  return null
}

function parseMessagesArray(value: unknown, maxMessages: number | null): ChatMessagesResult {
  if (!Array.isArray(value)) {
    return { ok: false, error: '`messages` must be an array' }
  }
  if (maxMessages !== null && value.length > maxMessages) {
    return {
      ok: false,
      error: `Conversation too long — send at most the last ${maxMessages} messages`,
    }
  }
  for (const [index, message] of value.entries()) {
    const error = messageShapeError(message, ` at index ${index}`)
    if (error) return { ok: false, error }
  }
  return { ok: true, messages: value as UIMessage[] }
}

/** Request-path validation: bounded, non-empty (legacy full-thread payloads). */
export function parseChatMessages(value: unknown): ChatMessagesResult {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: '`messages` must be a non-empty array' }
  }
  return parseMessagesArray(value, MAX_MESSAGES)
}

/**
 * Store-load validation: shape-only, no count cap and empty allowed. Loading
 * must tolerate anything saving wrote — request caps belong to the request
 * path, and a big-but-valid persisted thread must not hard-fail the /coach
 * page or the reconcile step.
 */
export function parseStoredChatMessages(value: unknown): ChatMessagesResult {
  return parseMessagesArray(value, null)
}

/** Validates the single tail message of the current request shape, including
 *  its own byte cap (the raw-body cap is sized for legacy full threads). */
export function parseChatMessage(value: unknown): ChatMessageResult {
  const error = messageShapeError(value, '')
  if (error) return { ok: false, error }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_MESSAGE_BYTES) {
    return { ok: false, error: 'Message too large' }
  }
  return { ok: true, message: value as UIMessage }
}
