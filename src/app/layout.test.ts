import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * The root layout must NOT read the session.
 *
 * It wraps every route, including the public ones — the legal documents and
 * the /p//w share links. Reading request data here (a session, headers,
 * cookies) opts the WHOLE app out of static rendering: /terms, /privacy and
 * /health-privacy stop being prerendered and get server-rendered per request.
 * Those are the pages store reviewers and crawlers fetch, so the cost lands
 * exactly where traffic is cheapest to serve.
 *
 * This bit once: AuthKitProvider was added here (the vendor's default
 * placement) even though nothing in the app calls `useAuth`. It fetched the
 * session from a client effect via a SERVER ACTION, which made Next refetch
 * the route and re-run the effect — an endless reload. The first fix passed
 * `initialAuth` from a server-side `withAuth()`, which stopped the loop but
 * made every route dynamic. Removing the unused provider fixes both.
 *
 * If a component ever genuinely needs `useAuth`, scope the provider to the
 * authenticated segment — do not restore it here.
 */
const LAYOUT = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8')
const APP_DIR = join(process.cwd(), 'src/app')

describe('root layout stays static-friendly', () => {
  it('does not read the session', () => {
    expect(LAYOUT).not.toMatch(/withAuth|currentUser/)
  })

  it('does not read other request data that would force dynamic rendering', () => {
    expect(LAYOUT).not.toMatch(/\bheaders\(|\bcookies\(|\bdraftMode\(/)
  })

  it('does not mount an auth provider over the public routes', () => {
    expect(LAYOUT).not.toMatch(/AuthKitProvider/)
  })

  it('keeps the legal documents free of session reads too', () => {
    // They are the static ones worth protecting; a session read in the page
    // itself would undo what keeping it out of the layout buys.
    for (const route of ['terms', 'privacy', 'health-privacy']) {
      const src = readFileSync(join(APP_DIR, '(legal)', route, 'page.tsx'), 'utf8')
      expect(src, `${route} must not read the session`).not.toMatch(
        /withAuth|requireUserId|getUserId|\bheaders\(|\bcookies\(/,
      )
    }
  })
})
