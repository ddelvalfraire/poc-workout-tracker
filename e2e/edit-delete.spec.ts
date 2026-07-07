import { test, expect } from '@playwright/test'
import { clerk } from '@clerk/testing/playwright'
import postgres from 'postgres'

/**
 * End-to-end happy path for Phase 5 edit + delete, against the LIVE Clerk dev
 * instance and Supabase DB.
 *
 * Mirrors the Phase 3 harness (e2e/workout.spec.ts): a disposable `+clerk_test`
 * user is provisioned via the Clerk Backend API, signed in through the real UI,
 * logs a workout, then edits a set's weight (asserted directly in Postgres) and
 * deletes the workout (asserting the rows are gone). Teardown removes the
 * workout rows (cascade) and the Clerk user, so the test leaves nothing behind.
 */

const CLERK_API = 'https://api.clerk.com/v1'
const SECRET = process.env.CLERK_SECRET_KEY!
const STAMP = Date.now()
const TEST_EMAIL = `e2e+clerk_test_ed_${STAMP}@example.com`
const TEST_PASSWORD = `Pw-e2e-${STAMP}-aZ9!`
const WORKOUT_NAME = `E2E Edit ${STAMP}`

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

  // Pin this user to kg so the weight labels/values below stay kg (default is lb).
  await sql`insert into user_preferences (user_id, unit) values (${userId}, 'kg')`
})

test.afterAll(async () => {
  if (sql && userId) {
    await sql`delete from workouts where user_id = ${userId}` // idempotent; cascade removes children
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

test('signed-in user can edit a set and delete a workout', async ({ page }) => {
  // Sign in.
  await page.goto('/sign-in')
  await clerk.signIn({ page, emailAddress: TEST_EMAIL })

  // Start a workout, give it a findable name.
  await page.goto('/')
  const startLink = page.getByRole('link', { name: /start workout/i })
  await expect(startLink).toBeVisible({ timeout: 15_000 })
  await startLink.click()
  await expect(page).toHaveURL(/\/workout\/new$/)
  await page.getByLabel('Workout name').fill(WORKOUT_NAME)

  // Add an exercise and log one set.
  await page.getByLabel('Search exercises').fill('bench')
  const addButton = page.getByRole('button', { name: 'Add' }).first()
  await expect(addButton).toBeVisible({ timeout: 20_000 })
  await addButton.click()
  await page.getByLabel('Set 1 reps').fill('5')
  await page.getByLabel('Set 1 weight in kg').fill('100')
  await page.getByRole('button', { name: /save workout/i }).click()
  // Save lands on the session summary (detail page); go home for History.
  await expect(page).toHaveURL(/\/workout\/[0-9a-f-]+$/)
  await page.goto('/')

  // Open it from History and capture its id. Anchor the name AND require the
  // " · " meta separator so it matches the History row link — not the sibling
  // "Repeat {name}" link or the Done-Today link (whose name ends in a time).
  await page.getByRole('link', { name: new RegExp(`^${WORKOUT_NAME}.*·`) }).click()
  await expect(page).toHaveURL(/\/workout\/[0-9a-f-]+$/)
  const detailUrl = page.url()
  const id = new URL(detailUrl).pathname.split('/').pop()!

  // Edit: change Set 1 weight to 105, save, land back on the detail page.
  await page.getByRole('link', { name: /edit/i }).click()
  await expect(page).toHaveURL(`http://localhost:3000/workout/${id}/edit`)
  const weightInput = page.getByLabel('Set 1 weight in kg')
  await weightInput.fill('105')
  await page.getByRole('button', { name: /save changes/i }).click()
  await expect(page).toHaveURL(detailUrl)

  // Assert the edit persisted in Postgres.
  const sets = await sql<{ weight: number }[]>`
    select s.weight::float8 as weight
    from sets s
    join workout_exercises we on we.id = s.workout_exercise_id
    where we.workout_id = ${id} and s.set_number = 1
  `
  expect(sets).toHaveLength(1)
  expect(sets[0].weight).toBe(105)

  // Delete: two-step inline confirm (no native dialog), land home.
  await page.getByRole('button', { name: /^delete$/i }).click()
  await expect(page.getByText('Delete this workout?')).toBeVisible()
  await page.getByRole('button', { name: /^delete$/i }).click()
  await expect(page).toHaveURL('http://localhost:3000/')

  // Assert the workout (and its children, via cascade) are gone.
  const remaining = await sql<{ count: number }[]>`
    select count(*)::int as count from workouts where user_id = ${userId}
  `
  expect(remaining[0].count).toBe(0)
})
