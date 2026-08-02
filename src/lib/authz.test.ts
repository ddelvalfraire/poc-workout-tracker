import { describe, it, expect } from 'vitest'
import { can, type AuthzAction, type ProgramResource } from './authz'

/**
 * The full truth table for the v1 authorization seam. Every row names the
 * situation it encodes; together they pin the semantics tiers 2–3 will
 * re-express through CASL — a regression here is an access-control change.
 */

const OWNER = 'user_owner'
const VISITOR = 'user_visitor'

const LIVE = { revokedAt: null }
const REVOKED = { revokedAt: new Date('2026-08-01T00:00:00Z') }

function resource(over: Partial<ProgramResource> = {}): ProgramResource {
  return { userId: OWNER, visibility: 'link', status: 'active', share: LIVE, ...over }
}

describe('can — view', () => {
  it('grants the owner regardless of visibility, status, or share', () => {
    // Arrange / Act / Assert — the owner reads their own program always
    expect(can({ userId: OWNER }, 'view', resource({ visibility: 'private', share: null }))).toBe(
      true,
    )
    expect(can({ userId: OWNER }, 'view', resource({ status: 'proposed', share: null }))).toBe(true)
    expect(can({ userId: OWNER }, 'view', resource({ share: REVOKED }))).toBe(true)
  })

  it.each([
    ['anonymous', null],
    ['signed-in non-owner', VISITOR],
  ])('grants a %s holding a live share on a link program', (_label, userId) => {
    expect(can({ userId }, 'view', resource({ visibility: 'link' }))).toBe(true)
  })

  it.each([
    ['anonymous', null],
    ['signed-in non-owner', VISITOR],
  ])('grants a %s holding a live share on a public program', (_label, userId) => {
    expect(can({ userId }, 'view', resource({ visibility: 'public' }))).toBe(true)
  })

  it('denies non-owners on a private program even with a live share row', () => {
    expect(can({ userId: null }, 'view', resource({ visibility: 'private' }))).toBe(false)
    expect(can({ userId: VISITOR }, 'view', resource({ visibility: 'private' }))).toBe(false)
  })

  it('denies non-owners on a proposed program (links never resolve)', () => {
    expect(can({ userId: null }, 'view', resource({ status: 'proposed' }))).toBe(false)
    expect(can({ userId: VISITOR }, 'view', resource({ status: 'proposed' }))).toBe(false)
  })

  it('denies non-owners when the share is revoked or absent', () => {
    expect(can({ userId: null }, 'view', resource({ share: REVOKED }))).toBe(false)
    expect(can({ userId: VISITOR }, 'view', resource({ share: REVOKED }))).toBe(false)
    expect(can({ userId: null }, 'view', resource({ share: null }))).toBe(false)
    expect(can({ userId: VISITOR }, 'view', resource({ share: undefined }))).toBe(false)
  })
})

describe('can — adopt', () => {
  it('grants a signed-in non-owner with a live share (link and public)', () => {
    expect(can({ userId: VISITOR }, 'adopt', resource({ visibility: 'link' }))).toBe(true)
    expect(can({ userId: VISITOR }, 'adopt', resource({ visibility: 'public' }))).toBe(true)
  })

  it('denies anonymous actors (adoption needs an account to clone into)', () => {
    expect(can({ userId: null }, 'adopt', resource())).toBe(false)
  })

  it('denies the owner (no self-adopt)', () => {
    expect(can({ userId: OWNER }, 'adopt', resource())).toBe(false)
  })

  it('denies on private, proposed, revoked, and missing share', () => {
    expect(can({ userId: VISITOR }, 'adopt', resource({ visibility: 'private' }))).toBe(false)
    expect(can({ userId: VISITOR }, 'adopt', resource({ status: 'proposed' }))).toBe(false)
    expect(can({ userId: VISITOR }, 'adopt', resource({ share: REVOKED }))).toBe(false)
    expect(can({ userId: VISITOR }, 'adopt', resource({ share: null }))).toBe(false)
  })
})

describe('can — manage', () => {
  it('grants the owner on any non-proposed status, any visibility, no share needed', () => {
    for (const status of ['draft', 'active', 'archived']) {
      expect(
        can({ userId: OWNER }, 'manage', resource({ status, visibility: 'private', share: null })),
      ).toBe(true)
    }
  })

  it('denies the owner on a proposal (a pending proposal is never sharable)', () => {
    expect(can({ userId: OWNER }, 'manage', resource({ status: 'proposed' }))).toBe(false)
  })

  it('denies anonymous and non-owner actors even with a live share', () => {
    expect(can({ userId: null }, 'manage', resource())).toBe(false)
    expect(can({ userId: VISITOR }, 'manage', resource())).toBe(false)
  })
})

describe('can — exhaustive matrix sanity', () => {
  // The compressed truth table: every (actor, action, situation) combination,
  // asserting the ONLY true cells are the ones the sections above spell out.
  const actors = [
    ['anonymous', null],
    ['owner', OWNER],
    ['visitor', VISITOR],
  ] as const
  const actions: AuthzAction[] = ['view', 'adopt', 'manage']
  const situations: [string, ProgramResource][] = [
    ['private-no-share', resource({ visibility: 'private', share: null })],
    ['link-live', resource()],
    ['public-live', resource({ visibility: 'public' })],
    ['link-revoked', resource({ share: REVOKED })],
    ['proposed-live', resource({ status: 'proposed' })],
  ]

  it('matches the expected grant set exactly', () => {
    const granted: string[] = []
    for (const [actorLabel, userId] of actors) {
      for (const action of actions) {
        for (const [situationLabel, res] of situations) {
          if (can({ userId }, action, res)) {
            granted.push(`${actorLabel}:${action}:${situationLabel}`)
          }
        }
      }
    }
    expect(granted.sort()).toEqual(
      [
        // Owner: view everything, manage everything non-proposed, adopt nothing.
        'owner:view:private-no-share',
        'owner:view:link-live',
        'owner:view:public-live',
        'owner:view:link-revoked',
        'owner:view:proposed-live',
        'owner:manage:private-no-share',
        'owner:manage:link-live',
        'owner:manage:public-live',
        'owner:manage:link-revoked',
        // Anonymous: view via live shares only.
        'anonymous:view:link-live',
        'anonymous:view:public-live',
        // Visitor: view + adopt via live shares only.
        'visitor:view:link-live',
        'visitor:view:public-live',
        'visitor:adopt:link-live',
        'visitor:adopt:public-live',
      ].sort(),
    )
  })
})
