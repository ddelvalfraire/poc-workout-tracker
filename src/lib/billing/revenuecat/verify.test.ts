import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  verifyAuthorization,
  verifySignature,
  SIGNATURE_TOLERANCE_SECONDS,
} from './verify'

describe('verifyAuthorization', () => {
  it('accepts the exact configured value', () => {
    expect(verifyAuthorization('rc-shared-secret', 'rc-shared-secret')).toBe(true)
  })

  it('rejects a wrong value', () => {
    expect(verifyAuthorization('rc-shared-secreT', 'rc-shared-secret')).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(verifyAuthorization(null, 'rc-shared-secret')).toBe(false)
  })

  it('rejects everything when the expected value is empty — unset config is closed, not open', () => {
    expect(verifyAuthorization('', '')).toBe(false)
    expect(verifyAuthorization(null, '')).toBe(false)
  })

  it('rejects a prefix of the secret (length mismatch path)', () => {
    expect(verifyAuthorization('rc-shared', 'rc-shared-secret')).toBe(false)
  })
})

const SECRET = 'whsec_test_secret'
const BODY = '{"event":{"id":"evt-1","type":"TEST","environment":"SANDBOX"}}'

/** A valid header for BODY signed at `at` with `secret`. */
function sign(at: Date, secret = SECRET, body = BODY): string {
  const t = Math.floor(at.getTime() / 1000)
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  return `t=${t},v1=${v1}`
}

const NOW = new Date('2026-08-21T12:00:00Z')

describe('verifySignature', () => {
  it('accepts a valid signature within tolerance', () => {
    expect(verifySignature(BODY, sign(NOW), [SECRET], NOW)).toBe(true)
  })

  it('rejects a tampered body', () => {
    const tampered = BODY.replace('SANDBOX', 'PRODUCTION')
    expect(verifySignature(tampered, sign(NOW), [SECRET], NOW)).toBe(false)
  })

  it('rejects the right body signed with the wrong secret', () => {
    expect(verifySignature(BODY, sign(NOW, 'whsec_other'), [SECRET], NOW)).toBe(false)
  })

  it('accepts a signature by the previous secret during rotation', () => {
    const old = 'whsec_old'
    expect(verifySignature(BODY, sign(NOW, old), [SECRET, old], NOW)).toBe(true)
  })

  it('rejects a timestamp beyond the replay tolerance, in both directions', () => {
    const past = new Date(NOW.getTime() - (SIGNATURE_TOLERANCE_SECONDS + 1) * 1000)
    const future = new Date(NOW.getTime() + (SIGNATURE_TOLERANCE_SECONDS + 1) * 1000)
    expect(verifySignature(BODY, sign(past), [SECRET], NOW)).toBe(false)
    expect(verifySignature(BODY, sign(future), [SECRET], NOW)).toBe(false)
  })

  it('accepts a timestamp just inside the tolerance', () => {
    const edge = new Date(NOW.getTime() - (SIGNATURE_TOLERANCE_SECONDS - 1) * 1000)
    expect(verifySignature(BODY, sign(edge), [SECRET], NOW)).toBe(true)
  })

  it('rejects a missing or malformed header', () => {
    expect(verifySignature(BODY, null, [SECRET], NOW)).toBe(false)
    expect(verifySignature(BODY, '', [SECRET], NOW)).toBe(false)
    expect(verifySignature(BODY, 'v1=deadbeef', [SECRET], NOW)).toBe(false)
    expect(verifySignature(BODY, 't=notanumber,v1=deadbeef', [SECRET], NOW)).toBe(false)
    expect(verifySignature(BODY, 'garbage', [SECRET], NOW)).toBe(false)
  })

  it('ignores unknown scheme entries but still honors v1', () => {
    const t = Math.floor(NOW.getTime() / 1000)
    const v1 = createHmac('sha256', SECRET).update(`${t}.${BODY}`).digest('hex')
    expect(verifySignature(BODY, `t=${t},v2=ffff,v1=${v1}`, [SECRET], NOW)).toBe(true)
  })

  it('rejects when no secrets are configured — verifying with nothing is closed', () => {
    expect(verifySignature(BODY, sign(NOW), [], NOW)).toBe(false)
    expect(verifySignature(BODY, sign(NOW), [''], NOW)).toBe(false)
  })
})
