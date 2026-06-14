import { test, expect } from '@playwright/test'
import { clerk } from '@clerk/testing/playwright'
import postgres from 'postgres'

/**
 * End-to-end happy path for the Phase 3 core logging loop, against the LIVE
 * Clerk dev instance and Supabase DB.
 *
 * A disposable `+clerk_test` user is provisioned via the Clerk Backend API,
 * signed in through the real UI (Testing Token bypasses bot protection), drives
 * the logger, and the resulting row tree is asserted directly in Postgres. Both
 * the workout rows (cascade) and the Clerk user are removed in teardown, so the
 * test leaves nothing behind.
 */

const CLERK_API = 'https://api.clerk.com/v1'
const SECRET = process.env.CLERK_SECRET_KEY!
const STAMP = Date.now()
const TEST_EMAIL = `e2e+clerk_test_${STAMP}@example.com`
const TEST_PASSWORD = `Pw-e2e-${STAMP}-aZ9!`

let userId: string
let sql: ReturnType<typeof postgres>

test.beforeAll(async () => {
  // Provision a disposable, pre-verified test user with a password.
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

  // Direct connection (session pooler, 5432) for assertions + cleanup.
  sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false })
})

test.afterAll(async () => {
  if (sql && userId) {
    await sql`delete from workouts where user_id = ${userId}` // cascade removes children
    await sql.end()
  }
  if (userId) {
    await fetch(`${CLERK_API}/users/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${SECRET}` },
    })
  }
})

test('signed-in user can start, log, and save a workout', async ({ page }) => {
  // Sign in via Clerk on a page that loads it (home redirects to /sign-in).
  // Email/ticket-based sign-in mints a sign-in token server-side and activates
  // the session — robust for a freshly Backend-API-created user.
  await page.goto('/sign-in')
  await clerk.signIn({ page, emailAddress: TEST_EMAIL })

  // Home -> confirm the session actually took, then Start Workout.
  await page.goto('/')
  const startLink = page.getByRole('link', { name: /start workout/i })
  await expect(startLink).toBeVisible({ timeout: 15_000 })
  await startLink.click()
  await expect(page).toHaveURL(/\/workout\/new$/)

  // Search the wger proxy and add the first result.
  await page.getByLabel('Search exercises').fill('bench')
  const addButton = page.getByRole('button', { name: 'Add' }).first()
  await expect(addButton).toBeVisible({ timeout: 20_000 })
  await addButton.click()

  // Log set 1.
  await page.getByLabel('Set 1 reps').fill('5')
  await page.getByLabel('Set 1 weight in kg').fill('100')

  // Add and log a second set.
  await page.getByRole('button', { name: /add set/i }).click()
  await page.getByLabel('Set 2 reps').fill('5')
  await page.getByLabel('Set 2 weight in kg').fill('102.5')

  // Save -> redirected home.
  await page.getByRole('button', { name: /save workout/i }).click()
  await expect(page).toHaveURL('http://localhost:3000/')

  // Assert the persisted row tree for this user.
  const rows = await sql<{ name: string | null; exercise_count: number; set_count: number }[]>`
    select w.name,
           count(distinct we.id)::int as exercise_count,
           count(s.id)::int           as set_count
    from workouts w
    join workout_exercises we on we.workout_id = w.id
    join sets s on s.workout_exercise_id = we.id
    where w.user_id = ${userId}
    group by w.id
  `
  expect(rows).toHaveLength(1)
  expect(rows[0].exercise_count).toBe(1)
  expect(rows[0].set_count).toBe(2)
})
