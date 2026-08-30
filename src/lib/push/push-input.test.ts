import { describe, it, expect } from 'vitest'
import { parsePushSubscriptionInput, parsePushEndpoint } from './push-input'

const VALID = {
  endpoint: 'https://push.example.com/sub/1',
  keys: { p256dh: 'BValidKey_-', auth: 'ValidAuth_-' },
}

describe('parsePushSubscriptionInput', () => {
  it('accepts the browser toJSON() shape', () => {
    // Arrange + Act
    const result = parsePushSubscriptionInput(VALID)

    // Assert
    expect(result).toEqual(VALID)
  })

  it('rejects a non-https endpoint', () => {
    expect(
      parsePushSubscriptionInput({ ...VALID, endpoint: 'http://push.example.com/sub/1' }),
    ).toBeNull()
  })

  it('rejects a non-URL endpoint', () => {
    expect(parsePushSubscriptionInput({ ...VALID, endpoint: 'not a url' })).toBeNull()
  })

  it('rejects missing keys', () => {
    expect(parsePushSubscriptionInput({ endpoint: VALID.endpoint })).toBeNull()
    expect(
      parsePushSubscriptionInput({ endpoint: VALID.endpoint, keys: { p256dh: 'B' } }),
    ).toBeNull()
  })

  it('rejects non-base64url key characters', () => {
    expect(
      parsePushSubscriptionInput({ ...VALID, keys: { p256dh: 'has space', auth: 'ok' } }),
    ).toBeNull()
  })

  it('rejects an endpoint over the length cap', () => {
    const long = 'https://push.example.com/' + 'a'.repeat(2100)
    expect(parsePushSubscriptionInput({ ...VALID, endpoint: long })).toBeNull()
  })

  it('rejects keys over the length cap', () => {
    expect(
      parsePushSubscriptionInput({
        ...VALID,
        keys: { p256dh: 'a'.repeat(600), auth: 'ok' },
      }),
    ).toBeNull()
  })

  it('rejects junk bodies', () => {
    expect(parsePushSubscriptionInput(null)).toBeNull()
    expect(parsePushSubscriptionInput('string')).toBeNull()
    expect(parsePushSubscriptionInput(undefined)).toBeNull()
  })
})

describe('parsePushEndpoint', () => {
  it('accepts an https endpoint', () => {
    expect(parsePushEndpoint({ endpoint: VALID.endpoint })).toBe(VALID.endpoint)
  })

  it('rejects http and junk', () => {
    expect(parsePushEndpoint({ endpoint: 'http://push.example.com/x' })).toBeNull()
    expect(parsePushEndpoint({})).toBeNull()
    expect(parsePushEndpoint(null)).toBeNull()
  })
})
