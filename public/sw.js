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

self.addEventListener('activate', (event) => {
  // Drop caches from previous versions (including v2's stale HTML shells)
  // before taking control.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (request.mode !== 'navigate') return

  // Network-first for navigations; when truly offline, serve the chunk-free
  // offline page instead of a stale app shell that can never boot.
  event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)))
})
