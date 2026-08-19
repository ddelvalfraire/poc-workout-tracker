import { type Page } from '@playwright/test'

/**
 * Disposable-user provisioning and UI sign-in for the e2e suite, against the
 * LIVE WorkOS environment named by WORKOS_API_KEY.
 *
 * There is no `@workos-inc/testing` Playwright helper — nothing mints a session
 * out of band the way Clerk's testing token did — so sign-in has to go through
 * the real hosted AuthKit page. That is why every spec funnels through this one
 * module: the hosted page is third-party DOM we do not control, and when its
 * markup shifts, `signIn` below is the ONLY place that needs correcting.
 *
 * !! UNVERIFIED SELECTORS !!
 * The locators in `signIn` are written against WorkOS's documented hosted
 * AuthKit sign-in page but have NOT been run against the live page (this suite
 * was ported before a WorkOS environment existed). They are intentionally
 * intention-revealing (labels and roles, with semantic input-type fallbacks) so
 * they survive cosmetic changes. If sign-in fails on first run, fix it HERE —
 * do not scatter page-specific selectors back into the specs.
 */

const WORKOS_API = 'https://api.workos.com/user_management'

/** Matches `use.baseURL` in playwright.config.ts. */
const APP_ORIGIN = 'http://localhost:3000'

export type TestUser = {
  /** WorkOS user id — also the `user_id` the app writes on every row. */
  readonly id: string
  readonly email: string
  readonly password: string
}

function apiKey(): string {
  const key = process.env.WORKOS_API_KEY
  if (!key) throw new Error('WORKOS_API_KEY is not set — see e2e/global.setup.ts')
  return key
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
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
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
    headers: { Authorization: `Bearer ${apiKey()}` },
  })
  // 404 means a prior teardown (or the app's own delete-account flow) got there
  // first — that is the desired end state, not a failure.
  if (!res.ok && res.status !== 404) {
    throw new Error(`WorkOS delete user failed (${res.status}) for ${id}`)
  }
}

/**
 * Signs in through the real UI: /sign-in redirects to the hosted AuthKit page,
 * we fill the credentials there, and AuthKit's callback drops us back on the
 * app with a session cookie. Returns once the browser is back on our origin, so
 * callers can assert on app UI immediately.
 *
 * See the UNVERIFIED SELECTORS note at the top of this file.
 */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/sign-in')

  const emailField = page
    .getByLabel(/email/i)
    .or(page.locator('input[type="email"], input[name="email"]'))
    .first()
  await emailField.waitFor({ state: 'visible', timeout: 30_000 })
  await emailField.fill(user.email)

  const passwordField = page
    .getByLabel(/password/i)
    .or(page.locator('input[type="password"]'))
    .first()

  // AuthKit shows the password on the same screen when password auth is the
  // only enabled method, and behind a "Continue" step when it has to resolve
  // the auth method from the email first. Handle both rather than guessing.
  if (!(await passwordField.isVisible())) {
    await page
      .getByRole('button', { name: /continue|next|sign in/i })
      .first()
      .click()
    await passwordField.waitFor({ state: 'visible', timeout: 30_000 })
  }
  await passwordField.fill(user.password)

  await page
    .getByRole('button', { name: /continue|sign in|log in/i })
    .first()
    .click()

  await page.waitForURL((url) => url.origin === APP_ORIGIN, { timeout: 30_000 })
}
