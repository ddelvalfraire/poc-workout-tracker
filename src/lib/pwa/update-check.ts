/**
 * Pure logic for the proactive update-on-resume probe. The dominant stale-PWA
 * scenario is resume-after-deploy: the installed app wakes with old chunks in
 * memory and white-screens on the first tap. Instead of waiting for a chunk
 * to die (chunk-recovery's reactive job), the client compares its build id —
 * baked in at build time — against /api/version (always served by the newest
 * deployment) and reloads BEFORE the user touches anything.
 */

/** Resume-time re-checks are throttled; a backgrounded-for-days PWA is the
 *  target, not tab-switch churn. */
export const VERSION_CHECK_MIN_INTERVAL_MS = 60_000

/** True only when both ids are known and disagree — a missing or malformed
 *  side must never trigger a blind reload. Type predicate: a true return
 *  proves `deployed` is a non-empty string, so callers need no cast. */
export function isUpdateAvailable(
  current: string | undefined,
  deployed: unknown,
): deployed is string {
  if (!current) return false
  if (typeof deployed !== 'string' || deployed.length === 0) return false
  return deployed !== current
}

/**
 * Routes where an auto-reload could interrupt live logging. The logger
 * autosaves drafts server-side, but a surprise reload mid-set is exactly the
 * disruption the SW's no-skipWaiting policy exists to avoid — the probe skips
 * these and catches the update on the next resume elsewhere.
 */
export function isProtectedPath(pathname: string): boolean {
  return pathname === '/workout/new' || /^\/workout\/[^/]+\/edit$/.test(pathname)
}

/** Throttle gate for the visibilitychange-driven checks. */
export function shouldCheckNow(lastCheckAt: number | null, now: number): boolean {
  return lastCheckAt === null || now - lastCheckAt >= VERSION_CHECK_MIN_INTERVAL_MS
}

/** The last update-reload attempt, persisted in sessionStorage — it must
 *  survive the reload it triggers (in-memory state can't). */
export interface ReloadStamp {
  buildId: string
  at: number
}

/** One reload attempt per deployed id per cooldown. A reload wipes all
 *  in-memory state, so without this a mid-deploy CDN window (stale HTML edge,
 *  fresh /api/version) loops reloads until propagation finishes; with it, a
 *  persistent mismatch degrades to stale-but-usable. A NEW deployed id gets a
 *  fresh attempt immediately — it's a different deploy, not the wedged one. */
export const UPDATE_RELOAD_COOLDOWN_MS = 5 * 60_000

export function shouldReloadForUpdate(
  lastReload: ReloadStamp | null,
  deployed: string,
  now: number,
): boolean {
  if (lastReload === null) return true
  if (lastReload.buildId !== deployed) return true
  return now - lastReload.at >= UPDATE_RELOAD_COOLDOWN_MS
}

/** Defensive parse of the persisted stamp — storage contents are untrusted. */
export function parseReloadStamp(raw: string | null): ReloadStamp | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as ReloadStamp).buildId === 'string' &&
      typeof (parsed as ReloadStamp).at === 'number'
    ) {
      return { buildId: (parsed as ReloadStamp).buildId, at: (parsed as ReloadStamp).at }
    }
    return null
  } catch {
    return null
  }
}
