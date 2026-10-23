import { test, expect } from '@playwright/test'
import postgres from 'postgres'
import { createTestUser, deleteTestUser, signIn, type TestUser } from './auth'
import { finishWorkout, typeInto } from './logger'
import { APP_ORIGIN } from './app-origin'

let user: TestUser
let sql: ReturnType<typeof postgres>
let workoutId: string

test.beforeAll(async () => {
  user = await createTestUser('empty-finish')
  sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false })
  await sql`insert into user_preferences (user_id, unit) values (${user.id}, 'kg')`
})

test.beforeEach(async () => {
  // Seed the same untouched set shape as a program day without relying on
  // the public exercise service to create the regression's starting state.
  const [workout] = await sql`
    insert into workouts (user_id, name) values (${user.id}, 'Empty finish regression')
    returning id
  `
  workoutId = workout.id
  const [exercise] = await sql`
    insert into workout_exercises (workout_id, wger_exercise_id, name)
    values (${workoutId}, 73, 'Squat') returning id
  `
  await sql`
    insert into sets (workout_exercise_id, set_number, weight, prescribed_load_kg)
    values (${exercise.id}, 1, 100, 100), (${exercise.id}, 2, 100, 100)
  `
})

test.afterEach(async () => {
  await sql`delete from workouts where user_id = ${user.id}`
  await sql`delete from workout_drafts where user_id = ${user.id}`
})

test.afterAll(async () => {
  if (sql) {
    if (user) await sql`delete from user_preferences where user_id = ${user.id}`
    await sql.end()
  }
  if (user) await deleteTestUser(user.id)
})

test('empty finish keeps the unfinished session until discard is confirmed', async ({ page }) => {
  await signIn(page, user)
  await page.goto(`/workout/${workoutId}/edit`)
  await page.getByRole('button', { name: /finish workout/i }).click()

  const dialog = page.getByRole('dialog', { name: 'Nothing logged yet' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Finish', exact: true })).toHaveCount(0)
  const [unfinished] = await sql`
    select completed_at, original_recorded_at from workouts where id = ${workoutId}
  `
  expect(unfinished).toEqual({ completed_at: null, original_recorded_at: null })

  await dialog.getByRole('button', { name: 'Log my sets', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByLabel('Set 1 weight in kg')).toHaveValue('100')

  await page.getByRole('button', { name: /finish workout/i }).click()
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page).toHaveURL(`${APP_ORIGIN}/`)
  expect(await sql`select id from workouts where id = ${workoutId}`).toHaveLength(0)
  expect(await sql`select key from workout_drafts where user_id = ${user.id}`).toHaveLength(0)
})

test('one logged set follows the ordinary finish path and persists performed work', async ({ page }) => {
  await signIn(page, user)
  await page.goto(`/workout/${workoutId}/edit`)
  await typeInto(page.getByLabel('Set 1 reps'), '5')
  expect(await finishWorkout(page)).toBe(workoutId)

  const [finished] = await sql`
    select completed_at, original_recorded_at from workouts where id = ${workoutId}
  `
  expect(finished.completed_at).not.toBeNull()
  expect(finished.original_recorded_at).not.toBeNull()
  const sets = await sql`
    select s.reps, s.completed from sets s
    join workout_exercises e on e.id = s.workout_exercise_id
    where e.workout_id = ${workoutId} order by s.set_number
  `
  expect(sets).toEqual([{ reps: 5, completed: true }, { reps: null, completed: false }])
})
