'use client'

import { useEffect } from 'react'

// Registration only. Stale-chunk recovery lives in ChunkRecoveryScript (an
// inline pre-boot script in the root layout): when the entry chunks
// themselves 404, this component never mounts, so recovery cannot live here.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.register('/sw.js').catch(() => {
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
