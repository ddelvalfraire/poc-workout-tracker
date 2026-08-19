import { describe, it, expect } from 'vitest'
import { decideIdentityAction } from './consent-identity'

/**
 * The pure decision core of the identify()/reset() reconciler. The invariant
 * that matters most: reset() must NEVER fire on an anonymous device — that
 * would churn device ids on every page load.
 */
describe('decideIdentityAction', () => {
  it('identifies a consented, still-anonymous device', () => {
    expect(decideIdentityAction('anon-device-id', 'user_1', true)).toBe('identify')
    expect(decideIdentityAction(undefined, 'user_1', true)).toBe('identify')
  })

  it('is a no-op when the device already matches the consented identity', () => {
    expect(decideIdentityAction('user_1', 'user_1', true)).toBe('none')
  })

  it('resets only a device identified as this user after withdrawal', () => {
    expect(decideIdentityAction('user_1', 'user_1', false)).toBe('reset')
  })

  it('never resets an anonymous device — no id churn on ordinary loads', () => {
    expect(decideIdentityAction('anon-device-id', 'user_1', false)).toBe('none')
    expect(decideIdentityAction(undefined, 'user_1', false)).toBe('none')
  })
})
