/**
 * Shared result contract for every ops fetch module. Each source returns
 * `{ ok: true, data }` or `{ ok: false, reason }` — the same typed
 * unconfigured/unavailable idiom as wger-templates.ts, generalized so the
 * /ops page can render a uniform status dot per card:
 *
 * - 'unconfigured' — the required env var(s) are absent. The card shows which
 *   var to set; NEVER hits the network.
 * - 'unavailable'  — configured, but the upstream call failed, timed out, or
 *   returned an unusable payload. Fails soft; the card shows a degraded state.
 *
 * Modules NEVER throw into the page — a dead vendor must not blank the board.
 */

export type OpsUnavailableReason = 'unconfigured' | 'unavailable'

export type OpsResult<T> = { ok: true; data: T } | { ok: false; reason: OpsUnavailableReason }
