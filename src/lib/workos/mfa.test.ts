import { describe, it, expect, vi, beforeEach } from 'vitest'

const createUserAuthFactor = vi.hoisted(() => vi.fn())
const verifyChallenge = vi.hoisted(() => vi.fn())
const listUserAuthFactors = vi.hoisted(() => vi.fn())
const deleteFactor = vi.hoisted(() => vi.fn())
const getRedis = vi.hoisted(() => vi.fn())
vi.mock('@workos-inc/authkit-nextjs', () => ({
  getWorkOS: () => ({
    multiFactorAuth: { createUserAuthFactor, verifyChallenge, listUserAuthFactors, deleteFactor },
  }),
}))
vi.mock('@/lib/redis', () => ({ getRedis }))

import {
  enrollTotpFactor,
  verifyTotpChallenge,
  removeAllFactors,
  savePendingEnrollment,
  readPendingEnrollment,
  clearPendingEnrollment,
  MfaStateUnavailableError,
  type PendingEnrollment,
} from './mfa'

/**
 * Two properties matter more than coverage here: a pending factor is stored
 * and REPLAYED rather than regenerated (a fresh secret behind the user's back
 * is unrecoverable), and factor ids are always listed server-side from the
 * session's user rather than accepted from a caller — deleteFactor performs
 * no ownership check of its own.
 */

const FACTOR: PendingEnrollment = {
  factorId: 'auth_factor_synthetic',
  challengeId: 'auth_challenge_synthetic',
  secret: 'JBSWY3DPEHPK3PXP',
  uri: 'otpauth://totp/Example:user@example.test?secret=JBSWY3DPEHPK3PXP&issuer=Example',
  qrCode: 'data:image/png;base64,iVBORw0KGgo=',
}

function fakeRedis() {
  const store = new Map<string, string>()
  return {
    store,
    set: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    del: vi.fn(async (k: string) => void store.delete(k)),
  }
}

beforeEach(() => {
  createUserAuthFactor.mockReset()
  verifyChallenge.mockReset()
  listUserAuthFactors.mockReset()
  deleteFactor.mockReset()
  getRedis.mockReset()
})

describe('enrollTotpFactor', () => {
  it('returns every way of adding the factor — uri, secret and qr', async () => {
    // All three matter: the uri is the one-tap path on mobile, the secret is
    // the accessible/manual fallback, the qr only helps a second device.
    createUserAuthFactor.mockResolvedValue({
      authenticationFactor: {
        id: FACTOR.factorId,
        totp: { secret: FACTOR.secret, uri: FACTOR.uri, qrCode: FACTOR.qrCode },
      },
      authenticationChallenge: { id: FACTOR.challengeId },
    })

    await expect(enrollTotpFactor('user_1', 'user@example.test')).resolves.toEqual(FACTOR)
  })

  it('labels the factor with the issuer and the account email', async () => {
    // What the user sees in their authenticator list; a blank or generic
    // label is indistinguishable from every other app they have enrolled.
    createUserAuthFactor.mockResolvedValue({
      authenticationFactor: { id: 'f', totp: { secret: 's', uri: 'u', qrCode: 'q' } },
      authenticationChallenge: { id: 'c' },
    })

    await enrollTotpFactor('user_1', 'user@example.test')

    expect(createUserAuthFactor).toHaveBeenCalledWith({
      userId: 'user_1',
      type: 'totp',
      totpIssuer: 'Workout Tracker',
      totpUser: 'user@example.test',
    })
  })
})

describe('verifyTotpChallenge', () => {
  it('accepts a matching code', async () => {
    verifyChallenge.mockResolvedValue({ valid: true })
    await expect(verifyTotpChallenge('c', '123456')).resolves.toEqual({ kind: 'verified' })
  })

  it('reports a wrong code as a result, not an exception', async () => {
    // The most common thing that happens on this screen; throwing would put
    // an error page in front of a typo.
    verifyChallenge.mockResolvedValue({ valid: false })
    await expect(verifyTotpChallenge('c', '000000')).resolves.toEqual({ kind: 'invalid-code' })
  })

  it('separates an unusable challenge from a wrong code', async () => {
    // Distinct because the remedy differs: a fresh factor, not another guess.
    verifyChallenge.mockRejectedValue(new Error('410'))
    await expect(verifyTotpChallenge('c', '123456')).resolves.toEqual({
      kind: 'challenge-expired',
    })
  })
})

describe('removeAllFactors', () => {
  it('lists ids from the session user rather than trusting a caller', async () => {
    // The IDOR guard: deleteFactor checks no ownership, so ids must be
    // discovered server-side from the user we already authenticated.
    listUserAuthFactors.mockResolvedValue({ data: [{ id: 'f1' }, { id: 'f2' }] })
    deleteFactor.mockResolvedValue(undefined)

    await removeAllFactors('user_1')

    expect(listUserAuthFactors).toHaveBeenCalledWith({ userId: 'user_1' })
    expect(deleteFactor).toHaveBeenCalledWith('f1')
    expect(deleteFactor).toHaveBeenCalledWith('f2')
  })

  it('is a no-op when nothing is enrolled', async () => {
    listUserAuthFactors.mockResolvedValue({ data: [] })
    await removeAllFactors('user_1')
    expect(deleteFactor).not.toHaveBeenCalled()
  })
})

describe('pending enrolment record', () => {
  it('round-trips the issued factor so a returning user sees the SAME secret', async () => {
    const redis = fakeRedis()
    getRedis.mockReturnValue(redis)

    await savePendingEnrollment('user_1', FACTOR)

    expect(await readPendingEnrollment('user_1')).toEqual(FACTOR)
    expect(redis.set).toHaveBeenCalledWith('mfa:enroll:user_1', JSON.stringify(FACTOR), {
      ex: 600,
    })
  })

  it('accepts an already-parsed object back from the client', async () => {
    const redis = fakeRedis()
    // Upstash deserializes JSON automatically in some configurations;
    // assuming a string would throw on the happy path.
    redis.get = vi.fn(async () => FACTOR as unknown as string)
    getRedis.mockReturnValue(redis)

    await expect(readPendingEnrollment('user_1')).resolves.toEqual(FACTOR)
  })

  it('returns null when nothing is pending', async () => {
    getRedis.mockReturnValue(fakeRedis())
    await expect(readPendingEnrollment('user_1')).resolves.toBeNull()
  })

  it('scopes the record to the user', async () => {
    getRedis.mockReturnValue(fakeRedis())
    await savePendingEnrollment('user_1', FACTOR)
    expect(await readPendingEnrollment('user_2')).toBeNull()
  })

  it('clears the record', async () => {
    getRedis.mockReturnValue(fakeRedis())
    await savePendingEnrollment('user_1', FACTOR)
    await clearPendingEnrollment('user_1')
    expect(await readPendingEnrollment('user_1')).toBeNull()
  })

  it('refuses to start enrolment when the store is unavailable', async () => {
    // Failing closed is the point: running enrolment against memory that can
    // vanish would hand the user a secret we cannot verify later.
    getRedis.mockReturnValue(null)

    await expect(savePendingEnrollment('user_1', FACTOR)).rejects.toBeInstanceOf(
      MfaStateUnavailableError,
    )
    await expect(readPendingEnrollment('user_1')).rejects.toBeInstanceOf(MfaStateUnavailableError)
  })
})
