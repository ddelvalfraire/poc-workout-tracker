import { NextResponse } from 'next/server'
import {
  recordEvent,
  markFailed,
  markIgnored,
  markOrphaned,
  markProcessed,
} from '@/db/rc-webhook-events'
import { expectedRcEnvironment } from '@/lib/billing/revenuecat/client'
import { processRcEvent } from '@/lib/billing/revenuecat/processor'
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
 *   deliberately ignore and events we cannot ever process (orphans) — a 5xx
 *   would burn retries on a decision, not a failure.
 * - 503 ONLY for transient processing failures (RC API weather, a DB blip):
 *   the inbox row is marked failed and RC's redelivery is the retry loop.
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
  if (event.environment !== expectedRcEnvironment()) {
    await markIgnored(event.id)
    return NextResponse.json({ ok: true, ignored: 'environment' })
  }

  const outcome = await processRcEvent(event)
  switch (outcome.kind) {
    case 'processed':
      await markProcessed(event.id)
      return NextResponse.json({ ok: true, accepted: true })
    case 'ignored':
      await markIgnored(event.id)
      return NextResponse.json({ ok: true, ignored: 'event-type' })
    case 'orphaned':
      // Permanently unprocessable — a 200, or RC burns retries on something
      // retrying cannot fix. The row keeps the note for the ops surface.
      console.error(`[revenuecat] orphaned event ${event.id}: ${outcome.note}`)
      await markOrphaned(event.id, outcome.note)
      return NextResponse.json({ ok: true, orphaned: true })
    case 'retryable':
      console.error(`[revenuecat] event ${event.id} failed, RC will retry: ${outcome.error}`)
      await markFailed(event.id, outcome.error)
      return NextResponse.json({ error: 'Processing failed' }, { status: 503 })
  }
}

