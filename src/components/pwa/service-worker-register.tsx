'use client'

import { useEffect } from 'react'
import type { Serwist } from '@serwist/window'
import { isProtectedPath } from '@/lib/pwa/update-check'

// Registration + controlled worker takeover. Stale-chunk recovery still lives
// in ChunkRecoveryScript (an inline pre-boot script): when the entry chunks
// themselves 404 this component never mounts, so recovery cannot live here.
//
// The bug this fixes: the previous raw navigator.serviceWorker.register() had
// NO update handling, so a freshly-installed worker (skipWaiting:false) sat in
// `waiting` forever. The old code assumed the swap "lands when the old tabs
// close" — true for a browser tab, FALSE for an installed standalone PWA,
// whose controlling client is suspended, never closed. Result: installs (and
// long-lived tabs) wedged on an old worker and never picked up new deploys.
//
// Fix: use @serwist/window, which exposes the worker lifecycle. When a new
// worker is waiting we message it to activate (Serwist's worker honors
// SKIP_WAITING even under skipWaiting:false) and reload once it takes control
// — but ONLY on a reload-safe path, so a swap never lands mid-set. On a
// protected logger path we leave it waiting; the resume path below retries the
// takeover the next time the user is somewhere safe.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    let cancelled = false
    let reloaded = false
    let serwist: Serwist | undefined

    const takeOverIfSafe = () => {
      // messageSkipWaiting is a no-op when nothing is waiting, so an
      // unconditional call on a safe path is cheap and covers the deferred
      // case (a worker left waiting because the last visit was mid-set).
      if (!isProtectedPath(window.location.pathname)) serwist?.messageSkipWaiting()
    }

    void (async () => {
      const { Serwist } = await import('@serwist/window')
      if (cancelled) return
      serwist = new Serwist('/serwist/sw.js', { scope: '/' })

      // Reload once the new worker controls the page — but only for a genuine
      // update. `controlling` also fires on the first-ever install (isUpdate
      // false), where a reload would be a pointless flash for a new user.
      serwist.addEventListener('controlling', (event) => {
        if (reloaded || !event.isUpdate) return
        reloaded = true
        window.location.reload()
      })

      // A newer worker has installed and is waiting. Drive the takeover here
      // instead of waiting for every client to close (which never happens for
      // an installed PWA). Gated on a reload-safe path.
      serwist.addEventListener('waiting', takeOverIfSafe)

      await serwist.register()
    })()

    // On return to the tab: pull any newer worker, and retry a takeover that a
    // previous mid-set visit deferred.
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !serwist) return
      void serwist.update()
      takeOverIfSafe()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return null
}
