import { test, expect } from '@playwright/test'

/**
 * PWA installability surface. The manifest, service worker, and icons are
 * fetched by the browser UNCREDENTIALED, so they must be public (the auth
 * middleware matcher excludes .webmanifest/.js/.png). These checks use the
 * `request` fixture — no sign-in needed — and assert each path is served
 * directly (200, correct content-type) with no redirect to /sign-in.
 *
 * Note: `npm run dev` does NOT register the SW (production-gated), so we only
 * assert /sw.js is served, never that it activates.
 */

test('manifest is public and well-formed', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest')
  expect(res.status()).toBe(200)

  const body = await res.json()
  expect(body.name).toBe('Workout Tracker')
  expect(body.display).toBe('standalone')
  expect(Array.isArray(body.icons)).toBe(true)
  expect(body.icons.length).toBeGreaterThanOrEqual(2)
})

test('service worker is served as JavaScript, scoped to the root', async ({ request }) => {
  // /serwist/sw.js, not /sw.js: the worker is compiled from src/app/sw.ts and
  // served by the src/app/serwist/[path] route, which is also what
  // service-worker-register.tsx registers. There is no file in public/ any
  // more, so the old path 404s as HTML — and did so silently, because a 404
  // page is still a 200-shaped response to nothing this spec checked.
  const res = await request.get('/serwist/sw.js')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('javascript')
  // The route sets this itself so a worker served from /serwist/ can still
  // control the whole origin. Without it the registration's scope is rejected.
  expect(res.headers()['service-worker-allowed']).toBe('/')
})

for (const icon of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
  test(`icon ${icon} is a public PNG`, async ({ request }) => {
    const res = await request.get(`/icons/${icon}`)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('image/png')
  })
}
