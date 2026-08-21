import { NextResponse } from 'next/server'
import { recordEvent, markIgnored } from '@/db/rc-webhook-events'
import { verifyAuthorization, verifySignature } from '@/lib/billing/revenuecat/verify'
import { rcWebhookBodySchema } from '@/lib/billing/revenuecat/types'

// node:crypto and the Postgres driver; and a webhook must never be cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/revenuecat — RevenueCat's webhook endpoint. Public in
 * the AuthKit middleware (src/proxy.ts) because the caller is a robot; gated
 * here instead by two fail-closed layers (Authorization header always; HMAC
 * signature when configured — it is an RC Pro-plan feature). Architecture,
 * event triage and failure semantics: docs/SPIKE-REVENUECAT.md.
 *
 * Status contract (RC retries on non-200, 5 times, same event id):
 * - 401 unauthenticated, 400 unparseable — RC retries; if it is truly not
 *   RC, retries exhaust harmlessly.
 * - 200 for everything we accepted responsibility for, including events we
 *   deliberately ignore — a 5xx would burn retries on a decision, not a
 *   failure.
 *
 * NOTE: processing is stubbed in this PR. Accepted events stay `received` in
 * the inbox — deliberately, so the reconciliation backstop (PR 3) can sweep
 * anything that arrives before the processor (PR 2) ships.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const authToken = process.env.RC_WEBHOOK_AUTH_TOKEN
  // Fail closed: no configured secret means nobody is authorized.
  if (!authToken || !verifyAuthorization(request.headers.get('authorization'), authToken)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Raw bytes BEFORE any parsing — the signature covers them verbatim.
  const rawBody = await request.text()

  const hmacSecrets = [
    process.env.RC_WEBHOOK_HMAC_SECRET ?? '',
    process.env.RC_WEBHOOK_HMAC_SECRET_OLD ?? '',
  ].filter(Boolean)
  if (hmacSecrets.length > 0) {
    const header = request.headers.get('x-revenuecat-webhook-signature')
    if (!verifySignature(rawBody, header, hmacSecrets, new Date())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 })
  }
  const body = rcWebhookBodySchema.safeParse(parsed)
  if (!body.success) {
    return NextResponse.json({ error: 'Unrecognized payload' }, { status: 400 })
  }
  const event = body.data.event

  const disposition = await recordEvent({
    id: event.id,
    type: event.type,
    appUserId: event.app_user_id ?? null,
    environment: event.environment,
    payload: parsed,
  })
  if (disposition === 'already-done') {
    return NextResponse.json({ ok: true, deduplicated: true })
  }

  // Sandbox and production share one webhook stream; only this field says
  // which is which. A sandbox purchase must never touch prod entitlements.
  if (event.environment !== expectedEnvironment()) {
    await markIgnored(event.id)
    return NextResponse.json({ ok: true, ignored: 'environment' })
  }

  // PR 2 replaces this with the processor (classify → fetch truth → project).
  return NextResponse.json({ ok: true, accepted: true })
}

/** PRODUCTION on the prod deployment, SANDBOX everywhere else (preview,
 *  local dev), overridable for e2e harnesses. */
function expectedEnvironment(): string {
  // || not ??: an empty-string env var must mean "unset", not "expect ''" —
  // expecting '' would silently ignore every event.
  return (
    process.env.RC_EXPECTED_ENVIRONMENT ||
    (process.env.VERCEL_ENV === 'production' ? 'PRODUCTION' : 'SANDBOX')
  )
}
