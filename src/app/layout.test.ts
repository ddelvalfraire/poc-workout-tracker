import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * The root layout MUST hand AuthKitProvider its `initialAuth`.
 *
 * Without it the provider fetches the session from a client effect on mount,
 * and that fetch is a server action — which makes Next refetch the route,
 * which re-runs the effect. Every page reloads forever with the spinner
 * restarting, while the server log shows nothing but healthy 200s.
 *
 * This is a source assertion rather than a render test on purpose: the bug is
 * a MISSING prop, which renders perfectly in every unit environment (no
 * router, no server actions) and only surfaces against a real signed-in
 * session. Grepping the source is what actually catches its removal — the
 * same idiom .storybook/mocks.test.ts uses for its alias guard.
 */
const LAYOUT = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8')

describe('root layout auth wiring', () => {
  it('passes initialAuth to AuthKitProvider', () => {
    // Arrange / Act / Assert
    expect(LAYOUT).toMatch(/<AuthKitProvider\s+initialAuth=\{/)
  })

  it('reads the session server-side so the provider never has to', () => {
    expect(LAYOUT).toMatch(/await\s+withAuth\(\)/)
  })

  it('keeps the access token out of what reaches the client', () => {
    // The provider's own prop type omits accessToken: it is a live credential
    // and initialAuth is serialized into the RSC payload the browser receives.
    // accessToken must be peeled off into its own binding, leaving the rest
    // as initialAuth — never passed through wholesale.
    expect(LAYOUT).toMatch(/const\s*\{\s*accessToken[^}]*\.\.\.initialAuth\s*\}\s*=\s*await\s+withAuth\(\)/)
    expect(LAYOUT).not.toMatch(/initialAuth=\{\s*await\s+withAuth\(\)\s*\}/)
  })
})
