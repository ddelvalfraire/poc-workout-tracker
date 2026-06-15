import { test, expect } from '@playwright/test'
import { clerk } from '@clerk/testing/playwright'
import postgres from 'postgres'

/**
 * End-to-end for Phase 2 "last time" ghost inputs, against the LIVE Clerk dev
 * instance and Supabase DB. Mirrors the Phase 3 harness: a disposable
 * `+clerk_test` user (pinned to kg for deterministic values) logs a workout,
 * then starts another with the same exercise and the set inputs should show the
 * prior performance as placeholder ghosts. Covers first-time (no ghosts) and
 * more-sets-than-history (extra set stays blank). Teardown removes all rows and
 * the Clerk user.
 */

const CLERK_API = 'https://api.clerk.com/v1'
const SECRET = process.env.CLERK_SECRET_KEY!
const STAMP = Date.now()
const TEST_EMAIL = `e2e+clerk_test_lt_${STAMP}@example.com`
const TEST_PASSWORD = `Pw-e2e-${STAMP}-aZ9!`

let userId: string
let sql: ReturnType<typeof postgres>

test.beforeAll(async () => {
  const res = await fetch(`${CLERK_API}/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email_address: [TEST_EMAIL],
      password: TEST_PASSWORD,
      skip_password_checks: true,
    }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`Clerk create user failed (${res.status}): ${JSON.stringify(body)}`)
  userId = body.id

  sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false })
  // Pin to kg so ghost values round-trip exactly (kg is the canonical identity).
  await sql`insert into user_preferences (user_id, unit) values (${userId}, 'kg')`
})

test.afterAll(async () => {
  if (sql && userId) {
    await sql`delete from workouts where user_id = ${userId}` // cascade removes children
    await sql`delete from user_preferences where user_id = ${userId}`
    await sql.end()
  }
  if (userId) {
    await fetch(`${CLERK_API}/users/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${SECRET}` },
    })
  }
})

test('logs a workout, then shows it as per-set ghost placeholders next time', async ({ page }) => {
  await page.goto('/sign-in')
  await clerk.signIn({ page, emailAddress: TEST_EMAIL })

  // --- Workout 1: a fresh user has no history, so no ghosts yet. ---
  await page.goto('/')
  const startLink = page.getByRole('link', { name: /start workout/i })
  await expect(startLink).toBeVisible({ timeout: 15_000 })
  await startLink.click()
  await expect(page).toHaveURL(/\/workout\/new$/)

  await page.getByLabel('Search exercises').fill('bench')
  const addButton = page.getByRole('button', { name: 'Add' }).first()
  await expect(addButton).toBeVisible({ timeout: 20_000 })
  await addButton.click()

  // First time: no prior performance → the reps input has no ghost placeholder.
  await expect(page.getByLabel('Set 1 reps')).toBeVisible()
  expect(await page.getByLabel('Set 1 reps').getAttribute('placeholder')).toBeNull()

  await page.getByLabel('Set 1 reps').fill('5')
  await page.getByLabel('Set 1 weight in kg').fill('100')
  await page.getByRole('button', { name: /save workout/i }).click()
  await expect(page).toHaveURL('http://localhost:3000/')

  // --- Workout 2: same exercise → set 1 inputs ghost last time's values. ---
  await page.getByRole('link', { name: /start workout/i }).click()
  await expect(page).toHaveURL(/\/workout\/new$/)
  await page.getByLabel('Search exercises').fill('bench')
  const addAgain = page.getByRole('button', { name: 'Add' }).first()
  await expect(addAgain).toBeVisible({ timeout: 20_000 })
  await addAgain.click()

  // Ghosts arrive once the server action resolves (toHaveAttribute auto-retries).
  await expect(page.getByLabel('Set 1 reps')).toHaveAttribute('placeholder', '5')
  await expect(page.getByLabel('Set 1 weight in kg')).toHaveAttribute('placeholder', '100')

  // More sets than history: set 2 has no prior data → no ghost.
  await page.getByRole('button', { name: /add set/i }).click()
  await expect(page.getByLabel('Set 2 reps')).toBeVisible()
  expect(await page.getByLabel('Set 2 reps').getAttribute('placeholder')).toBeNull()
  expect(await page.getByLabel('Set 2 weight in kg').getAttribute('placeholder')).toBeNull()

  // The ghost is only a hint — an untouched field saves nothing for it.
  await page.getByLabel('Set 1 reps').fill('5')
  await page.getByLabel('Set 1 weight in kg').fill('102.5')
  await page.getByRole('button', { name: /save workout/i }).click()
  await expect(page).toHaveURL('http://localhost:3000/')
})
