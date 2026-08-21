import { test, expect, type Locator, type Page } from '@playwright/test'
import postgres from 'postgres'
import { createTestUser, deleteTestUser, signIn, type TestUser } from './auth'
import { addExercise, detailUrl, FINISHED_URL, typeInto, workoutIdFrom } from './logger'

/**
 * The logger's sticky bar must not move when focus leaves a set input.
 *
 * The bug this pins: the WeightStepper rail is focus-gated (it mounts on the
 * weight input's focus, unmounts on its blur) and lives in the scrolling
 * content ABOVE the bar. The bar used to render at its flow position, so the
 * rail's ~57px was part of what decided where the bar sat. Pressing Finish
 * with the weight field still focused blurred the field on mousedown, the
 * rail vanished, the bar jumped up, and mouseup landed off the button — so
 * the browser never synthesized a click and the user's first tap was eaten.
 * Silent: no navigation, no error, and Playwright reports the click as
 * having succeeded.
 *
 * Both halves are asserted, because either alone is fooled:
 * - GEOMETRY (the mechanism): the CTA's box is identical focused vs blurred.
 *   A behavioural pass could also come from an accidentally stable layout on
 *   one viewport; this says the bar is genuinely anchored.
 * - BEHAVIOUR (the symptom): ONE real `click()` with focus still in the
 *   field navigates. `dispatchEvent('click')` would pass even while broken —
 *   it skips the pointer sequence that is the whole bug — so it is never
 *   used here.
 *
 * Run at phone width as well as desktop: the thumb bar is a phone surface
 * first, and a narrow viewport reflows the rail differently. What this still
 * cannot cover is a real software keyboard dismissing under the same tap —
 * that needs a device, and it compounds this reflow rather than replacing it.
 */

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 720 }

let user: TestUser
let userId: string
let sql: ReturnType<typeof postgres>

test.beforeAll(async () => {
  user = await createTestUser('sticky')
  userId = user.id
  sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false })
  // Pin kg so the weight field's label is stable (the default is lb).
  await sql`insert into user_preferences (user_id, unit) values (${userId}, 'kg')`
})

test.afterAll(async () => {
  if (sql && userId) {
    await sql`delete from workouts where user_id = ${userId}` // cascade takes the children
    await sql`delete from user_preferences where user_id = ${userId}`
    await sql.end()
  }
  if (userId) await deleteTestUser(userId)
})

/**
 * Asserts the CTA does not move when the focused weight field blurs, leaving
 * focus back IN the field so the caller can test the real tap next.
 */
async function expectCtaAnchoredAcrossBlur(
  page: Page,
  weight: Locator,
  cta: Locator,
): Promise<void> {
  await expect(weight).toBeFocused()
  const focused = await cta.boundingBox()

  await weight.blur()
  // Let the unmount + any rise-in settle before re-measuring; a race here
  // would read the old box and pass a regression.
  await page.waitForTimeout(400)
  const blurred = await cta.boundingBox()

  expect(focused).not.toBeNull()
  expect(blurred).not.toBeNull()
  expect(blurred!.y).toBeCloseTo(focused!.y, 0)
  expect(blurred!.height).toBeCloseTo(focused!.height, 0)

  await weight.click()
  await page.waitForTimeout(300)
  await expect(weight).toBeFocused()
}

/** Fills Set 1 of a fresh session and leaves focus in the weight field. */
async function logOneSet(page: Page): Promise<Locator> {
  await addExercise(page, 'bench')
  await typeInto(page.getByLabel('Set 1 reps'), '5')
  const weight = page.getByLabel('Set 1 weight in kg')
  await typeInto(weight, '100')
  return weight
}

for (const [label, viewport] of [
  ['phone', PHONE],
  ['desktop', DESKTOP],
] as const) {
  test(`Finish takes the first tap with a set input still focused (${label})`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await signIn(page, user)

    await page.goto('/workout/new')
    const weight = await logOneSet(page)

    const finish = page.getByRole('button', { name: /finish workout/i })
    await expectCtaAnchoredAcrossBlur(page, weight, finish)

    // The tap itself: one real click, focus still in the weight field.
    await finish.click()
    await expect(page).toHaveURL(FINISHED_URL, { timeout: 20_000 })

    // And it saved what was typed — a bar that no longer eats the tap is only
    // half the story if the field's value never reached React.
    const id = workoutIdFrom(page.url())
    const sets = await sql<{ weight: number; reps: number }[]>`
      select s.weight::float8 as weight, s.reps
      from sets s
      join workout_exercises we on we.id = s.workout_exercise_id
      where we.workout_id = ${id} and s.set_number = 1
    `
    expect(sets).toEqual([{ weight: 100, reps: 5 }])

    await sql`delete from workouts where id = ${id}`
  })
}

test('Save changes takes the first tap on the edit surface', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await signIn(page, user)

  // A saved workout to correct. Finish is exercised above; here it is setup,
  // so blur first rather than re-testing the same tap.
  await page.goto('/workout/new')
  const newWeight = await logOneSet(page)
  await newWeight.blur()
  await page.getByRole('button', { name: /finish workout/i }).click()
  await expect(page).toHaveURL(FINISHED_URL, { timeout: 20_000 })
  const id = workoutIdFrom(page.url())

  await page.goto(`/workout/${id}/edit`)
  // Every set is complete, so the card arrives folded — its inputs are not in
  // the tree until it is expanded.
  await page.getByRole('button', { name: /^Expand .* — completed/i }).click()

  const weight = page.getByLabel('Set 1 weight in kg')
  await typeInto(weight, '105')

  const save = page.getByRole('button', { name: /save changes/i })
  await expectCtaAnchoredAcrossBlur(page, weight, save)

  await save.click()
  await expect(page).toHaveURL(detailUrl(id), { timeout: 20_000 })

  const sets = await sql<{ weight: number }[]>`
    select s.weight::float8 as weight
    from sets s
    join workout_exercises we on we.id = s.workout_exercise_id
    where we.workout_id = ${id} and s.set_number = 1
  `
  expect(sets).toEqual([{ weight: 105 }])
})
