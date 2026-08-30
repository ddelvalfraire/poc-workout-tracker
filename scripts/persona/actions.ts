import { getActiveConsentDocument, recordConsent } from '@/db/consent'
import { setWeightUnit } from '@/db/preferences'
import { applyGrant, type ApplyGrantInput } from '@/db/entitlements'
import { purgeUserData } from '@/db/purge-user-data'

/**
 * Persona Foundry's action layer: identity provisioning against the LOCAL
 * WorkOS emulator, plus thin wrappers over the app's own `@/db/*` write
 * functions. Never reachable from a user request — this file is only ever
 * dynamically imported by scripts/seed-persona.ts, after the host guard has
 * already run (see DEFERRED_DYNAMIC_IMPORT in the plan), so static `@/db/*`
 * imports here are safe.
 */

/** The emulator's fixed defaults — deliberately NOT a real WorkOS key. */
const EMULATOR_ORIGIN = process.env.WORKOS_E2E_API_BASE ?? 'http://localhost:4100'
const EMULATOR_API_KEY = 'sk_test_default'
const WORKOS_API = `${EMULATOR_ORIGIN}/user_management`

/** Same loopback-only shape as scripts/persona/guard.ts, applied to the
 *  emulator origin: a developer copying WORKOS_E2E_API_BASE from e2e/auth.ts
 *  without reading what it does must not be able to point persona creation
 *  at a real WorkOS environment. */
const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal|db)(:\d+)?\/?$/

function assertLocalEmulator(origin: string): void {
  if (LOCAL_ORIGIN_PATTERN.test(origin)) return
  throw new Error(
    `Refusing to create a persona identity against a non-local WorkOS origin (${origin}).\n` +
      'WORKOS_E2E_API_BASE must point at the local `workos emulate` server.',
  )
}

/**
 * WorkOS returns the created user as the response body; some SDK-facing
 * responses wrap it under `user`. Accept either so a wrapper change cannot
 * silently hand us `undefined` as a user id. Mirrors e2e/auth.ts's private
 * readUserId.
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
 * Provisions a fixed-email, pre-verified persona identity against the LOCAL
 * WorkOS emulator. Unlike e2e/auth.ts's timestamp-suffixed disposable users,
 * the email is fixed (`persona_<slug>@example.com`) — that is what makes a
 * persona nameable and re-findable across runs. Requires
 * `npx workos@latest emulate --port 4100 --interactive` to already be
 * running; fails fast with an actionable message if it is not.
 */
export async function createPersonaIdentity(slug: string): Promise<{ id: string; email: string }> {
  assertLocalEmulator(EMULATOR_ORIGIN)

  const health = await fetch(`${EMULATOR_ORIGIN}/health`).catch(() => null)
  if (!health || !health.ok) {
    throw new Error(
      'WorkOS emulator unreachable at ' +
        `${EMULATOR_ORIGIN}/health. Start it first:\n` +
        '  npx workos@latest emulate --port 4100 --interactive',
    )
  }

  const email = `persona_${slug}@example.com`
  const password = `Pw-persona-${slug}-aZ9!`
  const res = await fetch(`${WORKOS_API}/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${EMULATOR_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_verified: true }),
  })
  const body: unknown = await res.json()
  if (!res.ok) {
    throw new Error(`WorkOS create user failed (${res.status}): ${JSON.stringify(body)}`)
  }
  return { id: readUserId(body), email }
}

/** Permanently removes a persona identity. Safe to call on an already-gone id. */
export async function deletePersonaIdentity(id: string): Promise<void> {
  assertLocalEmulator(EMULATOR_ORIGIN)
  const res = await fetch(`${WORKOS_API}/users/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${EMULATOR_API_KEY}` },
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`WorkOS delete user failed (${res.status}) for ${id}`)
  }
}

const PRESENTATION = (controlLabel: string) => ({
  route: '/welcome',
  surface: 'signup' as const,
  controlLabel,
})

/**
 * Reproduces the exact three-consent sequence a real /welcome signup
 * performs (src/app/welcome/actions.ts) — health_collect, health_share, tos —
 * so a seeded persona passes the consent gate exactly like a real user would.
 * analytics_identity is deliberately NOT granted: day-one/week-one personas
 * don't opt in, and granting it silently would misrepresent what they are.
 */
export async function consentAll(userId: string): Promise<void> {
  const [tosDoc, healthDoc] = await Promise.all([
    getActiveConsentDocument('tos'),
    getActiveConsentDocument('health_notice'),
  ])
  if (!tosDoc || !healthDoc) {
    throw new Error(
      'consent documents not seeded — run `npm run db:seed-consent-docs` against this database first',
    )
  }
  const base = { userId, ip: null, userAgent: 'persona-foundry' }
  await recordConsent({
    ...base,
    purpose: 'health_collect',
    action: 'granted',
    documentId: healthDoc.id,
    presentation: PRESENTATION('Health data collection'),
  })
  await recordConsent({
    ...base,
    purpose: 'health_share',
    action: 'granted',
    documentId: healthDoc.id,
    presentation: PRESENTATION('Health data sharing'),
  })
  await recordConsent({
    ...base,
    purpose: 'tos',
    action: 'granted',
    documentId: tosDoc.id,
    presentation: PRESENTATION('Terms of service'),
  })
}

export async function setUnit(userId: string, unit: 'kg' | 'lb'): Promise<void> {
  await setWeightUnit(userId, unit)
}

/**
 * Grants a tier outside the payment flow — the same `applyGrant` seam ops
 * comps ride. `source: 'manual'` (GrantSource, src/lib/entitlements/tiers.ts)
 * is the closest fit: a human/tool granting this, not a payment processor.
 */
export async function grantTier(
  userId: string,
  input: Omit<ApplyGrantInput, 'userId' | 'source'>,
): Promise<void> {
  await applyGrant({ ...input, userId, source: 'manual' })
}

export async function purgePersona(userId: string): Promise<void> {
  await purgeUserData(userId)
}
