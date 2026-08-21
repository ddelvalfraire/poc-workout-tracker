import { test, expect, type Page } from '@playwright/test'
import postgres from 'postgres'
import { createTestUser, deleteTestUser, signIn, type TestUser } from './auth'
import { addExercise, FINISHED_URL, startWorkout, typeInto } from './logger'

/**
 * End-to-end for Phase 4 "PRs + estimated 1RM", against the LIVE WorkOS
 * environment and Supabase DB. Mirrors the repeat-workout harness: a disposable
 * user (pinned to kg so seeded weights round-trip exactly) logs Bench once,
 * then again heavier. The heavier (later) workout's detail page earns a PR
 * badge and shows an Est. 1RM line; the first workout shows Est. 1RM but NO
 * badge (nothing earlier to beat). Teardown removes all rows + the user.
 */

let user: TestUser
let userId: string
let sql: ReturnType<typeof postgres>

test.beforeAll(async () => {
  user = await createTestUser('pr')
  userId = user.id

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
  if (userId) await deleteTestUser(userId)
})

/** Logs a single-set Bench workout at the given kg weight, returning to home. */
async function logBench(page: Page, weight: string) {
  await startWorkout(page)
  await addExercise(page, 'bench')

  await typeInto(page.getByLabel('Set 1 reps'), '5')
  await typeInto(page.getByLabel('Set 1 weight in kg'), weight)
  await page.getByRole('button', { name: /finish workout/i }).click()
  // Save lands on the session summary (detail page); return home.
  await expect(page).toHaveURL(FINISHED_URL)
  await page.goto('/')
}

test('shows a PR badge on the heavier later workout, not the first', async ({ page }) => {
  await signIn(page, user)

  // --- Workout 1: Bench 5 × 100 kg (the baseline; no prior to beat). ---
  await logBench(page, '100')
  // --- Workout 2: Bench 5 × 110 kg (heavier → higher est. 1RM → a PR). ---
  await logBench(page, '110')

  // Two history rows exist; the most recent (110) sits at the top (desc startedAt).
  await expect(page.getByRole('link', { name: /^Repeat/i })).toHaveCount(2)

  // --- Detail of the heavier (most recent) workout → PR badge + Est. 1RM. ---
  await page.getByText('Workout', { exact: true }).first().click()
  await expect(page).toHaveURL(FINISHED_URL)
  await expect(page.getByText('PR', { exact: true })).toBeVisible()
  await expect(page.getByText(/Est\. 1RM/)).toBeVisible()

  // --- Detail of the first (older) workout → Est. 1RM but NO PR badge. ---
  await page.goto('/')
  await page.getByText('Workout', { exact: true }).last().click()
  await expect(page).toHaveURL(FINISHED_URL)
  await expect(page.getByText(/Est\. 1RM/)).toBeVisible()
  await expect(page.getByText('PR', { exact: true })).toHaveCount(0)
})
