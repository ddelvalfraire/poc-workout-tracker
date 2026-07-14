'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import {
  isUpdateAvailable,
  isProtectedPath,
  shouldCheckNow,
  shouldReloadForUpdate,
  parseReloadStamp,
} from '@/lib/pwa/update-check'

// sessionStorage key for the last reload attempt — must survive the reload
// it triggers, so it cannot live in component state/refs.
const RELOAD_STAMP_KEY = 'update-reload'

/**
 * Proactive stale-build detection for the installed PWA. On mount and on every
 * background→foreground resume, compares this bundle's baked-in build id
 * against /api/version (served by the newest deployment) and hard-reloads on
 * mismatch — BEFORE the user taps into a dead chunk. Complements the reactive
 * pre-boot chunk-recovery script, which stays as the net for failures this
 * probe can't prevent (deploys landing mid-session).
 *
 * Never reloads on the live logger routes (isProtectedPath): a surprise
 * reload mid-set is worse than stale code; the update lands on the next
 * resume elsewhere. Probe failures (offline, transient) are silently skipped
 * — the next resume retries.
 */
export function UpdateOnResume() {
  const pathname = usePathname()
  // The visibilitychange listener is mounted once; it reads the CURRENT
  // pathname through a ref so route changes don't re-subscribe it. Synced in
  // an effect — lint (correctly) forbids ref writes during render.
  const pathnameRef = useRef(pathname)
  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])
  const lastCheckAtRef = useRef<number | null>(null)

  useEffect(() => {
    // Dev servers have no deploy skew, and the id would churn every restart.
    if (process.env.NODE_ENV !== 'production') return

    async function check() {
      if (!shouldCheckNow(lastCheckAtRef.current, Date.now())) return
      lastCheckAtRef.current = Date.now()
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        // Untrusted boundary: validate the shape instead of casting blind.
        const data: unknown = await res.json()
        const deployed =
          typeof data === 'object' && data !== null && 'buildId' in data
            ? (data as { buildId: unknown }).buildId
            : null
        if (
          !isUpdateAvailable(process.env.NEXT_PUBLIC_BUILD_ID, deployed) ||
          isProtectedPath(pathnameRef.current)
        ) {
          return
        }
        // Reload-loop guard: one attempt per deployed id per cooldown,
        // persisted in sessionStorage because the reload wipes this closure.
        // Storage unavailable → fail CLOSED (no reload): this path is
        // proactive polish, and the reactive chunk-recovery script still
        // catches genuinely dead chunks.
        try {
          const stamp = parseReloadStamp(sessionStorage.getItem(RELOAD_STAMP_KEY))
          if (!shouldReloadForUpdate(stamp, deployed, Date.now())) return
          sessionStorage.setItem(
            RELOAD_STAMP_KEY,
            JSON.stringify({ buildId: deployed, at: Date.now() }),
          )
        } catch {
          return
        }
        window.location.reload()
      } catch {
        // Offline or transient — stale-but-working beats a failed probe loop.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void check()
    }

    void check()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  return null
}
