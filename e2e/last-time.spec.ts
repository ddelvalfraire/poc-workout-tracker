import { test, expect } from '@playwright/test'
import postgres from 'postgres'
import { createTestUser, deleteTestUser, signIn, type TestUser } from './auth'
import { addExercise, finishWorkout, startWorkout, typeInto } from './logger'

/**
 * End-to-end for how the logger surfaces LAST TIME's performance.
 *
 * Rewritten for the post-#96 contract, which this spec used to contradict:
 * previous performance appears in exactly ONE place, the Prev chip. The grey
 * input placeholders ("ghosts") carry the program's week-N target and nothing
 * else. Ghosting history into the inputs was removed deliberately — it
 * duplicated the Prev column with a second meaning and produced mixed-source
 * fragments (a last-time rep count beside a plan load). Two surfaces, two
 * meanings, and this spec now pins that separation rather than the behaviour
 * that was retired: an ad-hoc exercise has no plan, so its inputs stay EMPTY
 * however much history exists, and the chip is where last time lives.
 *
 * A disposable user (pinned to kg so values round-trip exactly) logs a
 * workout, then starts another with the same exercise. Covers first-time (no
 * history → an inert "—" chip), the populated chip, its one-tap adopt, and
 * more-sets-than-history (the extra set's chip stays empty). Teardown removes
 * all rows and the WorkOS user.
 */

let user: TestUser
let userId: string
let sql: ReturnType<typeof postgres>

test.beforeAll(async () => {
  user = await createTestUser('lt')
  userId = user.id

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
  if (userId) await deleteTestUser(userId)
})

test('logs a workout, then offers it on the Prev chip next time', async ({ page }) => {
  await signIn(page, user)

  // --- Workout 1: a fresh user has no history, so nothing to offer. ---
  await startWorkout(page)
  await addExercise(page, 'bench')

  // First time: no prior performance → the chip is the inert em-dash, and the
  // inputs are blank because an ad-hoc exercise has no plan to ghost either.
  await expect(page.getByRole('button', { name: /^no previous.*set 1/i })).toBeDisabled()
  await expect(page.getByLabel('Set 1 reps')).toHaveValue('')
  expect(await page.getByLabel('Set 1 reps').getAttribute('placeholder')).toBeNull()

  await typeInto(page.getByLabel('Set 1 reps'), '5')
  await typeInto(page.getByLabel('Set 1 weight in kg'), '100')
  await finishWorkout(page)

  // --- Workout 2: same exercise → set 1's chip carries last time's pair. ---
  await startWorkout(page)
  await addExercise(page, 'bench')

  // The chip arrives once the server action resolves (the locator retries).
  // "100×5" is weight×reps — weight_reps needs BOTH, so a complete pair here
  // also proves workout 1 saved both fields, not just one.
  const prevChip = page.getByRole('button', { name: /fill set 1 from previous: 100×5/i })
  await expect(prevChip).toBeVisible({ timeout: 15_000 })

  // History does NOT reach the inputs — that is the whole point of the split.
  await expect(page.getByLabel('Set 1 reps')).toHaveValue('')
  expect(await page.getByLabel('Set 1 reps').getAttribute('placeholder')).toBeNull()
  expect(await page.getByLabel('Set 1 weight in kg').getAttribute('placeholder')).toBeNull()

  // More sets than history: set 2 has no prior data → nothing to offer there.
  await page.getByRole('button', { name: /add set/i }).click()
  await expect(page.getByRole('button', { name: /^no previous.*set 2/i })).toBeDisabled()

  // The chip is an offer, and tapping it is how last time becomes this set —
  // the one-tap adopt that replaced the ghost.
  await prevChip.click()
  await expect(page.getByLabel('Set 1 reps')).toHaveValue('5')
  await expect(page.getByLabel('Set 1 weight in kg')).toHaveValue('100')

  // Adopted values are REAL input, so they save like anything typed.
  await finishWorkout(page)

  const sets = await sql<{ weight: number; reps: number }[]>`
    select s.weight::float8 as weight, s.reps
    from sets s
    join workout_exercises we on we.id = s.workout_exercise_id
    join workouts w on w.id = we.workout_id
    where w.user_id = ${userId} and s.set_number = 1
    order by w.started_at
  `
  expect(sets).toEqual([
    { weight: 100, reps: 5 },
    { weight: 100, reps: 5 },
  ])
})
