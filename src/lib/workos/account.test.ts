import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUser = vi.hoisted(() => vi.fn())
const getUserIdentities = vi.hoisted(() => vi.fn())
const listUserAuthFactors = vi.hoisted(() => vi.fn())
vi.mock('@workos-inc/authkit-nextjs', () => ({
  getWorkOS: () => ({
    userManagement: { getUser, getUserIdentities },
    multiFactorAuth: { listUserAuthFactors },
  }),
}))

import { getAccountOverview } from './account'
import {
  countSignInMethods,
  providerLabel,
  readMfaMode,
  type AccountOverview,
} from './account-model'

/**
 * Two properties are pinned here because getting either wrong misreports
 * SECURITY state: the environment's MFA posture must fail closed when
 * unconfigured, and a user's enrolled factor must never be inferred from
 * anything but their actual factor list.
 */

const USER = {
  email: 'user@example.test',
  emailVerified: true,
  firstName: 'Ada',
  lastName: 'Lovelace',
  profilePictureUrl: null,
}

function account(over: Partial<AccountOverview> = {}): AccountOverview {
  return {
    email: 'user@example.test',
    emailVerified: true,
    firstName: 'Ada',
    lastName: 'Lovelace',
    profilePictureUrl: null,
    connectedAccounts: ['GoogleOAuth'],
    mfaAvailable: false,
    mfaRequired: false,
    hasMfaFactor: false,
    ...over,
  }
}

beforeEach(() => {
  getUser.mockReset().mockResolvedValue(USER)
  getUserIdentities.mockReset().mockResolvedValue([{ provider: 'GoogleOAuth' }])
  listUserAuthFactors.mockReset().mockResolvedValue({ data: [] })
  vi.unstubAllEnvs()
  // Pinned empty rather than merely unstubbed: unstubbing restores the REAL
  // process.env, and a developer with WORKOS_MFA_MODE set in .env.local would
  // otherwise see the fail-closed cases pass locally and break in CI.
  vi.stubEnv('WORKOS_MFA_MODE', '')
})

describe('readMfaMode', () => {
  it('fails closed when unset', () => {
    expect(readMfaMode({})).toBe('off')
  })

  it('fails closed on an unrecognised value', () => {
    // A typo in an env var must not silently offer enrolment we cannot honour.
    expect(readMfaMode({ WORKOS_MFA_MODE: 'enabled' })).toBe('off')
  })

  it('reads optional and required, case- and space-insensitively', () => {
    expect(readMfaMode({ WORKOS_MFA_MODE: 'Optional' })).toBe('optional')
    expect(readMfaMode({ WORKOS_MFA_MODE: ' required ' })).toBe('required')
  })
})

describe('getAccountOverview', () => {
  it('hides MFA and skips the factor call entirely when the mode is off', async () => {
    const result = await getAccountOverview('user_1')

    expect(result.mfaAvailable).toBe(false)
    expect(result.hasMfaFactor).toBe(false)
    // Not merely false — never asked. A per-render round-trip for a foregone
    // answer is latency on the settings page for nothing.
    expect(listUserAuthFactors).not.toHaveBeenCalled()
  })

  it('reports an enrolled factor when MFA is available', async () => {
    vi.stubEnv('WORKOS_MFA_MODE', 'optional')
    listUserAuthFactors.mockResolvedValue({ data: [{ id: 'auth_factor_1' }] })

    const result = await getAccountOverview('user_1')

    expect(result.mfaAvailable).toBe(true)
    expect(result.mfaRequired).toBe(false)
    expect(result.hasMfaFactor).toBe(true)
    expect(listUserAuthFactors).toHaveBeenCalledWith({ userId: 'user_1' })
  })

  it('marks MFA required without assuming the user has enrolled', async () => {
    vi.stubEnv('WORKOS_MFA_MODE', 'required')
    listUserAuthFactors.mockResolvedValue({ data: [] })

    const result = await getAccountOverview('user_1')

    expect(result.mfaRequired).toBe(true)
    expect(result.hasMfaFactor).toBe(false)
  })

  it('passes the caller-supplied user id straight through to every read', async () => {
    // The id must be the session's, never the client's — pinned so a future
    // signature change that accepts a request value is visible in review.
    await getAccountOverview('user_session')

    expect(getUser).toHaveBeenCalledWith('user_session')
    expect(getUserIdentities).toHaveBeenCalledWith('user_session')
  })

  it('flattens identities to provider keys', async () => {
    getUserIdentities.mockResolvedValue([
      { provider: 'GoogleOAuth' },
      { provider: 'AppleOAuth' },
    ])

    const result = await getAccountOverview('user_1')

    expect(result.connectedAccounts).toEqual(['GoogleOAuth', 'AppleOAuth'])
  })

  it('propagates a failed read rather than defaulting security fields', async () => {
    getUser.mockRejectedValue(new Error('boom'))

    await expect(getAccountOverview('user_1')).rejects.toThrow('boom')
  })

  it('treats a failed identities read as no linked accounts, not a crash', async () => {
    // Some WorkOS-compatible backends (the local emulator, notably) don't
    // implement this endpoint. Losing sign-in-method visibility here is not a
    // security field, so it degrades gracefully instead of failing the page.
    getUserIdentities.mockRejectedValue(new Error('not implemented'))

    const result = await getAccountOverview('user_1')

    expect(result.connectedAccounts).toEqual([])
  })

  it('treats a non-array identities response as no linked accounts', async () => {
    getUserIdentities.mockResolvedValue({ unexpected: 'shape' })

    const result = await getAccountOverview('user_1')

    expect(result.connectedAccounts).toEqual([])
  })
})

describe('countSignInMethods', () => {
  it('counts a lone OAuth identity as one method', () => {
    expect(countSignInMethods(account({ connectedAccounts: ['GoogleOAuth'] }))).toBe(1)
  })

  it('counts every linked provider', () => {
    expect(
      countSignInMethods(account({ connectedAccounts: ['GoogleOAuth', 'AppleOAuth'] })),
    ).toBe(2)
  })

  it('reports zero when nothing is linked', () => {
    expect(countSignInMethods(account({ connectedAccounts: [] }))).toBe(0)
  })
})

describe('providerLabel', () => {
  it('strips the OAuth suffix', () => {
    expect(providerLabel('GoogleOAuth')).toBe('Google')
    expect(providerLabel('AppleOAuth')).toBe('Apple')
  })

  it('leaves an unsuffixed provider alone', () => {
    expect(providerLabel('Google')).toBe('Google')
  })
})
