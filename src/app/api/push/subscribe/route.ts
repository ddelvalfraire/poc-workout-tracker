import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { parsePushSubscriptionInput } from '@/lib/push-input'
import { upsertPushSubscription } from '@/db/push-subscriptions'

/**
 * POST /api/push/subscribe — stores the browser's push subscription for the
 * signed-in user. Clerk-gated like the other API routes (middleware + explicit
 * check); the body is the untrusted `PushSubscription.toJSON()` shape,
 * validated at the boundary (lib/push-input.ts). Upsert on endpoint: a
 * re-subscribe (or another user on the same device) takes the row over.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const subscription = parsePushSubscriptionInput(body)
  if (!subscription) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  try {
    await upsertPushSubscription(userId, {
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    })
    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    console.error('POST /api/push/subscribe failed', error)
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
  }
}
