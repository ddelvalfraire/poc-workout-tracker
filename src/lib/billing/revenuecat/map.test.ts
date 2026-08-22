import { describe, it, expect } from 'vitest'
import { classifyEvent, affectedUserIds } from './map'
import type { RcEvent } from './types'

function event(over: Partial<RcEvent>): RcEvent {
  return {
    id: 'evt-synthetic-1',
    type: 'INITIAL_PURCHASE',
    environment: 'PRODUCTION',
    app_user_id: 'user_01SYNTHETIC',
    ...over,
  }
}

describe('classifyEvent', () => {
  it.each([
    'INITIAL_PURCHASE',
    'RENEWAL',
    'NON_RENEWING_PURCHASE',
    'UNCANCELLATION',
    'PRODUCT_CHANGE',
    'SUBSCRIPTION_EXTENDED',
    'REFUND_REVERSED',
    'TEMPORARY_ENTITLEMENT_GRANT',
    'EXPIRATION',
  ])('re-projects %s', (type) => {
    expect(classifyEvent(type)).toBe('reproject')
  })

  it('routes TRANSFER to its own class', () => {
    expect(classifyEvent('TRANSFER')).toBe('transfer')
  })

  it.each([
    'CANCELLATION', // auto-renew off; access runs to period end
    'SUBSCRIPTION_PAUSED', // revocation arrives later as EXPIRATION
    'BILLING_ISSUE', // grace period keeps access
    'TEST',
    'INVOICE_ISSUANCE',
    'SOME_FUTURE_TYPE_RC_INVENTS', // unknown types must never fail
  ])('logs %s only', (type) => {
    expect(classifyEvent(type)).toBe('log-only')
  })
})

describe('affectedUserIds', () => {
  it('takes app_user_id when it is ours', () => {
    expect(affectedUserIds(event({}))).toEqual({
      kind: 'users',
      userIds: ['user_01SYNTHETIC'],
    })
  })

  it('falls back to exactly one ours-shaped alias', () => {
    const e = event({
      app_user_id: '$RCAnonymousID:abc123',
      aliases: ['$RCAnonymousID:abc123', 'user_01SYNTHETIC'],
    })
    expect(affectedUserIds(e)).toEqual({ kind: 'users', userIds: ['user_01SYNTHETIC'] })
  })

  it('orphans an event with no resolvable id', () => {
    const e = event({ app_user_id: '$RCAnonymousID:abc123', aliases: ['$RCAnonymousID:abc123'] })
    expect(affectedUserIds(e).kind).toBe('orphaned')
  })

  it('orphans on AMBIGUOUS aliases rather than guessing between two of our accounts', () => {
    const e = event({
      app_user_id: '$RCAnonymousID:abc123',
      aliases: ['user_01FIRST', 'user_01SECOND'],
    })
    expect(affectedUserIds(e).kind).toBe('orphaned')
  })

  it('TRANSFER: unions both sides, ours-shaped only, deduplicated', () => {
    const e = event({
      type: 'TRANSFER',
      app_user_id: undefined,
      transferred_from: ['user_01LOSER', '$RCAnonymousID:old'],
      transferred_to: ['user_01WINNER', 'user_01LOSER'],
    })
    expect(affectedUserIds(e)).toEqual({
      kind: 'users',
      userIds: ['user_01LOSER', 'user_01WINNER'],
    })
  })

  it('TRANSFER with no resolvable ids on either side orphans', () => {
    const e = event({
      type: 'TRANSFER',
      app_user_id: undefined,
      transferred_from: ['$RCAnonymousID:a'],
      transferred_to: ['$RCAnonymousID:b'],
    })
    expect(affectedUserIds(e).kind).toBe('orphaned')
  })
})
