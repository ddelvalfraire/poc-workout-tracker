const CACHE = 'workout-tracker-v3'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  // Precache ONLY the static offline page. Never precache or runtime-cache
  // real app HTML: a cached shell references hashed /_next chunks that stop
  // existing after the next deploy, and serving it on a flaky resume is how
  // the app white-screened (stale shell → dead chunks → React never boots).
  //
  // No skipWaiting(): a new worker taking over a live page can serve HTML
  // whose hashed /_next chunks no longer exist, and a forced reload would
  // destroy the in-memory workout draft. New versions activate once all tabs
  // from the old version are closed.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .catch(() => {}),
  )
})

// The install-time precache is best-effort and can fail (transient blip,
// install while offline) — and the offline page IS the whole safety net, so
// a missed precache must not stay missed for the worker's lifetime. Re-check
// on activate, and lazily on any successful navigation, until it's cached.
function ensureOfflinePageCached() {
  return caches
    .open(CACHE)
    .then((cache) =>
      cache.match(OFFLINE_URL).then((hit) => (hit ? undefined : cache.add(OFFLINE_URL))),
    )
    .catch(() => {})
}

self.addEventListener('activate', (event) => {
  // Drop caches from previous versions (including v2's stale HTML shells)
  // before taking control, and give the offline-page precache a second chance.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(ensureOfflinePageCached)
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (request.mode !== 'navigate') return

  // Network-first for navigations; when truly offline, serve the chunk-free
  // offline page instead of a stale app shell that can never boot. Successful
  // navigations double as backfill opportunities for a missed precache.
  event.respondWith(
    fetch(request)
      .then((res) => {
        event.waitUntil(ensureOfflinePageCached())
        return res
      })
      .catch(() => caches.match(OFFLINE_URL)),
  )
})
