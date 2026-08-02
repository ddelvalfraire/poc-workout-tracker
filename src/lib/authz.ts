import type { ProgramVisibility } from './program-input'

/**
 * Sharing/visibility authorization — the ONE place a cross-account access
 * decision is made. The db layer and routes CALL `can()` rather than inlining
 * checks; ownership-scoped SQL stays underneath as defense-in-depth, but the
 * DECISION lives here.
 *
 * CASL graduation intent: the signature is deliberately CASL's
 * `can(actor, action, subject)` shape so tiers 2–3 (crews, roles, human
 * coaches) can swap these hand-rolled internals for a CASL ability built from
 * the same vocabulary — callers never change. Until then the internals stay
 * a pure, exhaustively-tested truth table: no schema, no db, no imports
 * beyond the visibility type.
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
  /** Clerk user id; null = anonymous (signed-out) visitor. */
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

/** A live-share read: visibility must be outbound (link|public), the program
 *  must not be a pending proposal (the forced confirm gates artifacts INTO an
 *  account; visibility gates content OUT — a proposal is neither), and the
 *  token's share row must exist un-revoked. */
function hasLiveShareAccess(resource: ProgramResource): boolean {
  if (resource.visibility !== 'link' && resource.visibility !== 'public') return false
  if (resource.status === 'proposed') return false
  return resource.share != null && resource.share.revokedAt === null
}

/** May `actor` perform `action` on `resource`? Pure — no I/O, no throw. */
export function can(actor: AuthzActor, action: AuthzAction, resource: ProgramResource): boolean {
  const isOwner = actor.userId !== null && actor.userId === resource.userId
  switch (action) {
    case 'manage':
      // Owner-only, and never on a proposal: a pending proposal can't be made
      // sharable (its only exits are adopt/decline).
      return isOwner && resource.status !== 'proposed'
    case 'view':
      // Owners always read their own programs (any status — the proposal page
      // IS a read); everyone else needs a live share.
      return isOwner || hasLiveShareAccess(resource)
    case 'adopt':
      // Signed-in non-owners only — adopting your own program would mint a
      // proposal attributed to yourself — and re-validated against the live
      // share at CLONE time, not render time.
      return actor.userId !== null && !isOwner && hasLiveShareAccess(resource)
  }
}
