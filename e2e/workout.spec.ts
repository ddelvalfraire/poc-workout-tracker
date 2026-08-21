import { test, expect } from '@playwright/test'
import postgres from 'postgres'
import { createTestUser, deleteTestUser, signIn, type TestUser } from './auth'
import { addExercise, finishWorkout, startWorkout, typeInto } from './logger'

/**
 * End-to-end happy path for the Phase 3 core logging loop, against the LIVE
 * WorkOS environment and Supabase DB.
 *
 * A disposable user is provisioned via the WorkOS User Management API, signed
 * in through the real hosted AuthKit page, drives the logger, and the resulting
 * row tree is asserted directly in Postgres. Both the workout rows (cascade)
 * and the WorkOS user are removed in teardown, so the test leaves nothing
 * behind.
 */

let user: TestUser
let userId: string
let sql: ReturnType<typeof postgres>

test.beforeAll(async () => {
  // Provision a disposable, pre-verified test user with a password.
  user = await createTestUser('workout')
  userId = user.id

  // Direct connection (session pooler, 5432) for assertions + cleanup.
  sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false })

  // Pin this user to kg so the weight labels/values below stay kg (default is lb).
  await sql`insert into user_preferences (user_id, unit) values (${userId}, 'kg')`
})

test.afterAll(async () => {
  if (sql && userId) {
    await sql`delete from workouts where user_id = ${userId}` // cascade removes children
    await sql`delete from workout_drafts where user_id = ${userId}`
    await sql`delete from user_preferences where user_id = ${userId}`
    await sql.end()
  }
  if (userId) await deleteTestUser(userId)
})

test('signed-in user can start, log, and save a workout', async ({ page }) => {
  // Sign in through the hosted AuthKit page (home redirects to /sign-in, which
  // hands off to AuthKit); the callback returns with an active session.
  await signIn(page, user)

  // Home -> confirm the session actually took, then Start Workout.
  await startWorkout(page)

  // Search the wger proxy and add the first result.
  await addExercise(page, 'bench')

  // Log set 1.
  await typeInto(page.getByLabel('Set 1 reps'), '5')
  await typeInto(page.getByLabel('Set 1 weight in kg'), '100')

  // Plate calculator: 100 kg on the default 20 kg bar = 25 + 15 per side,
  // and the warm-up ramp toward the top set renders alongside. Its trigger
  // lives in the exercise card's header, which is why this has to happen
  // while the card is still open — see the ordering note below.
  // Named for the EXERCISE, not the chip: the focused weight field also
  // raises the stepper rail, whose per-side plate chip is labelled
  // "Plates for 25 + 15 / side" — an unscoped /^plates for/ matches both.
  await page.getByRole('button', { name: /^plates for bench/i }).click()
  await expect(page.getByText('25 + 15 / side')).toBeVisible()
  // The target weight lives in an <input value>, which getByText cannot see —
  // assert the label, then the field's value.
  await expect(page.getByText(/warm-up · toward/i)).toBeVisible()
  // Scoped to the sheet: the logger's own app-bar "Close" stays in the tree
  // behind it, so an unscoped exact "Close" matches two.
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByText('25 + 15 / side')).not.toBeVisible()

  // Add and log a second set BEFORE checking set 1 off. Ordering is
  // load-bearing, not taste: completing every set in an exercise folds its
  // card to a one-line summary (done work gets out of the way), and a folded
  // card takes "+ Add set" and the header's plate button with it. With a
  // second, unfinished set present the card stays open.
  await page.getByRole('button', { name: /add set/i }).click()
  await typeInto(page.getByLabel('Set 2 reps'), '5')
  await typeInto(page.getByLabel('Set 2 weight in kg'), '102.5')

  // Now check set 1 off in-session.
  await page.getByRole('button', { name: 'Mark set 1 complete' }).click()

  // Cross-device draft sync: the logger autosaves (debounced) to the server.
  // Wait until the draft payload contains the LAST value typed — an earlier
  // debounce flush may have synced a partial draft — then reload: the session
  // must come back intact (same restore path another device would take).
  await expect
    .poll(
      async () => {
        const rows = await sql`
          select 1 from workout_drafts
          where user_id = ${userId} and payload::text like '%102.5%'
        `
        return rows.length
      },
      { timeout: 10_000 },
    )
    .toBe(1)
  // The active session surfaces on home as the resume banner; tapping it
  // returns to the logger with the draft restored (the cross-device path).
  await page.goto('/')
  await expect(page.getByText('Workout in progress')).toBeVisible({ timeout: 15_000 })
  // The hero states the session name and the logged-set count, not an
  // exercise/set ratio — asserted on the count so a rename cannot break it.
  await expect(page.getByText(/· 1 set logged/)).toBeVisible()
  await page.getByRole('link', { name: /resume workout/i }).click()
  await expect(page).toHaveURL(/\/workout\/new$/)
  await expect(page.getByLabel('Set 2 weight in kg')).toHaveValue('102.5', { timeout: 15_000 })
  await expect(page.getByLabel('Set 1 reps')).toHaveValue('5')
  await expect(page.getByRole('button', { name: 'Mark set 1 incomplete' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Offline resilience: kill the network and keep logging — the offline hint
  // appears once a sync fails; coming back online flushes the queued snapshot
  // (the `online` event, no page interaction needed).
  await page.context().setOffline(true)
  await typeInto(page.getByLabel('Set 2 reps'), '6')
  await expect(page.getByText(/offline — changes will sync/i)).toBeVisible({ timeout: 15_000 })
  await page.context().setOffline(false)
  await expect
    .poll(
      async () => {
        const rows = await sql`
          select 1 from workout_drafts
          where user_id = ${userId}
            and payload #>> '{draft,exercises,0,sets,1,reps}' = '6'
        `
        return rows.length
      },
      { timeout: 15_000 },
    )
    .toBe(1)

  // Save -> lands on the session summary (detail page).
  await finishWorkout(page)

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

  // Both sets land completed, and set 2 is the interesting one: it was never
  // checked off by hand. Finishing completes every set that has reps — the
  // promise the finish confirm makes in so many words ("Sets with reps are
  // checked off for you") — so a logged set cannot be saved as skipped just
  // because the lifter never tapped its circle. The in-session check-off of
  // set 1 is asserted in the UI above, where it survived the resume with
  // aria-pressed=true.
  const setRows = await sql<{ set_number: number; completed: boolean }[]>`
    select s.set_number, s.completed
    from sets s
    join workout_exercises we on we.id = s.workout_exercise_id
    join workouts w on w.id = we.workout_id
    where w.user_id = ${userId}
    order by s.set_number
  `
  expect(setRows).toEqual([
    { set_number: 1, completed: true },
    { set_number: 2, completed: true },
  ])

  // The save supersedes the draft — the server row must be gone.
  const draftRows = await sql`select key from workout_drafts where user_id = ${userId}`
  expect(draftRows).toHaveLength(0)
})
