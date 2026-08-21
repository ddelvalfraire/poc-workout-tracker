import { test, expect } from '@playwright/test'
import postgres from 'postgres'
import { createTestUser, deleteTestUser, signIn, type TestUser } from './auth'
import { APP_ORIGIN } from './app-origin'

/**
 * End-to-end happy path for the Phase 6 program UI: build a program in the
 * browser, browse its engine-derived targets, and start today's day as a real
 * workout — the PRD success signal, entirely in the UI.
 *
 * Mirrors workout.spec.ts: a disposable user is provisioned via the WorkOS User
 * Management API, signed in through the real hosted AuthKit page, and rows are
 * asserted directly in Postgres. Cleanup happens through the UI (delete
 * program), with a SQL/WorkOS teardown as the safety net so the test leaves
 * nothing behind.
 */

let user: TestUser
let userId: string
let sql: ReturnType<typeof postgres>

test.beforeAll(async () => {
  // Provision a disposable, pre-verified test user with a password.
  user = await createTestUser('programs')
  userId = user.id

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
  if (userId) await deleteTestUser(userId)
})

test('signed-in user can build a program, browse targets, and start a day', async ({ page }) => {
  // Sign in through the hosted AuthKit page (home redirects to /sign-in).
  await signIn(page, user)

  // Home → Programs → empty state → New Program. Home has no bare "Programs"
  // link any more: navigation moved into the drawer, where a row's accessible
  // name carries its status line too. The first-run hero's CTA is the way in.
  await page.goto('/')
  const programsLink = page.getByRole('link', { name: /browse programs/i })
  await expect(programsLink).toBeVisible({ timeout: 15_000 })
  await programsLink.click()
  await expect(page).toHaveURL(/\/programs$/)
  await expect(page.getByText('Day one.')).toBeVisible()
  await page.getByRole('link', { name: /new program/i }).click()
  await expect(page).toHaveURL(/\/programs\/new$/)

  // Meta: name the program (weeks default to 1 when left blank).
  await page.getByLabel('Program name').fill('E2E Push Day Program')

  // Add a day and name it.
  await page.getByRole('button', { name: /add day/i }).click()
  await page.getByLabel('Day 1 name').fill('Push')

  // Search the wger proxy and add the first result (seeds one empty set).
  await page.getByLabel('Search exercises').fill('bench')
  // The picker has no per-row Add button since #233: a result row IS the
  // control (li role=option, click to add).
  const addButton = page.getByRole('option').first()
  await expect(addButton).toBeVisible({ timeout: 20_000 })
  await addButton.click()

  // Target: 5-5 reps @ 100 kg.
  await page.getByLabel(/set 1 rep min$/i).fill('5')
  await page.getByLabel(/set 1 rep max$/i).fill('5')
  await page.getByLabel(/set 1 load in kg$/i).fill('100')

  // Auto-regulation is a PRO feature and the builder defaults it on, so a
  // Free account's save is rejected outright (requireFeature('autoreg') in
  // programs/actions.ts) and the form only says "Could not save program".
  // This spec is about building a program, not about autoreg — turn it off
  // and stay on the path a Free account can actually walk.
  await page.getByRole('checkbox', { name: /auto-regulate loads/i }).uncheck()

  // Save → redirected to the program detail page.
  await page.getByRole('button', { name: /save program/i }).click()
  await expect(page).toHaveURL(/\/programs\/[0-9a-f-]{36}$/, { timeout: 15_000 })

  // Detail shows week 1 and the engine-derived target line for the set. The
  // week phrase now appears twice (the hero's "· N days to go." sentence and
  // the quiet meta line), so this anchors on the meta line's exact text.
  await expect(page.getByText('Week 1 of 1', { exact: true })).toBeVisible()
  // The engine-derived target lines moved behind the day's "Targets" toggle
  // (?expand=<exerciseId>) — a day card leads with "N exercise · <names>" now.
  // Opening it IS this spec's "browse targets" step.
  await page.getByRole('link', { name: /^targets$/i }).click()
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
  // A live session renders no name field: mid-session the name is a fact, not
  // a field (#207), and the block that said so is gone too. What the UI still
  // carries is the provenance stamp — the better assertion anyway, since it
  // pins the (day · week) this session is stamped to, which is exactly what a
  // wrong-day start would break. The name itself is asserted in Postgres below.
  await expect(page.getByText('Push · Week 1')).toBeVisible()

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

  // Cleanup through the UI: discard the session, then delete the program.
  // The session is still LIVE, and an unfinished workout has no summary page
  // to delete from — /workout/{id} bounces it straight back to the logger.
  // Discard is the live session's own exit, and for a program-started row it
  // deletes the workout along with the draft. Both confirms are centered
  // modals (ConfirmDialog), not the inline two-step cards they replaced.
  await page.getByRole('button', { name: /discard workout/i }).click()
  await expect(page.getByText('Discard this workout?')).toBeVisible()
  await page.getByRole('button', { name: /^discard$/i }).click()
  await expect(page).toHaveURL(`${APP_ORIGIN}/`, { timeout: 15_000 })

  await page.goto(`/programs`)
  await page.getByRole('link', { name: /e2e push day program/i }).click()
  await page.getByRole('button', { name: /^delete$/i }).click()
  // Scoped to the dialog: the page's own Delete button is still in the tree
  // behind the modal, so an unscoped /^delete$/ matches two elements.
  const confirm = page.getByLabel('Delete this program?')
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: /^delete$/i }).click()
  await expect(page).toHaveURL(/\/programs$/, { timeout: 15_000 })
  await expect(page.getByText('Day one.')).toBeVisible()
})
