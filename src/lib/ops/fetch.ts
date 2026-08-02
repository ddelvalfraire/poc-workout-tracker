/**
 * Ops fetch helper: one GET with a hard timeout, returning parsed JSON or a
 * typed failure. Every ops source is a read-only vendor GET on the /ops
 * render path, so they share one policy here rather than re-implementing it:
 *
 * - 5s AbortController timeout — a slow vendor must not stall the dashboard.
 * - No cache: /ops is always live (the page itself is force-dynamic).
 * - Never throws — network error, non-2xx, timeout, or unparseable body all
 *   collapse to `null`; the caller maps that to `{ ok: false, reason:
 *   'unavailable' }`. The upstream JSON is untrusted and re-checked by callers.
 */

/** Ops-wide upstream deadline. Vendor GETs must answer within this or degrade. */
export const OPS_FETCH_TIMEOUT_MS = 5_000

interface FetchJsonOptions {
  headers?: Record<string, string>
  timeoutMs?: number
}

/**
 * GETs `url` and parses the JSON body. Returns `null` on any failure (non-2xx,
 * network error, timeout, malformed JSON) — callers decide what that means.
 */
export async function fetchJson(url: string, options: FetchJsonOptions = {}): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? OPS_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', ...options.headers },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) return null
    return (await response.json()) as unknown
  } catch {
    // Timeout (abort), DNS/connect failure, or JSON parse error — all soft.
    return null
  } finally {
    clearTimeout(timeout)
  }
}
