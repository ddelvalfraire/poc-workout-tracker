import { type Page } from '@playwright/test'

/**
 * Disposable-user provisioning and UI sign-in for the e2e suite, against the
 * LOCAL WorkOS emulator (`workos emulate`, booted by playwright.config.ts).
 *
 * Why not the real WorkOS environment: AuthKit's hosted sign-in page runs a
 * bot-detection worker that blocks automated browsers outright — verified, not
 * assumed. Clerk solved this with a testing token; WorkOS solves it with an
 * emulator that speaks the same API and serves a plain login page. The app
 * needs NO code changes to use it: authkit-nextjs reads WORKOS_API_HOSTNAME /
 * WORKOS_API_HTTPS / WORKOS_API_PORT, so pointing those at the emulator is
 * enough. That matters — the alternative was shipping a session-minting bypass
 * route in application code, which is a permanent security surface.
 *
 * What this therefore does and does not prove: it exercises OUR auth wiring
 * (the proxy's gating, /callback, the session cookie, redirects) end to end. It
 * does not exercise the real hosted page, which nothing automated can. Pair it
 * with a manual sign-in when the AuthKit configuration itself changes.
 *
 * Every spec funnels through this module so sign-in has exactly one definition.
 */

/** The emulator's fixed defaults — deliberately NOT the real key. The suite
 *  must never be able to touch a live WorkOS environment. */
const EMULATOR_ORIGIN = process.env.WORKOS_E2E_API_BASE ?? 'http://localhost:4100'
const EMULATOR_API_KEY = 'sk_test_default'

const WORKOS_API = `${EMULATOR_ORIGIN}/user_management`

/** Matches `use.baseURL` in playwright.config.ts. */
const APP_ORIGIN = 'http://localhost:3000'

export type TestUser = {
  /** WorkOS user id — also the `user_id` the app writes on every row. */
  readonly id: string
  readonly email: string
  readonly password: string
}

/**
 * WorkOS returns the created user as the response body; some SDK-facing
 * responses wrap it under `user`. Accept either so a wrapper change cannot
 * silently hand us `undefined` as a user id.
 */
function readUserId(body: unknown): string {
  const root = body as { id?: unknown; user?: { id?: unknown } }
  const id = typeof root?.id === 'string' ? root.id : root?.user?.id
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`WorkOS create user returned no id: ${JSON.stringify(body)}`)
  }
  return id
}

/**
 * Provisions a disposable, pre-verified user with a password. `slug` keeps the
 * addresses of concurrently-developed specs distinct in the WorkOS dashboard.
 */
export async function createTestUser(slug: string): Promise<TestUser> {
  const stamp = Date.now()
  const email = `e2e_${slug}_${stamp}@example.com`
  const password = `Pw-e2e-${stamp}-aZ9!`

  const res = await fetch(`${WORKOS_API}/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${EMULATOR_API_KEY}`, 'Content-Type': 'application/json' },
    // `email_verified` skips the verification mail, so the hosted page goes
    // straight to the password prompt instead of a "check your email" wall.
    body: JSON.stringify({ email, password, email_verified: true }),
  })
  const body: unknown = await res.json()
  if (!res.ok) {
    throw new Error(`WorkOS create user failed (${res.status}): ${JSON.stringify(body)}`)
  }

  return { id: readUserId(body), email, password }
}

/** Permanently removes the disposable user. Safe to call on an already-gone id. */
export async function deleteTestUser(id: string): Promise<void> {
  const res = await fetch(`${WORKOS_API}/users/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${EMULATOR_API_KEY}` },
  })
  // 404 means a prior teardown (or the app's own delete-account flow) got there
  // first — that is the desired end state, not a failure.
  if (!res.ok && res.status !== 404) {
    throw new Error(`WorkOS delete user failed (${res.status}) for ${id}`)
  }
}

/**
 * Signs in through the real UI: /sign-in redirects to the emulator's login
 * page, we identify the user there, and the callback drops us back on the app
 * with a session cookie. Returns once the browser is back on our origin, so
 * callers can assert on app UI immediately.
 *
 * The emulator identifies users by email alone — there is no password step, so
 * `user.password` is only used when provisioning. Selectors below are taken
 * from the emulator's actual markup (`<label for="email">`, a submit button
 * reading "Continue"), not guessed.
 */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/sign-in')

  const emailField = page
    .getByLabel(/email/i)
    .or(page.locator('input[type="email"], input[name="email"]'))
    .first()
  await emailField.waitFor({ state: 'visible', timeout: 30_000 })
  await emailField.fill(user.email)

  await page
    .getByRole('button', { name: /continue|sign in|log in/i })
    .first()
    .click()

  await page.waitForURL((url) => url.origin === APP_ORIGIN, { timeout: 30_000 })
  await acceptRequiredConsents(page)
}

/**
 * A brand-new account has no consent rows, so the home gate sends it to
 * /welcome. Every spec needs to be past that screen before it can touch the
 * app, and clicking through it is what a real new user does — seeding the rows
 * behind the app's back would skip the very gate that decides whether the app
 * is usable, and would write to a ledger that is append-only by trigger.
 *
 * Idempotent: a session that already consented never lands here.
 */
async function acceptRequiredConsents(page: Page): Promise<void> {
  // Ask for the gate instead of inferring it from the post-callback URL: the
  // redirect chain can still be settling when the sign-in above returns, so
  // the address bar reads '/' while the consent screen is what renders — and
  // the old pathname check skipped the whole step. /welcome is idempotent (it
  // bounces an already-consented account home), so asking is free.
  await page.goto('/welcome')
  const tos = page.locator('#consent-tos')
  if ((await tos.count()) === 0) return // already consented

  for (const id of ['#consent-health-collect', '#consent-health-share', '#consent-tos']) {
    const box = page.locator(id)
    await box.waitFor({ state: 'visible', timeout: 15_000 })
    if ((await box.getAttribute('aria-checked')) !== 'true') await box.click()
  }

  await page.getByRole('button', { name: /continue|agree|get started/i }).last().click()
  await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 30_000 })
}
