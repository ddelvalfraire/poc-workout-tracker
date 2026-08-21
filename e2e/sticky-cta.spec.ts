import { test, expect, type Locator, type Page } from '@playwright/test'
import postgres from 'postgres'
import { createTestUser, deleteTestUser, signIn, type TestUser } from './auth'
import { addExercise, detailUrl, FINISHED_URL, typeInto, workoutIdFrom } from './logger'

/**
 * Nothing the user is about to tap may move when focus leaves a set input.
 *
 * The bug this pins: the WeightStepper rail is focus-gated (it mounts on the
 * weight input's focus, unmounts on its blur) and used to live in the
 * scrolling content ABOVE the bar. The bar used to render at its flow position, so the
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
 *
 * TWO controls are covered, because they needed two different fixes. The bar
 * was ANCHORED (#294, mt-auto on a flex-column main) so its position stops
 * depending on content height. That did nothing for "+ Add set", which sits
 * BELOW the rail in the scrolling flow — for that, the rail had to leave the
 * flow altogether, which is why it now mounts inside the bar. Undo either
 * half and one of the tests below goes red.
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
  // The rail IS the reflow, so wait on the rail rather than on a clock: its
  // presence and absence are the two states whose geometry must match. A
  // fixed timeout here would either race the unmount (reading the old box and
  // passing a regression) or pad every run to cover the slowest machine.
  const rail = page.getByRole('button', { name: /^decrease set 1 /i })

  await expect(weight).toBeFocused()
  await expect(rail).toBeVisible()
  const focused = await cta.boundingBox()

  await weight.blur()
  await expect(rail).toHaveCount(0)
  const blurred = await cta.boundingBox()

  expect(focused).not.toBeNull()
  expect(blurred).not.toBeNull()
  expect(blurred!.y).toBeCloseTo(focused!.y, 0)
  expect(blurred!.height).toBeCloseTo(focused!.height, 0)

  // Hand the caller a focused field again, so the tap it tests is the real
  // "first tap with the keyboard still up" case.
  await weight.click()
  await expect(weight).toBeFocused()
  await expect(rail).toBeVisible()
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

/**
 * The same reflow, one control further down. "+ Add set" sits BELOW the rail
 * in the scrolling flow, so anchoring the bar never protected it: mousedown
 * blurred the weight field, the rail unmounted, the button jumped up by the
 * rail's height (measured: y 453 -> 393), mouseup landed on nothing, and the
 * browser never synthesized a click. Set 2 was simply never added — no error,
 * and Playwright reported the click as having succeeded.
 *
 * Both halves again, for the same reasons as above: GEOMETRY says the button
 * is genuinely out of the rail's reflow, BEHAVIOUR says a real tap lands.
 * This is the test that fails if the rail is ever moved back under the
 * focused row.
 */
for (const [label, viewport] of [
  ['phone', PHONE],
  ['desktop', DESKTOP],
] as const) {
  test(`+ Add set takes the first tap with a set input still focused (${label})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await signIn(page, user)

    await page.goto('/workout/new')
    const weight = await logOneSet(page)

    // Scoped to the logger: the program builder has a "+ Add set" of its own,
    // and a locator that could match either would rot silently.
    const addSet = page.getByRole('button', { name: /^\+ add set$/i })
    await expect(addSet).toHaveCount(1)
    const secondSet = page.getByLabel('Set 2 reps')
    await expect(secondSet).toHaveCount(0)

    await expectCtaAnchoredAcrossBlur(page, weight, addSet)

    // The tap itself: one real click, focus still in the weight field. The
    // blur it fires unmounts the rail — if that reflow can still reach this
    // button, mouseup lands elsewhere and no row is ever added.
    await addSet.click()
    await expect(secondSet).toBeVisible()
  })
}
