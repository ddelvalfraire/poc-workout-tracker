import { randomBytes } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { ProgramVisibility } from '@/lib/program-input'
import { can } from '@/lib/authz'
import { db } from './index'
import { hasFeature } from './entitlements'
import { programs, programShares } from './schema'
import {
  NotSharableProgramError,
  OwnSharedProgramError,
  ProposedProgramError,
} from './program-errors'
import { recordProgramEvent } from './program-events'
import { copyProgramTree, getProgramDetail, type ProgramDetail } from './programs'

/**
 * Sharing data access — visibility flips, share-link lifecycle, and the two
 * cross-account reads (resolve + adopt). Every gate DELEGATES its decision to
 * `can()` (lib/authz.ts — the one authorization seam); the ownership-scoped
 * SQL here is defense-in-depth, not the decision. Like db/programs.ts, routes
 * and actions must go through these helpers, never the tables directly.
 */

/** 24 bytes of crypto randomness → 32 base64url chars (192-bit entropy, above
 *  the PRD's 128-bit floor). The token IS the capability. */
export function mintShareToken(): string {
  return randomBytes(24).toString('base64url')
}

/** The authz-relevant slice of one owned program, or null when the (userId,
 *  programId) pair doesn't match a row — the constant not-found shape. */
async function readOwnedProgram(
  userId: string,
  programId: string,
): Promise<{ userId: string; visibility: ProgramVisibility; status: string } | null> {
  const [row] = await db
    .select({ userId: programs.userId, visibility: programs.visibility, status: programs.status })
    .from(programs)
    .where(and(eq(programs.id, programId), eq(programs.userId, userId)))
  return row ?? null
}

/**
 * Flips a program's visibility ('private' | 'link' | 'public'). Manage-gated
 * via can(): owner-only, and a 'proposed' row is refused (ProposedProgramError
 * — a pending proposal can never be made sharable). Null = not owned/missing.
 * The flip is a change-log fact ('set_program_visibility'); a same-value
 * no-op writes nothing.
 */
export async function setProgramVisibility(
  userId: string,
  programId: string,
  visibility: ProgramVisibility,
): Promise<{ id: string } | null> {
  const row = await readOwnedProgram(userId, programId)
  if (!row) return null
  if (!can({ userId }, 'manage', row)) throw new ProposedProgramError(programId)
  if (row.visibility === visibility) return { id: programId }
  return db.transaction(async (tx) => {
    await tx
      .update(programs)
      .set({ visibility, updatedAt: new Date() })
      // Re-scoped by ownership inside the tx — defense-in-depth under can().
      .where(and(eq(programs.id, programId), eq(programs.userId, userId)))
    // Owner-only surface (the sharing UI's server action), hence 'ui' — the
    // same hardcoding rationale as adoptProgram.
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor: 'ui',
      action: 'set_program_visibility',
      summary: `Visibility → ${visibility}`,
      payload: { before: { visibility: row.visibility }, after: { visibility } },
    })
    return { id: programId }
  })
}

/**
 * Mints a share link for a link|public program — or returns the existing live
 * one (idempotent: "new token only on explicit re-create", i.e. revoke first).
 * Manage-gated via can(); a 'private' program refuses with
 * NotSharableProgramError (flip visibility first). Null = not owned/missing.
 */
export async function createShare(
  userId: string,
  programId: string,
): Promise<{ id: string; token: string } | null> {
  const row = await readOwnedProgram(userId, programId)
  if (!row) return null
  if (!can({ userId }, 'manage', row)) throw new ProposedProgramError(programId)
  if (row.visibility === 'private') throw new NotSharableProgramError(programId)
  const [live] = await db
    .select({ id: programShares.id, token: programShares.token })
    .from(programShares)
    .where(and(eq(programShares.programId, programId), isNull(programShares.revokedAt)))
    .orderBy(desc(programShares.createdAt))
    .limit(1)
  if (live) return live
  const [created] = await db
    .insert(programShares)
    .values({ programId, token: mintShareToken() })
    .returning({ id: programShares.id, token: programShares.token })
  return created
}

/**
 * Revokes every live share for an owned program (sets revokedAt — the row
 * stays as a fact; a replacement is a NEW row via createShare). Manage-gated
 * via can(). Null = not owned/missing; `revoked` counts the links killed.
 */
export async function revokeShare(
  userId: string,
  programId: string,
): Promise<{ revoked: number } | null> {
  const row = await readOwnedProgram(userId, programId)
  if (!row) return null
  if (!can({ userId }, 'manage', row)) throw new ProposedProgramError(programId)
  const rows = await db
    .update(programShares)
    .set({ revokedAt: new Date() })
    .where(and(eq(programShares.programId, programId), isNull(programShares.revokedAt)))
    .returning({ id: programShares.id })
  return { revoked: rows.length }
}

/** The owner's live share for the sharing UI (copy-link needs the token);
 *  ownership-scoped through the programs join. Null = none live / not owned. */
export async function getActiveShare(
  userId: string,
  programId: string,
): Promise<{ token: string } | null> {
  const [row] = await db
    .select({ token: programShares.token })
    .from(programShares)
    .innerJoin(programs, eq(programs.id, programShares.programId))
    .where(
      and(
        eq(programShares.programId, programId),
        eq(programs.userId, userId),
        isNull(programShares.revokedAt),
      ),
    )
    .orderBy(desc(programShares.createdAt))
    .limit(1)
  return row ?? null
}

/** What /p/[token] renders: program CONTENT plus the owner id for the
 *  attribution line and the own-program check — nothing else crosses. */
export interface SharedProgramView {
  ownerUserId: string
  program: ProgramDetail
}

/** One share row joined to its program's authz slice, by token. */
async function readShareByToken(token: string) {
  const [row] = await db
    .select({
      programId: programShares.programId,
      revokedAt: programShares.revokedAt,
      ownerUserId: programs.userId,
      visibility: programs.visibility,
      status: programs.status,
    })
    .from(programShares)
    .innerJoin(programs, eq(programs.id, programShares.programId))
    .where(eq(programShares.token, token))
  return row ?? null
}

/**
 * The public read behind /p/[token]: live share → program passing the
 * anonymous view gate → program CONTENT only. Every failure — unknown token,
 * revoked, private, proposed — collapses to the same null (the constant-shape
 * 404 idiom: never acknowledge which gate refused).
 *
 * Content-only enforcement: the read is `getProgramDetail` — the program row
 * and its day/exercise/set tree, nothing else. The owner's history, stats,
 * body data, and change log live behind OTHER reads that are never joined
 * here, and no caller of this function may add them.
 */
export async function resolveShare(token: string): Promise<SharedProgramView | null> {
  const row = await readShareByToken(token)
  if (!row) return null
  const resource = {
    userId: row.ownerUserId,
    visibility: row.visibility,
    status: row.status,
    share: { revokedAt: row.revokedAt },
  }
  // The anonymous-viewer gate is the floor: anyone a token admits sees the
  // same page, so resolution never needs to know who is asking.
  if (!can({ userId: null }, 'view', resource)) return null
  const program = await getProgramDetail(row.ownerUserId, row.programId)
  if (!program) return null
  return { ownerUserId: row.ownerUserId, program }
}

/**
 * Cross-account adopt: clones a shared program into the VISITOR's account as
 * a 'proposed' row (the existing Adopt/Decline banner is the forced confirm)
 * with `authorActor` = the sharer's userId (the open value space doing its
 * job) and visibility reset to 'private' (column default — a copy never
 * inherits the source's reach). The share is re-validated via can() HERE, at
 * clone time — a link revoked after render adopts nothing. Adopting your own
 * program refuses with OwnSharedProgramError; every other failure is the
 * constant-shape null.
 */
export async function adoptShared(userId: string, token: string): Promise<{ id: string } | null> {
  const row = await readShareByToken(token)
  if (!row) return null
  if (row.ownerUserId === userId) throw new OwnSharedProgramError()
  const resource = {
    userId: row.ownerUserId,
    visibility: row.visibility,
    status: row.status,
    share: { revokedAt: row.revokedAt },
  }
  if (!can({ userId }, 'adopt', resource)) return null
  // The source is read under the OWNER's id — the one cross-account read this
  // module performs, and only after the adopt gate passed.
  const source = await getProgramDetail(row.ownerUserId, row.programId)
  if (!source) return null
  // The paid autoreg capability does not travel with the clone unless the
  // ADOPTER is entitled — the same clamp as adoptTemplate (db/templates.ts),
  // this function's acquisition-shaped sibling; the two must stay in step.
  // The sharer's flag passed THEIR gate, not the visitor's, so copying it
  // verbatim handed Free users what saveProgram's requireFeature refuses.
  // Clamping (not refusing) is deliberate — the visitor asked for the
  // program, not the paid engine, and a shared link must stay adoptable on
  // the free tier (fail-to-Free). && short-circuits: an authored-OFF source
  // performs no entitlement read, and an entitled adopter keeps the sharer's
  // authored value either way.
  const autoregulation = source.autoregulation && (await hasFeature(userId, 'autoreg'))
  return db.transaction(async (tx) => {
    const [program] = await tx
      .insert(programs)
      .values({
        userId, // the visitor's account — ownership root of the copy
        name: source.name,
        status: 'proposed', // the forced confirm gates it into the account
        authorActor: row.ownerUserId,
        mesocycleWeeks: source.mesocycleWeeks,
        deloadWeek: source.deloadWeek,
        autoregulation,
        autoregStallPolicy: source.autoregStallPolicy,
        deloadPolicy: source.deloadPolicy,
        planSync: source.planSync,
        checkInEveryDays: source.checkInEveryDays,
        notes: source.notes,
        description: source.description,
        icon: source.icon,
        heroImageUrl: source.heroImageUrl,
        sourceUrl: source.sourceUrl,
        // visibility omitted → the 'private' column default: the reset.
        // dietPhase/dietPhaseSetAt omitted → null: the sharer's diet phase is
        // about THEIR body, never something an adopted copy inherits.
      })
      .returning({ id: programs.id })
    await copyProgramTree(tx, source.days, program.id)
    // Logged on the CLONE (the visitor's timeline opens with where it came
    // from); actor 'ui' — the public page's server action is the only caller.
    await recordProgramEvent(tx, {
      programId: program.id,
      userId,
      actor: 'ui',
      action: 'adopt_shared_program',
      summary: 'Added from a shared link',
      payload: { sourceProgramId: row.programId, sharedBy: row.ownerUserId },
    })
    return { id: program.id }
  })
}
