import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'

/**
 * The route's status-code contract, with the inbox mocked: what RC's
 * retry machinery sees for each class of request. The verification logic
 * itself is pinned in verify.test.ts; here it only gates.
 */

const recordEvent = vi.fn()
const markIgnored = vi.fn()

vi.mock('@/db/rc-webhook-events', () => ({
  recordEvent: (...args: unknown[]) => recordEvent(...args),
  markIgnored: (...args: unknown[]) => markIgnored(...args),
}))

import { POST } from './route'

const AUTH = 'rc-auth-token-test'

function makeRequest(opts: {
  body?: string
  auth?: string | null
  signature?: string | null
}): Request {
  const headers = new Headers()
  if (opts.auth !== null) headers.set('authorization', opts.auth ?? AUTH)
  if (opts.signature) headers.set('x-revenuecat-webhook-signature', opts.signature)
  return new Request('https://app.test/api/webhooks/revenuecat', {
    method: 'POST',
    headers,
    body: opts.body ?? eventBody(),
  })
}

function eventBody(event: Record<string, unknown> = {}): string {
  return JSON.stringify({
    api_version: '1.0',
    event: {
      id: 'evt-synthetic-1',
      type: 'INITIAL_PURCHASE',
      environment: 'SANDBOX',
      app_user_id: 'user_01SYNTHETIC',
      ...event,
    },
  })
}

beforeEach(() => {
  recordEvent.mockReset().mockResolvedValue('new')
  markIgnored.mockReset().mockResolvedValue(undefined)
  vi.stubEnv('RC_WEBHOOK_AUTH_TOKEN', AUTH)
  // Local test runs have no VERCEL_ENV → expected environment is SANDBOX.
  vi.stubEnv('RC_WEBHOOK_HMAC_SECRET', '')
  vi.stubEnv('RC_WEBHOOK_HMAC_SECRET_OLD', '')
  vi.stubEnv('RC_EXPECTED_ENVIRONMENT', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/webhooks/revenuecat', () => {
  it('accepts a valid event and records it in the inbox', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(200)
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'evt-synthetic-1',
        type: 'INITIAL_PURCHASE',
        appUserId: 'user_01SYNTHETIC',
        environment: 'SANDBOX',
      }),
    )
  })

  it('401s a wrong Authorization header without touching the inbox', async () => {
    const res = await POST(makeRequest({ auth: 'wrong' }))
    expect(res.status).toBe(401)
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('401s a missing Authorization header', async () => {
    const res = await POST(makeRequest({ auth: null }))
    expect(res.status).toBe(401)
  })

  it('401s everything when RC_WEBHOOK_AUTH_TOKEN is unset — fail closed', async () => {
    vi.stubEnv('RC_WEBHOOK_AUTH_TOKEN', '')
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(401)
  })

  it('enforces the HMAC when a secret is configured', async () => {
    vi.stubEnv('RC_WEBHOOK_HMAC_SECRET', 'whsec_test')
    const unsigned = await POST(makeRequest({}))
    expect(unsigned.status).toBe(401)

    const body = eventBody()
    const t = Math.floor(Date.now() / 1000)
    const v1 = createHmac('sha256', 'whsec_test').update(`${t}.${body}`).digest('hex')
    const signed = await POST(makeRequest({ body, signature: `t=${t},v1=${v1}` }))
    expect(signed.status).toBe(200)
  })

  it('400s malformed JSON', async () => {
    const res = await POST(makeRequest({ body: '{not json' }))
    expect(res.status).toBe(400)
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('400s a body without an event envelope', async () => {
    const res = await POST(makeRequest({ body: JSON.stringify({ hello: 'world' }) }))
    expect(res.status).toBe(400)
  })

  it('200s a duplicate of finished work without reprocessing', async () => {
    recordEvent.mockResolvedValue('already-done')
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ deduplicated: true })
    expect(markIgnored).not.toHaveBeenCalled()
  })

  it('ignores an event from the wrong environment with a 200 — a sandbox purchase must not touch prod', async () => {
    vi.stubEnv('RC_EXPECTED_ENVIRONMENT', 'PRODUCTION')
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ignored: 'environment' })
    expect(markIgnored).toHaveBeenCalledWith('evt-synthetic-1')
  })

  it('records the event before the environment filter, so filtered events still dedupe', async () => {
    vi.stubEnv('RC_EXPECTED_ENVIRONMENT', 'PRODUCTION')
    await POST(makeRequest({}))
    expect(recordEvent).toHaveBeenCalled()
  })

  it('accepts an event with no app_user_id (some event types carry none)', async () => {
    const body = eventBody({ app_user_id: undefined })
    const res = await POST(makeRequest({ body }))
    expect(res.status).toBe(200)
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ appUserId: null }))
  })
})
