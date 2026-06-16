import { test, expect, type Page } from '@playwright/test'
import { clerk } from '@clerk/testing/playwright'
import postgres from 'postgres'

/**
 * End-to-end for Phase 4 "PRs + estimated 1RM", against the LIVE Clerk dev
 * instance and Supabase DB. Mirrors the repeat-workout harness: a disposable
 * `+clerk_test` user (pinned to kg so seeded weights round-trip exactly) logs
 * Bench once, then again heavier. The heavier (later) workout's detail page
 * earns a PR badge and shows an Est. 1RM line; the first workout shows Est. 1RM
 * but NO badge (nothing earlier to beat). Teardown removes all rows + the user.
 */

const CLERK_API = 'https://api.clerk.com/v1'
const SECRET = process.env.CLERK_SECRET_KEY!
const STAMP = Date.now()
const TEST_EMAIL = `e2e+clerk_test_pr_${STAMP}@example.com`
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
  // Pin to kg so seeded values round-trip exactly (kg is the canonical identity).
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

/** Logs a single-set Bench workout at the given kg weight, returning to home. */
async function logBench(page: Page, weight: string) {
  await page.goto('/')
  const startLink = page.getByRole('link', { name: /start workout/i })
  await expect(startLink).toBeVisible({ timeout: 15_000 })
  await startLink.click()
  await expect(page).toHaveURL(/\/workout\/new$/)

  await page.getByLabel('Search exercises').fill('bench')
  const addButton = page.getByRole('button', { name: 'Add' }).first()
  await expect(addButton).toBeVisible({ timeout: 20_000 })
  await addButton.click()

  await page.getByLabel('Set 1 reps').fill('5')
  await page.getByLabel('Set 1 weight in kg').fill(weight)
  await page.getByRole('button', { name: /save workout/i }).click()
  await expect(page).toHaveURL('http://localhost:3000/')
}

test('shows a PR badge on the heavier later workout, not the first', async ({ page }) => {
  await page.goto('/sign-in')
  await clerk.signIn({ page, emailAddress: TEST_EMAIL })

  // --- Workout 1: Bench 5 × 100 kg (the baseline; no prior to beat). ---
  await logBench(page, '100')
  // --- Workout 2: Bench 5 × 110 kg (heavier → higher est. 1RM → a PR). ---
  await logBench(page, '110')

  // Two history rows exist; the most recent (110) sits at the top (desc startedAt).
  await expect(page.getByRole('link', { name: /^Repeat/i })).toHaveCount(2)

  // --- Detail of the heavier (most recent) workout → PR badge + Est. 1RM. ---
  await page.getByText('Workout', { exact: true }).first().click()
  await expect(page).toHaveURL(/\/workout\/[0-9a-f-]+$/)
  await expect(page.getByText('PR', { exact: true })).toBeVisible()
  await expect(page.getByText(/Est\. 1RM/)).toBeVisible()

  // --- Detail of the first (older) workout → Est. 1RM but NO PR badge. ---
  await page.goto('/')
  await page.getByText('Workout', { exact: true }).last().click()
  await expect(page).toHaveURL(/\/workout\/[0-9a-f-]+$/)
  await expect(page.getByText(/Est\. 1RM/)).toBeVisible()
  await expect(page.getByText('PR', { exact: true })).toHaveCount(0)
})
