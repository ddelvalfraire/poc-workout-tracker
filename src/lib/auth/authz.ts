import {
  AbilityBuilder,
  createMongoAbility,
  subject,
  type ForcedSubject,
  type MongoAbility,
  type MongoQuery,
} from '@casl/ability'
import type { ProgramVisibility } from '../programs/program-input'
import { TEMPLATE_OWNER_USER_ID } from '../templates/template-owner'

/**
 * Sharing/visibility authorization — the ONE place a cross-account access
 * decision is made. The db layer and routes CALL `can()` rather than inlining
 * checks; ownership-scoped SQL stays underneath as defense-in-depth, but the
 * DECISION lives here.
 *
 * CASL from day one (the graduation happened AT tier 1, per "Let's bring
 * casl"): the internals are a CASL MongoAbility built per actor and answered
 * through `ability.can`. The exported vocabulary — `can(actor, action,
 * resource)` over plain-object resources — is unchanged, so callers never see
 * CASL. Tiers 2–3 (crews, roles, human coaches) now land as NEW CASL RULES in
 * this one module: a crew-scoped share becomes another `allow(...)` line with
 * its own conditions, not a rearchitecture.
 *
 * v1 vocabulary:
 * - actor: `{ userId: string | null }` — null is an anonymous visitor.
 * - actions: 'view' (read the program content), 'adopt' (clone it into the
 *   actor's own account as a proposal), 'manage' (owner-only: visibility
 *   changes, share mint/revoke).
 * - resource: the program-shaped `{ userId, visibility, status }`, plus the
 *   share row (`{ revokedAt }`) on the paths that arrive via a token.
 */

export type AuthzAction = 'view' | 'adopt' | 'manage'

export interface AuthzActor {
  /** WorkOS user id; null = anonymous (signed-out) visitor. */
  userId: string | null
}

export interface ProgramResource {
  /** The program's owner (programs.userId). */
  userId: string
  visibility: ProgramVisibility
  /** programs.status — 'proposed' gates everything except the owner's view. */
  status: string
  /** The share row the actor arrived through; null/omitted = no token in
   *  hand. A revoked share (revokedAt set) grants nothing. */
  share?: { revokedAt: Date | null } | null
}

export interface WorkoutResource {
  /** The workout's owner (workouts.userId). */
  userId: string
  /** workouts.completedAt — null = a LIVE session, never viewable through a
   *  share (the summary is a record of a finished thing, not a spectator
   *  feed). Workouts have no visibility column: a live share row IS the
   *  outbound grant. */
  completedAt: Date | null
  /** The share row the actor arrived through; null/omitted = no token in
   *  hand. A revoked share (revokedAt set) grants nothing. */
  share?: { revokedAt: Date | null } | null
}

/** The CASL subject: the plain resource, tagged 'Program' via `subject()` at
 *  query time (plain objects carry no class for detectSubjectType). */
type ProgramSubject = ProgramResource & ForcedSubject<'Program'>

/** Same tagging idiom for workouts — the second subject in the one module. */
type WorkoutSubject = WorkoutResource & ForcedSubject<'Workout'>

type AppAbility = MongoAbility<
  [AuthzAction, 'Program' | ProgramSubject | 'Workout' | WorkoutSubject]
>

/**
 * A live-share read as CASL conditions: visibility must be outbound
 * (link|public), the program must not be a pending proposal (the forced
 * confirm gates artifacts INTO an account; visibility gates content OUT — a
 * proposal is neither), and the token's share row must exist un-revoked.
 * `share: { $exists, $ne: null }` is load-bearing: mongo `$eq null` alone
 * also matches an ABSENT field, and no token in hand must grant nothing.
 */
const LIVE_SHARE_CONDITIONS: MongoQuery = {
  visibility: { $in: ['link', 'public'] },
  status: { $ne: 'proposed' },
  share: { $exists: true, $ne: null },
  'share.revokedAt': { $eq: null },
}

/**
 * A live WORKOUT share as CASL conditions. No visibility clause — workouts
 * have no visibility column, so an un-revoked share row is itself the
 * outbound grant. `completedAt $ne null` is the workout analog of the
 * program's proposed-gate: a live session is never viewable through a token.
 * The `share $exists/$ne null` pair carries the same load as in
 * LIVE_SHARE_CONDITIONS — no token in hand must grant nothing.
 */
const LIVE_WORKOUT_SHARE_CONDITIONS: MongoQuery = {
  completedAt: { $ne: null },
  share: { $exists: true, $ne: null },
  'share.revokedAt': { $eq: null },
}

/** Builds the actor's ability — the full v1 rule set. Rules referencing the
 *  actor's own id exist only for signed-in actors, so an anonymous ability is
 *  exactly the live-share read floor. */
function abilityFor(actor: AuthzActor): AppAbility {
  const { can: allow, build } = new AbilityBuilder<AppAbility>(createMongoAbility)

  // Anyone a live share admits may read — the anonymous floor.
  allow('view', 'Program', LIVE_SHARE_CONDITIONS)
  allow('view', 'Workout', LIVE_WORKOUT_SHARE_CONDITIONS)

  if (actor.userId !== null) {
    // Owners always read their own programs (any status — the proposal page
    // IS a read)…
    allow('view', 'Program', { userId: actor.userId })
    // …and manage them, but never a proposal: a pending proposal can't be
    // made sharable (its only exits are adopt/decline).
    allow('manage', 'Program', { userId: actor.userId, status: { $ne: 'proposed' } })
    // Adopt: signed-in non-owners only — adopting your own program would
    // mint a proposal attributed to yourself — and re-validated against the
    // live share at CLONE time, not render time.
    allow('adopt', 'Program', {
      ...LIVE_SHARE_CONDITIONS,
      userId: { $ne: actor.userId },
    })
    // Template library: any signed-in user may read and adopt a PUBLIC
    // program owned by the system template account — no share token in the
    // loop (curated templates are first-party content, not user shares).
    // Keyed on the well-known owner id, so 'public' visibility on a USER's
    // program still requires a live share row to grant anything.
    const SYSTEM_TEMPLATE_CONDITIONS: MongoQuery = {
      userId: TEMPLATE_OWNER_USER_ID,
      visibility: 'public',
      status: { $ne: 'proposed' },
    }
    allow('view', 'Program', SYSTEM_TEMPLATE_CONDITIONS)
    allow('adopt', 'Program', SYSTEM_TEMPLATE_CONDITIONS)
    // Owners always read their own workouts (any state — the summary and the
    // logger are both reads)…
    allow('view', 'Workout', { userId: actor.userId })
    // …and manage sharing on the COMPLETED ones only: mint/revoke for a live
    // session is refused here, at the seam, so createWorkoutShare's
    // completed-only gate is a can() decision, not inline SQL. No workout
    // 'adopt' rule exists anywhere — there is no adopt flow, by design.
    allow('manage', 'Workout', { userId: actor.userId, completedAt: { $ne: null } })
  }

  // `anyAction` remapped off the default: CASL reserves 'manage' as its
  // "every action" wildcard, which would make the owner's manage rule grant
  // adopt (self-adopt) and anything else. Our 'manage' is a REAL action
  // (visibility changes, share mint/revoke), so the wildcard keyword is moved
  // to a token no rule ever uses.
  return build({ anyAction: '__all__' })
}

/** May `actor` perform `action` on `resource`? Pure — no I/O, no throw. The
 *  resource is spread before tagging so callers' objects are never mutated
 *  (`subject()` stamps its type marker on the instance it receives). The
 *  subject discriminates on `visibility` — a program-only field; workouts
 *  carry `completedAt` instead. */
export function can(
  actor: AuthzActor,
  action: AuthzAction,
  resource: ProgramResource | WorkoutResource,
): boolean {
  const tagged =
    'visibility' in resource
      ? subject('Program', { ...resource })
      : subject('Workout', { ...resource })
  return abilityFor(actor).can(action, tagged)
}
