import { test, expect } from '@playwright/test'
import postgres from 'postgres'
import { createTestUser, deleteTestUser, signIn, type TestUser } from './auth'

/**
 * End-to-end for Phase 3 "repeat last workout", against the LIVE WorkOS
 * environment and Supabase DB. Mirrors the Phase 2 harness: a disposable user
 * (pinned to kg for deterministic values) logs a workout, repeats it from the
 * detail page, and the logger opens pre-seeded with the source workout's
 * exercises and sets as real input values (not ghosts). Editing and saving the
 * seed creates a distinct second workout, leaving the source untouched.
 * Teardown removes all rows and the WorkOS user.
 */

let user: TestUser
let userId: string
let sql: ReturnType<typeof postgres>

test.beforeAll(async () => {
  user = await createTestUser('rep')
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

test('repeats a logged workout, seeding its values, and saves a distinct new workout', async ({
  page,
}) => {
  await signIn(page, user)

  // --- Workout 1: log bench with two sets. ---
  await page.goto('/')
  const startLink = page.getByRole('link', { name: /start workout/i })
  await expect(startLink).toBeVisible({ timeout: 15_000 })
  await startLink.click()
  await expect(page).toHaveURL(/\/workout\/new$/)

  await page.getByLabel('Search exercises').fill('bench')
  // The picker has no per-row Add button since #233: a result row IS the
  // control (li role=option, click to add).
  const addButton = page.getByRole('option').first()
  await expect(addButton).toBeVisible({ timeout: 20_000 })
  await addButton.click()

  await page.getByLabel('Set 1 reps').fill('5')
  await page.getByLabel('Set 1 weight in kg').fill('100')
  await page.getByRole('button', { name: /add set/i }).click()
  await page.getByLabel('Set 2 reps').fill('8')
  await page.getByLabel('Set 2 weight in kg').fill('60')
  await page.getByRole('button', { name: /finish workout/i }).click()
  // Save lands on the session summary (detail page); return home.
  await expect(page).toHaveURL(/\/workout\/[0-9a-f-]+$/)
  await page.goto('/')

  // A Repeat icon-link sits on the home history row.
  await expect(page.getByRole('link', { name: /^Repeat/i })).toHaveCount(1)

  // --- Repeat from the detail page. Match the History row link (its name
  // carries the " · " meta separator), not the Done-Today link. ---
  await page.getByRole('link', { name: /^Workout .*·/ }).click()
  await expect(page).toHaveURL(/\/workout\/[0-9a-f-]+$/)
  await page.getByRole('link', { name: /repeat workout/i }).click()
  await expect(page).toHaveURL(/\/workout\/new\?from=/)

  // Seeded fields are REAL values (toHaveValue), not ghost placeholders.
  await expect(page.getByLabel('Set 1 reps')).toHaveValue('5')
  await expect(page.getByLabel('Set 1 weight in kg')).toHaveValue('100')
  await expect(page.getByLabel('Set 2 reps')).toHaveValue('8')
  await expect(page.getByLabel('Set 2 weight in kg')).toHaveValue('60')

  // --- Edit one field and save → a distinct second workout. ---
  await page.getByLabel('Set 1 weight in kg').fill('102.5')
  await page.getByRole('button', { name: /finish workout/i }).click()
  await expect(page).toHaveURL(/\/workout\/[0-9a-f-]+$/)
  await page.goto('/')

  // Two history rows now exist (source untouched + the repeated save).
  await expect(page.getByRole('link', { name: /^Repeat/i })).toHaveCount(2)
})
