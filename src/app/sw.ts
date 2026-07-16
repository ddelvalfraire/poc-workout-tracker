/// <reference lib="esnext" />
/// <reference lib="webworker" />
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
import { Serwist } from 'serwist'

/**
 * The Serwist worker source (compiled + manifest-injected by the
 * /serwist/[path] route). HOUSE POLICY — this file deliberately diverges
 * from Serwist's quickstart defaults:
 *
 * - Precache = IMMUTABLE BUILD ASSETS + offline.html only. Never app HTML,
 *   never RSC payloads (the v2 stale-shell white screens are this layer's
 *   founding lesson). The manifest filter below enforces it.
 * - NO skipWaiting / clientsClaim: a worker swap under a live page serves
 *   HTML whose chunks the new precache no longer holds. Versions activate
 *   when the old tabs close.
 * - NO runtimeCaching (no defaultCache): navigations stay network-first via
 *   our own handler with the single skew-race retry and the offline
 *   fallback (PR #68 semantics, ported verbatim).
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const OFFLINE_URL = '/offline.html'

/** Belt over the integration's own behavior: nothing that looks like a page
 *  document may enter the precache. Build assets are hashed /_next/static
 *  files; offline.html is the one deliberate exception. */
function isPrecacheSafe(entry: PrecacheEntry | string): boolean {
  const url = typeof entry === 'string' ? entry : entry.url
  if (url === OFFLINE_URL || url.endsWith(OFFLINE_URL)) return true
  return !url.endsWith('.html') && !url.endsWith('.rsc') && !url.endsWith('/')
}

const serwist = new Serwist({
  precacheEntries: (self.__SW_MANIFEST ?? []).filter(isPrecacheSafe),
  skipWaiting: false,
  clientsClaim: false,
  navigationPreload: false,
  runtimeCaching: [],
})

// One second-chance for a failed navigation fetch (PR #68): the post-deploy
// recovery reload races the just-woken radio by milliseconds — retry once
// before falling back to the self-healing offline page.
const NAV_RETRY_DELAY_MS = 1200

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (request.mode !== 'navigate') return
  event.respondWith(
    fetch(request)
      .catch(
        () =>
          new Promise((resolve) => setTimeout(resolve, NAV_RETRY_DELAY_MS)).then(() =>
            fetch(request),
          ),
      )
      .then((res) => res as Response)
      .catch(async () => {
        const cached = await caches.match(OFFLINE_URL)
        return cached ?? Response.error()
      }),
  )
})

serwist.addEventListeners()
