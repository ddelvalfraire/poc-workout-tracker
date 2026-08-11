import { test, expect } from '@playwright/test'
import { clerk } from '@clerk/testing/playwright'

/**
 * Visual-regression screenshots of the key surfaces, in the states a FRESH
 * account renders deterministically (day-one home, empty lists, the curated
 * template library). A disposable `+clerk_test` user (same provisioning as
 * workout.spec.ts) guarantees no history bleeds into the pixels; Playwright
 * disables CSS animations for the capture, so rise-in choreography can't
 * flake the diff.
 *
 * Baselines live in e2e/visual.spec.ts-snapshots/ and are committed — a
 * styling PR that moves pixels on these surfaces fails here and regenerates
 * deliberately with `--update-snapshots`. Home is captured at phone AND
 * desktop width: the md bento layout (#194) is exactly the kind of change
 * this suite exists to catch.
 */

const CLERK_API = 'https://api.clerk.com/v1'
const SECRET = process.env.CLERK_SECRET_KEY!
const STAMP = Date.now()
const TEST_EMAIL = `e2e+clerk_test_visual_${STAMP}@example.com`

let userId: string

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 900 }

test.beforeAll(async () => {
  const res = await fetch(`${CLERK_API}/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email_address: [TEST_EMAIL],
      password: `Pw-e2e-${STAMP}-aZ9!`,
      skip_password_checks: true,
    }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`Clerk create user failed (${res.status}): ${JSON.stringify(body)}`)
  userId = body.id
})

test.afterAll(async () => {
  if (userId) {
    await fetch(`${CLERK_API}/users/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${SECRET}` },
    })
  }
})

test('key surfaces match their committed baselines', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await page.goto('/sign-in')
  await clerk.signIn({ page, emailAddress: TEST_EMAIL })

  // Home, day-one state (phone). The Clerk avatar is third-party chrome —
  // masked so their asset pipeline can't move our pixels.
  await page.goto('/')
  await expect(page.getByText('Day one.')).toBeVisible({ timeout: 15_000 })
  const mask = [page.locator('.cl-userButton-root')]
  await expect(page).toHaveScreenshot('home-phone.png', { fullPage: true, mask })

  // Home at desktop width — the md bento column (#194).
  await page.setViewportSize(DESKTOP)
  await expect(page).toHaveScreenshot('home-desktop.png', { fullPage: true, mask })
  await page.setViewportSize(PHONE)

  // Programs, empty state.
  await page.goto('/programs')
  await expect(page.getByText('Every block starts as a plan', { exact: false })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page).toHaveScreenshot('programs-empty-phone.png', { fullPage: true, mask })

  // The curated program-template library (seeded canon — stable between
  // seed script runs; a seed change legitimately regenerates this baseline).
  await page.goto('/programs/templates')
  await expect(page.getByText('Program templates')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveScreenshot('program-templates-phone.png', { fullPage: true, mask })

  // Session templates, empty state.
  await page.goto('/templates')
  await expect(page.getByText('Session templates')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveScreenshot('session-templates-phone.png', { fullPage: true, mask })
})
