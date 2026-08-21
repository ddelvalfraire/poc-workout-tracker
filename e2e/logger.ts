import { expect, type Locator, type Page } from '@playwright/test'
import { APP_ORIGIN } from './app-origin'

/**
 * Shared logger interactions for the e2e suite — the steps every spec that
 * logs a set has to get right, defined once.
 *
 * These exist because the obvious Playwright call is silently wrong here: no
 * error, no warning, the step just doesn't do what it says. Each was found by
 * experiment, not by reading code.
 */

/**
 * Types into one of the logger's fields with REAL keystrokes, replacing
 * whatever is there.
 *
 * Not `fill()`: the logger's name and set fields are Base UI `<Input>`s
 * (src/components/ui/input.tsx), and fill() writes the DOM value without the
 * event Base UI's controlled value listens for — React state never sees it and
 * the next render wipes the field back to "". The symptom is a Finish that
 * saves an empty set. Select-all first so a pre-filled field (a repeat's
 * seeded values, a correction) is replaced rather than appended to.
 */
export async function typeInto(field: Locator, text: string): Promise<void> {
  await field.click()
  await field.press('ControlOrMeta+a')
  await field.pressSequentially(text)
}

/**
 * Opens the exercise picker and adds the first match for `query`.
 *
 * The picker is a sheet the sticky bar opens — an empty logger shows its own
 * empty state, not an open picker, so the "+ Exercise" tap is required. The
 * search field is a plain `<input>` and takes `fill()` fine. Since #233 there
 * is no per-row Add button: a result row IS the control (li role=option).
 */
export async function addExercise(page: Page, query: string): Promise<void> {
  await page.getByRole('button', { name: /^\+ exercise$/i }).click()
  await page.getByLabel('Search exercises').fill(query)
  const result = page.getByRole('option').first()
  await expect(result).toBeVisible({ timeout: 20_000 })
  await result.click()
}

/**
 * Home → a fresh logger, whichever way home is currently offering.
 *
 * The hero is stateful (StatusHero): a day with no session yet says "Start
 * workout", a day that already has one says "Log more". Both land on
 * /workout/new, and which one shows depends on what the spec logged a moment
 * ago — so a spec that logs twice in a day cannot hard-code either.
 */
export async function startWorkout(page: Page): Promise<void> {
  await page.goto('/')
  // Unanchored on purpose: the day-one CTA reads "+ Start Workout", so a
  // ^-anchored "start workout" misses the leading plus.
  const cta = page.getByRole('link', { name: /start workout|log more/i }).first()
  await expect(cta).toBeVisible({ timeout: 15_000 })
  await cta.click()
  await expect(page).toHaveURL(/\/workout\/new$/)
}

/**
 * Where Finish lands: the session summary, with `?finished=1` riding along to
 * dress it as the completion moment. Read the id off the PATH rather than
 * matching the whole URL.
 */
export const FINISHED_URL = /\/workout\/[0-9a-f-]{36}(\?|$)/

/**
 * Presses Finish and lands on the summary, returning the new workout's id.
 *
 * The confirm is CONDITIONAL, which is why this is a helper rather than a
 * click: a set with reps is checked off for the user silently, but a set left
 * empty saves as "skipped" and costs a "Finish workout?" dialog first. Which
 * one a spec gets depends on whether it left a set blank, so both are handled
 * here. The dialog is scoped by its title — the sticky bar's own Finish button
 * is still in the tree behind it.
 *
 * Whichever arrives first settles the race: the dialog renders client-side on
 * click, the redirect needs a server round-trip.
 */
export async function finishWorkout(page: Page): Promise<string> {
  await page.getByRole('button', { name: /finish workout/i }).click()

  const confirm = page.getByLabel('Finish workout?')
  await Promise.race([
    confirm.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {}),
    page.waitForURL(FINISHED_URL, { timeout: 20_000 }).catch(() => {}),
  ])
  const confirmed = await confirm.isVisible().catch(() => false)
  if (confirmed) {
    await confirm.getByRole('button', { name: /^finish$/i }).click()
  }

  // Budget only where waiting can still pay off. The race above already spent
  // up to 20s; if it ended with NEITHER the dialog nor the URL then nothing is
  // in flight, and a second full budget just doubles the time to the same
  // failure (40s). Only the dialog branch has a fresh round-trip left to wait
  // for. On the already-landed path this assertion resolves immediately, so
  // the short timeout costs a passing run nothing.
  await expect(page).toHaveURL(FINISHED_URL, { timeout: confirmed ? 20_000 : 2_000 })
  return workoutIdFrom(page.url())
}

/** The summary URL for `id`, without the completion-moment query. */
export function detailUrl(id: string): string {
  return `${APP_ORIGIN}/workout/${id}`
}

/** Reads the workout id out of a summary or logger URL. */
export function workoutIdFrom(url: string): string {
  return new URL(url).pathname.split('/').filter(Boolean)[1]
}
