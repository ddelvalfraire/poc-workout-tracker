import { test, expect } from '@playwright/test'
import { clerk } from '@clerk/testing/playwright'
import postgres from 'postgres'

/**
 * End-to-end happy path for the Phase 6 program UI: build a program in the
 * browser, browse its engine-derived targets, and start today's day as a real
 * workout — the PRD success signal, entirely in the UI.
 *
 * Mirrors workout.spec.ts: a disposable `+clerk_test` user is provisioned via
 * the Clerk Backend API, signed in through the real UI, and rows are asserted
 * directly in Postgres. Cleanup happens through the UI (delete program), with a
 * SQL/Clerk teardown as the safety net so the test leaves nothing behind.
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

  // Pin this user to kg so the load labels/values below stay kg (default is lb).
  await sql`insert into user_preferences (user_id, unit) values (${userId}, 'kg')`
})

test.afterAll(async () => {
  if (sql && userId) {
    await sql`delete from workouts where user_id = ${userId}` // cascade removes children
    await sql`delete from programs where user_id = ${userId}` // safety net if UI delete failed
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

test('signed-in user can build a program, browse targets, and start a day', async ({ page }) => {
  // Sign in via Clerk on a page that loads it (home redirects to /sign-in).
  await page.goto('/sign-in')
  await clerk.signIn({ page, emailAddress: TEST_EMAIL })

  // Home → Programs → empty state → New Program.
  await page.goto('/')
  const programsLink = page.getByRole('link', { name: /^programs$/i })
  await expect(programsLink).toBeVisible({ timeout: 15_000 })
  await programsLink.click()
  await expect(page).toHaveURL(/\/programs$/)
  await expect(page.getByText('No programs yet')).toBeVisible()
  await page.getByRole('link', { name: /new program/i }).click()
  await expect(page).toHaveURL(/\/programs\/new$/)

  // Meta: name the program (weeks default to 1 when left blank).
  await page.getByLabel('Program name').fill('E2E Push Day Program')

  // Add a day and name it.
  await page.getByRole('button', { name: /add day/i }).click()
  await page.getByLabel('Day 1 name').fill('Push')

  // Search the wger proxy and add the first result (seeds one empty set).
  await page.getByLabel('Search exercises').fill('bench')
  const addButton = page.getByRole('button', { name: 'Add', exact: true }).first()
  await expect(addButton).toBeVisible({ timeout: 20_000 })
  await addButton.click()

  // Target: 5-5 reps @ 100 kg.
  await page.getByLabel(/set 1 rep min$/i).fill('5')
  await page.getByLabel(/set 1 rep max$/i).fill('5')
  await page.getByLabel(/set 1 load in kg$/i).fill('100')

  // Save → redirected to the program detail page.
  await page.getByRole('button', { name: /save program/i }).click()
  await expect(page).toHaveURL(/\/programs\/[0-9a-f-]{36}$/, { timeout: 15_000 })

  // Detail shows week 1 and the engine-derived target line for the set.
  await expect(page.getByText(/week 1 of 1/i)).toBeVisible()
  await expect(page.getByText('1×5 @ 100 kg')).toBeVisible()

  // Assert the persisted program tree for this user.
  const programRows = await sql<{ name: string; day_count: number; set_count: number }[]>`
    select p.name,
           count(distinct pd.id)::int as day_count,
           count(ps.id)::int          as set_count
    from programs p
    join program_days pd on pd.program_id = p.id
    join program_exercises pe on pe.program_day_id = pd.id
    join program_sets ps on ps.program_exercise_id = pe.id
    where p.user_id = ${userId}
    group by p.id
  `
  expect(programRows).toHaveLength(1)
  expect(programRows[0].name).toBe('E2E Push Day Program')
  expect(programRows[0].day_count).toBe(1)
  expect(programRows[0].set_count).toBe(1)

  // Start the day → lands straight in the logger for the new workout,
  // titled after the day, load seeded.
  await page.getByRole('button', { name: /start this day/i }).click()
  await expect(page).toHaveURL(/\/workout\/[0-9a-f-]{36}\/edit$/, { timeout: 15_000 })
  await expect(page.getByLabel('Workout name')).toHaveValue('Push')

  const workoutRows = await sql<{ name: string; program_week: number; weight: number }[]>`
    select w.name, w.program_week, s.weight::float as weight
    from workouts w
    join workout_exercises we on we.workout_id = w.id
    join sets s on s.workout_exercise_id = we.id
    where w.user_id = ${userId}
  `
  expect(workoutRows).toHaveLength(1)
  expect(workoutRows[0].name).toBe('Push')
  expect(workoutRows[0].program_week).toBe(1)
  expect(workoutRows[0].weight).toBe(100)

  // Cleanup through the UI: delete the workout, then the program. Deletes
  // confirm inline (two-step), not via a native dialog. The Delete button
  // lives on the detail page — drop the /edit suffix from the logger URL.
  await page.goto(page.url().replace(/\/edit$/, ''))
  await page.getByRole('button', { name: /^delete$/i }).click()
  await expect(page.getByText('Delete this workout?')).toBeVisible()
  await page.getByRole('button', { name: /^delete$/i }).click()
  await expect(page).toHaveURL('http://localhost:3000/', { timeout: 15_000 })

  await page.goto(`/programs`)
  await page.getByRole('link', { name: /e2e push day program/i }).click()
  await page.getByRole('button', { name: /^delete$/i }).click()
  await expect(page.getByText('Delete this program?')).toBeVisible()
  await page.getByRole('button', { name: /^delete$/i }).click()
  await expect(page).toHaveURL(/\/programs$/, { timeout: 15_000 })
  await expect(page.getByText('No programs yet')).toBeVisible()
})
