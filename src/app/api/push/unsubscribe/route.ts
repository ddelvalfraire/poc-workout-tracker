import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth/auth'
import { parsePushEndpoint } from '@/lib/push/push-input'
import { deletePushSubscription } from '@/db/push-subscriptions'

/**
 * POST /api/push/unsubscribe — drops the signed-in user's subscription for
 * one endpoint. POST (not DELETE) so the body-carrying request stays
 * unremarkable across proxies; ownership-scoped delete, so a user can only
 * ever remove their own rows. Idempotent: deleting a gone row is success.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const endpoint = parsePushEndpoint(body)
  if (!endpoint) {
    return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 })
  }

  try {
    await deletePushSubscription(userId, endpoint)
    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    console.error('POST /api/push/unsubscribe failed', error)
    return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 })
  }
}
