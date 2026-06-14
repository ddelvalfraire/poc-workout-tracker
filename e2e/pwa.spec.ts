import { test, expect } from '@playwright/test'

/**
 * PWA installability surface. The manifest, service worker, and icons are
 * fetched by the browser UNCREDENTIALED, so they must be public (the Clerk
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

test('service worker is served as JavaScript', async ({ request }) => {
  const res = await request.get('/sw.js')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('javascript')
})

for (const icon of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
  test(`icon ${icon} is a public PNG`, async ({ request }) => {
    const res = await request.get(`/icons/${icon}`)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('image/png')
  })
}
