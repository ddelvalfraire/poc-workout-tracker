const CACHE = 'workout-tracker-v1'
const OFFLINE_URL = '/'

self.addEventListener('install', (event) => {
  // Best-effort precache of the app shell so the offline navigation fallback
  // has something to serve. A failed precache (e.g. auth redirect) must never
  // block installation — installability is the whole point of this worker.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  // Drop caches from previous versions before taking control.
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

  // Network-first for navigations; fall back to the cached shell if offline.
  event.respondWith(
    fetch(request)
      .then((res) => {
        // Cache only successful, same-origin responses — never errors,
        // redirects, or opaque cross-origin responses.
        if (res.ok && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return res
      })
      .catch(() => caches.match(request).then((r) => r || caches.match(OFFLINE_URL))),
  )
})
