'use client'

import { useEffect } from 'react'

// One-shot per session so a persistent failure (e.g. genuinely offline) can't
// put the page in a reload loop.
const CHUNK_RELOAD_FLAG = 'sw-chunk-reload'

function isStaleChunkError(event: Event | PromiseRejectionEvent): boolean {
  if ('reason' in event) {
    const name = (event.reason as { name?: string } | null)?.name
    return name === 'ChunkLoadError'
  }
  const target = event.target
  return target instanceof HTMLScriptElement && target.src.includes('/_next/')
}

function reloadOnceForStaleChunks(event: Event | PromiseRejectionEvent) {
  if (!isStaleChunkError(event)) return
  if (sessionStorage.getItem(CHUNK_RELOAD_FLAG)) return
  sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1')
  // Chunks referenced by this document no longer exist on the server (the app
  // was redeployed, or the SW served a stale cached shell). The page is
  // already broken, so a full reload to fetch fresh HTML is the only recovery.
  window.location.reload()
}

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
    // Resource errors don't bubble — they only reach window in capture phase.
    window.addEventListener('error', reloadOnceForStaleChunks, true)
    window.addEventListener('unhandledrejection', reloadOnceForStaleChunks)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('error', reloadOnceForStaleChunks, true)
      window.removeEventListener('unhandledrejection', reloadOnceForStaleChunks)
    }
  }, [])

  return null
}
