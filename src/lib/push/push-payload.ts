/**
 * The one payload shape that crosses the push channel, shared by the sender
 * (lib/push.ts encrypts it) and the service worker (app/sw.ts displays it).
 * Kept dependency-free and pure so the SW can import it without dragging
 * anything else into the worker bundle, and so it is testable outside a
 * worker context.
 */

export interface PushPayload {
  title: string
  body: string
  /** In-app path the notification opens, e.g. '/'. */
  url: string
}

const MAX_TEXT = 500

/** True for a non-empty string within the sanity cap. */
function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT
}

/**
 * Guards a decoded push message into a displayable payload, or null when
 * malformed — the SW shows nothing rather than a broken notification. Only
 * same-origin paths pass as `url` (a push payload must never open an
 * arbitrary external site); missing/junk urls fall back to '/'.
 */
export function parsePushPayload(data: unknown): PushPayload | null {
  if (typeof data !== 'object' || data === null) return null
  const record = data as Record<string, unknown>
  if (!isText(record.title) || !isText(record.body)) return null
  const url =
    isText(record.url) && record.url.startsWith('/') && !record.url.startsWith('//')
      ? record.url
      : '/'
  return { title: record.title, body: record.body, url }
}
