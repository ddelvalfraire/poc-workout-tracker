import { test, expect } from '@playwright/test'
import { createTestUser, deleteTestUser, signIn, type TestUser } from './auth'

/**
 * Visual-regression screenshots of the key surfaces, in the states a FRESH
 * account renders deterministically (day-one home, empty lists, the curated
 * template library). A disposable user (same provisioning as
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

let user: TestUser
let userId: string

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 900 }

test.beforeAll(async () => {
  user = await createTestUser('visual')
  userId = user.id
})

test.afterAll(async () => {
  if (userId) await deleteTestUser(userId)
})

test('key surfaces match their committed baselines', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await signIn(page, user)

  // Home, day-one state (phone). Nothing is masked: the vendor avatar button
  // that used to need masking is gone — identity is first-party chrome now,
  // so every pixel on these surfaces is ours to regress against.
  await page.goto('/')
  await expect(page.getByText('Day one.')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveScreenshot('home-phone.png', { fullPage: true })

  // Home at desktop width — the md bento column (#194).
  await page.setViewportSize(DESKTOP)
  await expect(page).toHaveScreenshot('home-desktop.png', { fullPage: true })
  await page.setViewportSize(PHONE)

  // Programs, empty state.
  await page.goto('/programs')
  await expect(page.getByText('Every block starts as a plan', { exact: false })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page).toHaveScreenshot('programs-empty-phone.png', { fullPage: true })

  // The program-template shelf gets a render check, NOT a baseline. It used to
  // have one, under a comment calling it "seeded canon — stable between seed
  // script runs". That was never true: the shelf is listPublicTemplates(),
  // a live fetch of wger's public routines, so the committed PNG was a
  // fullPage snapshot of a third-party feed and went red whenever strangers
  // renamed their routines. A baseline that fails on someone else's schedule
  // is a change detector, not a regression test. The zoning it was meant to
  // guard is unit-tested in lib/templates/wger-template-shelf.ts, against fixtures.
  await page.goto('/programs/templates')
  await expect(page.getByText('Program templates')).toBeVisible({ timeout: 15_000 })

  // Session templates, empty state.
  await page.goto('/templates')
  await expect(page.getByText('Session templates')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveScreenshot('session-templates-phone.png', { fullPage: true })
})
