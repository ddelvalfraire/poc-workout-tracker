import { test, expect } from '@playwright/test'
import postgres from 'postgres'
import { createTestUser, deleteTestUser, signIn, type TestUser } from './auth'
import { addExercise, FINISHED_URL, typeInto } from './logger'

/**
 * End-to-end happy path for Phase 5 edit + delete, against the LIVE WorkOS
 * environment and Supabase DB.
 *
 * Mirrors the Phase 3 harness (e2e/workout.spec.ts): a disposable user is
 * provisioned via the WorkOS User Management API, signed in through the real
 * hosted AuthKit page, logs a workout, then edits a set's weight (asserted
 * directly in Postgres) and deletes the workout (asserting the rows are gone).
 * Teardown removes the workout rows (cascade) and the WorkOS user, so the test
 * leaves nothing behind.
 */

const STAMP = Date.now()
const WORKOUT_NAME = `E2E Edit ${STAMP}`

let user: TestUser
let userId: string
let sql: ReturnType<typeof postgres>

test.beforeAll(async () => {
  user = await createTestUser('ed')
  userId = user.id

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
  if (userId) await deleteTestUser(userId)
})

test('signed-in user can edit a set and delete a workout', async ({ page }) => {
  // Sign in.
  await signIn(page, user)

  // Start a workout. It goes in UNNAMED on purpose: a live session has no
  // name field — mid-session the name is a fact, not a field (#207), and the
  // block that said so is gone entirely. Naming is the edit surface's job, so
  // it happens below, after the finish.
  await page.goto('/')
  const startLink = page.getByRole('link', { name: /start workout/i })
  await expect(startLink).toBeVisible({ timeout: 15_000 })
  await startLink.click()
  await expect(page).toHaveURL(/\/workout\/new$/)

  // Add an exercise and log one set. The picker is a sheet the sticky bar
  // opens — an empty logger shows its own empty state, not an open picker.
  await addExercise(page, 'bench')
  await typeInto(page.getByLabel('Set 1 reps'), '5')
  await typeInto(page.getByLabel('Set 1 weight in kg'), '100')
  await expect(page.getByLabel('Set 1 reps')).toHaveValue('5')
  await expect(page.getByLabel('Set 1 weight in kg')).toHaveValue('100')
  // Finish WITHOUT checking the set off by hand — that is the promise the
  // finish confirm makes ("Sets with reps are checked off for you"), so a set
  // with reps goes straight through with no dialog. Deliberate, not lazy:
  // checking every set off first flips isSessionDone, which puts a perpetual
  // `animate-finish-nudge` on this very button, and Playwright will never call
  // a forever-animating element stable enough to click.
  await page.getByRole('button', { name: /finish workout/i }).click()
  // Finish lands on the session summary. `?finished=1` rides along (it dresses
  // the summary as the completion moment), so read the id off the PATH rather
  // than matching the whole URL.
  await expect(page).toHaveURL(FINISHED_URL)
  const id = new URL(page.url()).pathname.split('/').pop()!
  const detailUrl = `http://localhost:3000/workout/${id}`

  // Edit the FINISHED workout. This is the surface that still has a labeled
  // name input (isLive=false — renaming is the point of a correction), so the
  // rename happens here, together with the Set 1 weight change, in one pass.
  await page.getByRole('link', { name: /^edit$/i }).click()
  await expect(page).toHaveURL(`${detailUrl}/edit`)
  await typeInto(page.getByLabel('Workout name'), WORKOUT_NAME)
  // The finish checked the set off, so its card arrives FOLDED to a one-line
  // "✓ Bench Press · 1 set · top 100×5" summary — done work gets out of the
  // way. Re-open it to reach the set inputs; that tap is what a correction is.
  await page.getByRole('button', { name: /^expand .*completed/i }).click()
  await typeInto(page.getByLabel('Set 1 weight in kg'), '105')
  await expect(page.getByLabel('Workout name')).toHaveValue(WORKOUT_NAME)
  await expect(page.getByLabel('Set 1 weight in kg')).toHaveValue('105')
  await page.getByRole('button', { name: /save changes/i }).click()
  await expect(page).toHaveURL(detailUrl)

  // Assert both edits persisted in Postgres.
  const sets = await sql<{ weight: number }[]>`
    select s.weight::float8 as weight
    from sets s
    join workout_exercises we on we.id = s.workout_exercise_id
    where we.workout_id = ${id} and s.set_number = 1
  `
  expect(sets).toHaveLength(1)
  expect(sets[0].weight).toBe(105)
  const named = await sql<{ name: string }[]>`select name from workouts where id = ${id}`
  expect(named[0].name).toBe(WORKOUT_NAME)

  // The rename is what History has to show. Open the row from /history (the
  // page that owns the log) and land back on the summary. Requiring the " · "
  // meta separator after the name keeps this on the row link — the sibling
  // "Repeat {name}" link has no meta line. The name is no longer at the START
  // of the row's accessible name: the row leads with its calendar block.
  await page.goto('/history')
  await page.getByRole('link', { name: new RegExp(`${WORKOUT_NAME}.*·`) }).click()
  await expect(page).toHaveURL(detailUrl)

  // Delete: confirms in a centered modal (ConfirmDialog), not the inline
  // two-step card it replaced. The confirm is scoped to the dialog — the
  // page's own Delete button is still in the tree behind it, so an unscoped
  // /^delete$/ matches two elements. Land home.
  await page.getByRole('button', { name: /^delete$/i }).click()
  const confirm = page.getByLabel('Delete this workout?')
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: /^delete$/i }).click()
  await expect(page).toHaveURL('http://localhost:3000/')

  // Assert the workout (and its children, via cascade) are gone.
  const remaining = await sql<{ count: number }[]>`
    select count(*)::int as count from workouts where user_id = ${userId}
  `
  expect(remaining[0].count).toBe(0)
})
