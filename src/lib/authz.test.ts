import { describe, it, expect } from 'vitest'
import { can, type AuthzAction, type ProgramResource, type WorkoutResource } from './authz'
import { TEMPLATE_OWNER_USER_ID } from './templates/template-owner'

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

const COMPLETED = new Date('2026-08-01T12:00:00Z')

function workout(over: Partial<WorkoutResource> = {}): WorkoutResource {
  return { userId: OWNER, completedAt: COMPLETED, share: LIVE, ...over }
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

describe('can — system templates (the template library rules)', () => {
  /** A curated template as db/templates.ts reads it: system-owned, public,
   *  no share row anywhere in the loop. */
  function template(over: Partial<ProgramResource> = {}): ProgramResource {
    return { userId: TEMPLATE_OWNER_USER_ID, visibility: 'public', status: 'draft', ...over }
  }

  it('grants any signed-in user view + adopt on a public system template, shareless', () => {
    expect(can({ userId: VISITOR }, 'view', template())).toBe(true)
    expect(can({ userId: VISITOR }, 'adopt', template())).toBe(true)
  })

  it('denies anonymous actors (the library lives behind sign-in)', () => {
    expect(can({ userId: null }, 'view', template())).toBe(false)
    expect(can({ userId: null }, 'adopt', template())).toBe(false)
  })

  it('denies non-public system rows (a private/link system row is not in the library)', () => {
    for (const visibility of ['private', 'link'] as const) {
      expect(can({ userId: VISITOR }, 'view', template({ visibility }))).toBe(false)
      expect(can({ userId: VISITOR }, 'adopt', template({ visibility }))).toBe(false)
    }
  })

  it('denies a proposed system row (never publishable mid-proposal)', () => {
    expect(can({ userId: VISITOR }, 'view', template({ status: 'proposed' }))).toBe(false)
    expect(can({ userId: VISITOR }, 'adopt', template({ status: 'proposed' }))).toBe(false)
  })

  it("denies a USER's public program without a live share — the rule keys on the system owner", () => {
    // 'public' visibility on a user's row still needs a live share row to
    // grant anything; only the well-known system owner is shareless.
    expect(can({ userId: VISITOR }, 'adopt', resource({ visibility: 'public', share: null }))).toBe(
      false,
    )
    expect(can({ userId: VISITOR }, 'view', resource({ visibility: 'public', share: null }))).toBe(
      false,
    )
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

describe('can — Workout view', () => {
  it('grants the owner regardless of completion or share state', () => {
    // Arrange / Act / Assert — the owner reads their own workout always
    expect(can({ userId: OWNER }, 'view', workout({ share: null }))).toBe(true)
    expect(can({ userId: OWNER }, 'view', workout({ completedAt: null, share: null }))).toBe(true)
    expect(can({ userId: OWNER }, 'view', workout({ share: REVOKED }))).toBe(true)
  })

  it.each([
    ['anonymous', null],
    ['signed-in non-owner', VISITOR],
  ])('grants a %s holding a live share on a completed workout', (_label, userId) => {
    expect(can({ userId }, 'view', workout())).toBe(true)
  })

  it('denies non-owners on a LIVE session even with a live share row', () => {
    // A share can only exist for a completed workout, but the seam must hold
    // on its own: completedAt null grants nothing outbound.
    expect(can({ userId: null }, 'view', workout({ completedAt: null }))).toBe(false)
    expect(can({ userId: VISITOR }, 'view', workout({ completedAt: null }))).toBe(false)
  })

  it('denies non-owners when the share is revoked or absent', () => {
    expect(can({ userId: null }, 'view', workout({ share: REVOKED }))).toBe(false)
    expect(can({ userId: VISITOR }, 'view', workout({ share: REVOKED }))).toBe(false)
    expect(can({ userId: null }, 'view', workout({ share: null }))).toBe(false)
    expect(can({ userId: VISITOR }, 'view', workout({ share: undefined }))).toBe(false)
  })
})

describe('can — Workout manage', () => {
  it('grants the owner on a completed workout, no share needed', () => {
    expect(can({ userId: OWNER }, 'manage', workout({ share: null }))).toBe(true)
    expect(can({ userId: OWNER }, 'manage', workout({ share: REVOKED }))).toBe(true)
  })

  it('denies the owner on a live session (unfinished workouts are never sharable)', () => {
    expect(can({ userId: OWNER }, 'manage', workout({ completedAt: null }))).toBe(false)
  })

  it('denies anonymous and non-owner actors even with a live share', () => {
    expect(can({ userId: null }, 'manage', workout())).toBe(false)
    expect(can({ userId: VISITOR }, 'manage', workout())).toBe(false)
  })
})

describe('can — Workout adopt (no adopt flow exists)', () => {
  it('denies every actor — there is no rule to grant it', () => {
    expect(can({ userId: OWNER }, 'adopt', workout())).toBe(false)
    expect(can({ userId: VISITOR }, 'adopt', workout())).toBe(false)
    expect(can({ userId: null }, 'adopt', workout())).toBe(false)
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

  // The Workout half of the table — same compression, its own situations
  // (no visibility axis; completion replaces the proposed-gate).
  const workoutSituations: [string, WorkoutResource][] = [
    ['completed-no-share', workout({ share: null })],
    ['completed-live', workout()],
    ['completed-revoked', workout({ share: REVOKED })],
    ['live-session-live-share', workout({ completedAt: null })],
  ]

  it('matches the expected Workout grant set exactly', () => {
    const granted: string[] = []
    for (const [actorLabel, userId] of actors) {
      for (const action of actions) {
        for (const [situationLabel, res] of workoutSituations) {
          if (can({ userId }, action, res)) {
            granted.push(`${actorLabel}:${action}:${situationLabel}`)
          }
        }
      }
    }
    expect(granted.sort()).toEqual(
      [
        // Owner: view everything, manage completed only, adopt nothing.
        'owner:view:completed-no-share',
        'owner:view:completed-live',
        'owner:view:completed-revoked',
        'owner:view:live-session-live-share',
        'owner:manage:completed-no-share',
        'owner:manage:completed-live',
        'owner:manage:completed-revoked',
        // Non-owners: view via a live share on a COMPLETED workout, only.
        'anonymous:view:completed-live',
        'visitor:view:completed-live',
      ].sort(),
    )
  })
})
