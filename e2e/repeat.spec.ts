import { test, expect } from '@playwright/test'
import postgres from 'postgres'
import { createTestUser, deleteTestUser, signIn, type TestUser } from './auth'
import { addExercise, FINISHED_URL, finishWorkout, startWorkout, typeInto } from './logger'

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
  await startWorkout(page)
  await addExercise(page, 'bench')

  // Both rows first, then fill them — the order a lifter who knows the session
  // works in, and the order that keeps "+ Add set" reachable. Adding the row
  // while a weight field still holds focus puts the stepper rail between the
  // two, and the rail unmounts on the blur that the tap itself causes.
  await page.getByRole('button', { name: /add set/i }).click()
  await typeInto(page.getByLabel('Set 1 reps'), '5')
  await typeInto(page.getByLabel('Set 1 weight in kg'), '100')
  await typeInto(page.getByLabel('Set 2 reps'), '8')
  await typeInto(page.getByLabel('Set 2 weight in kg'), '60')
  await finishWorkout(page)
  await page.goto('/')

  // A Repeat icon-link sits on the home history row.
  await expect(page.getByRole('link', { name: /^Repeat/i })).toHaveCount(1)

  // --- Repeat from the summary page. The History row is matched by its " · "
  // meta separator (the sibling Repeat link has no meta line); the name is no
  // longer at the START of the row's accessible name, because the row leads
  // with its calendar block. ---
  await page.getByRole('link', { name: /Workout .*·/ }).click()
  await expect(page).toHaveURL(FINISHED_URL)
  await page.getByRole('link', { name: /repeat workout/i }).click()
  await expect(page).toHaveURL(/\/workout\/new\?from=/)

  // Seeded fields are REAL values (toHaveValue), not ghost placeholders.
  await expect(page.getByLabel('Set 1 reps')).toHaveValue('5')
  await expect(page.getByLabel('Set 1 weight in kg')).toHaveValue('100')
  await expect(page.getByLabel('Set 2 reps')).toHaveValue('8')
  await expect(page.getByLabel('Set 2 weight in kg')).toHaveValue('60')

  // --- Edit one field and save → a distinct second workout. ---
  await typeInto(page.getByLabel('Set 1 weight in kg'), '102.5')
  await finishWorkout(page)
  await page.goto('/')

  // Two history rows now exist (source untouched + the repeated save).
  await expect(page.getByRole('link', { name: /^Repeat/i })).toHaveCount(2)
})
