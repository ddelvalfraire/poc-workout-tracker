import { and, asc, eq, ne } from 'drizzle-orm'
import { can } from '@/lib/authz'
import { TEMPLATE_OWNER_USER_ID } from '@/lib/template-owner'
import { db } from './index'
import { programs } from './schema'
import { recordProgramEvent } from './program-events'
import { copyProgramTree, getProgramDetail, type ProgramDetail } from './programs'

/**
 * Template-library data access — the read-only window onto the system
 * account's public programs plus the one write that matters: adopting a
 * template as your own copy. Templates are ordinary `programs` rows owned by
 * `TEMPLATE_OWNER_USER_ID` with `visibility: 'public'` (see
 * lib/template-owner.ts); rows are authored only by the manual seed script.
 * Every gate DELEGATES its decision to `can()` (lib/authz.ts — the one
 * authorization seam, which grants shareless view/adopt on public
 * system-owned rows); the owner-scoped SQL here is defense-in-depth, not the
 * decision. Like db/programs.ts, routes and actions must go through these
 * helpers, never the tables directly.
 */

/** The browse list: every public system template with its day names (the
 *  shelf leads with days/week), alphabetical. An unseeded environment simply
 *  returns [] — the browse section renders nothing. */
export function listTemplates() {
  return db.query.programs.findMany({
    where: and(
      eq(programs.userId, TEMPLATE_OWNER_USER_ID),
      eq(programs.visibility, 'public'),
      ne(programs.status, 'proposed'),
    ),
    columns: {
      id: true,
      name: true,
      description: true,
      icon: true,
      mesocycleWeeks: true,
      deloadWeek: true,
    },
    with: {
      days: { columns: { name: true, position: true }, orderBy: (d) => [asc(d.position)] },
    },
    orderBy: asc(programs.name),
  })
}

/** One row as `listTemplates` returns it. */
export type TemplateListRow = Awaited<ReturnType<typeof listTemplates>>[number]

/**
 * The detail read behind /programs/templates/[id]: the system account's full
 * program tree, but only when the viewer's `can()` view gate passes (public +
 * system-owned + not proposed). Every failure — unknown id, non-public,
 * proposed — collapses to the same null (the constant-shape 404 idiom).
 */
export async function getTemplate(
  viewerUserId: string,
  templateId: string,
): Promise<ProgramDetail | null> {
  const detail = await getProgramDetail(TEMPLATE_OWNER_USER_ID, templateId)
  if (!detail) return null
  const resource = { userId: detail.userId, visibility: detail.visibility, status: detail.status }
  if (!can({ userId: viewerUserId }, 'view', resource)) return null
  return detail
}

/**
 * The library pull: copies a public system template into the USER's account —
 * adoptShared minus the share token, with the library's own gate (the source
 * row must be public AND system-owned, re-validated via can() at clone time).
 * The copy lands as a DRAFT, not a proposal: the user asked for it, so no
 * forced confirm — the same rationale as the wger import path. `authorActor`
 * is the system owner id (the open value space doing its job, mirroring
 * adoptShared's sharer attribution) and visibility resets to the column
 * default ('private') — a copy never inherits the source's reach. Every
 * failure is the constant-shape null.
 */
export async function adoptTemplate(
  userId: string,
  templateId: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ userId: programs.userId, visibility: programs.visibility, status: programs.status })
    .from(programs)
    // Owner-scoped — defense-in-depth under can(); a user's row with this id
    // can never be selected.
    .where(and(eq(programs.id, templateId), eq(programs.userId, TEMPLATE_OWNER_USER_ID)))
  if (!row) return null
  if (!can({ userId }, 'adopt', row)) return null
  // The source is read under the SYSTEM owner's id — the one cross-account
  // read this module performs, and only after the adopt gate passed.
  const source = await getProgramDetail(TEMPLATE_OWNER_USER_ID, templateId)
  if (!source) return null
  return db.transaction(async (tx) => {
    const [program] = await tx
      .insert(programs)
      .values({
        userId, // the adopter's account — ownership root of the copy
        name: source.name,
        status: 'draft', // user-initiated pull: no forced confirm
        authorActor: TEMPLATE_OWNER_USER_ID,
        mesocycleWeeks: source.mesocycleWeeks,
        deloadWeek: source.deloadWeek,
        autoregulation: source.autoregulation,
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
        // dietPhase/dietPhaseSetAt omitted → null: a phase is a fact about
        // the lifter's current diet, never a property a template carries.
      })
      .returning({ id: programs.id })
    await copyProgramTree(tx, source.days, program.id)
    // Logged on the COPY (the adopter's timeline opens with where it came
    // from); actor 'ui' — the template page's server action is the only
    // caller.
    await recordProgramEvent(tx, {
      programId: program.id,
      userId,
      actor: 'ui',
      action: 'adopt_template',
      summary: `Added from the template library ("${source.name}")`,
      payload: { sourceProgramId: templateId },
    })
    return { id: program.id }
  })
}
