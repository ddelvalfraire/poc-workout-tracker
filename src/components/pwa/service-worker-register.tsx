'use client'

import { useEffect } from 'react'

// Registration only. Stale-chunk recovery lives in ChunkRecoveryScript (an
// inline pre-boot script in the root layout): when the entry chunks
// themselves 404, this component never mounts, so recovery cannot live here.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    // The Serwist-compiled worker (src/app/sw.ts, served by /serwist/[path]
    // with the precache manifest injected). Explicit root scope: the script
    // lives under /serwist/, and the route serves Service-Worker-Allowed: /
    // to permit it. Same-scope registration supersedes the legacy /sw.js
    // worker on existing installs; no skipWaiting, so the swap lands when
    // the old tabs close.
    navigator.serviceWorker.register('/serwist/sw.js', { scope: '/' }).catch(() => {
      // Registration failures are non-fatal; the app works without the SW.
    })

    // Check for a new worker version when the user returns to the tab, so
    // updates are picked up promptly even though the worker no longer calls
    // skipWaiting().
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      navigator.serviceWorker.getRegistration().then((reg) => reg?.update().catch(() => {}))
    }

    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return null
}
