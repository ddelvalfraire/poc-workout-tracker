import { test } from './fixtures'
import { expect } from '@playwright/test'
import { ROUTE_MANIFEST } from './route-manifest'
import { resolveManifest } from './resolve-manifest'
import { buildPath } from './build-path'

/** reducedMotion: 'reduce' is set at the PROJECT level (playwright.screens
 *  config's capture:<slug> `use` block), not per-test — do not duplicate it
 *  here. */
const VIEWPORT_SIZES = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 900 },
} as const

for (const route of ROUTE_MANIFEST) {
  for (const viewport of route.viewports) {
    test(`${route.slug} @ ${viewport}`, async ({ page, personaSlug }, testInfo) => {
      test.skip(route.enabled === false, `route disabled: ${route.slug}`)

      const resolved = await resolveManifest(personaSlug)
      const { path, missing } = buildPath(route.pathTemplate, route.params, resolved)
      test.skip(missing.length > 0, `unresolved params: ${missing.join(', ')}`)

      await page.setViewportSize(VIEWPORT_SIZES[viewport])
      await page.goto(path)
      await expect(route.readySignal(page, resolved)).toBeVisible({ timeout: 15_000 })

      const png = await page.screenshot({ fullPage: true })
      await testInfo.attach(`${route.slug}@${viewport}`, { body: png, contentType: 'image/png' })
    })
  }
}
