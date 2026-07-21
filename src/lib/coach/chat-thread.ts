import type { UIMessage } from 'ai'

/**
 * Server-authoritative thread reconciliation for /api/chat. The client sends
 * only the tail message of the conversation; the server owns the rest of the
 * thread (chat-store). This keeps request payloads bounded — full threads
 * carry every tool input/output and blow past the body caps after tool-heavy
 * turns, which is exactly the "fails at the end of the message after" bug.
 *
 * Callers: src/app/api/chat/route.ts (POST handler, new payload shape).
 */

export type ThreadReconcileResult =
  | { ok: true; messages: UIMessage[] }
  | { ok: false; error: string }

/**
 * Merges the incoming tail message into the stored thread:
 * - user tail → appended (a fresh send);
 * - assistant tail whose id matches the stored last assistant message →
 *   replaces it (approval-response continuation: addToolApprovalResponse
 *   mutates that message client-side, so the tail is the newer copy);
 * - anything else (assistant tail with no matching stored message, system
 *   tail) means client and server disagree about the conversation → error.
 */
export function reconcileThread(stored: UIMessage[], tail: UIMessage): ThreadReconcileResult {
  if (tail.role === 'user') {
    return { ok: true, messages: [...stored, tail] }
  }
  const last = stored.at(-1)
  if (tail.role === 'assistant' && last?.role === 'assistant' && last.id === tail.id) {
    return { ok: true, messages: [...stored.slice(0, -1), tail] }
  }
  return { ok: false, error: 'Conversation out of sync — reload the chat and try again' }
}
