import { and, desc, eq, lt, or } from 'drizzle-orm'
import { db } from './index'
import { programEvents } from './schema'

/**
 * The program change log's only write and read paths. Events are appended by
 * the mutating db functions (program-patches.ts / programs.ts) INSIDE their
 * own transaction — never by tools or routes directly — so a logged event
 * implies the change committed. The log is read-only by construction: no
 * update or delete exists here (rows die with the program via FK cascade).
 */

/** WHO made a plan change. Derived at the boundary: server actions pass 'ui';
 *  the MCP layer distinguishes 'coach' (in-memory bridge) from 'mcp' (HTTP). */
export type ProgramEventActor = 'ui' | 'mcp' | 'coach'

/** Any handle that can run the insert — a transaction (the normal case, so
 *  the event commits or rolls back with its change) or the root `db` for the
 *  one non-transactional mutator (setProgramStatus). */
type EventWriter = Pick<typeof db, 'insert'>

export interface ProgramEventInput {
  programId: string
  userId: string
  actor: ProgramEventActor
  /** The patch/tool name, e.g. 'update_program_exercise'. */
  action: string
  /** One compact human line, e.g. 'Replace Incline DB Press → Larsen Press (Day 2)'. */
  summary: string
  /** Minimal before/after of the touched fields — never a whole-program snapshot. */
  payload?: unknown
}

/** Appends one event row. Must run on the mutation's own transaction handle. */
export async function recordProgramEvent(tx: EventWriter, event: ProgramEventInput): Promise<void> {
  await tx.insert(programEvents).values({
    programId: event.programId,
    userId: event.userId,
    actor: event.actor,
    action: event.action,
    summary: event.summary,
    payload: event.payload ?? null,
  })
}

export const PROGRAM_EVENTS_DEFAULT_LIMIT = 25
export const PROGRAM_EVENTS_MAX_LIMIT = 100

/**
 * A program's events, newest first. Ownership is enforced by the `userId`
 * filter on the event rows themselves (stamped at write time), so no join to
 * `programs` is needed — a caller can never read another user's log. `before`
 * is an exclusive cursor on `occurredAt` for paging older events; `limit` is
 * clamped to 1..100 (default 25).
 */
export function listProgramEvents(
  userId: string,
  programId: string,
  options: { limit?: number; before?: Date; beforeId?: string } = {},
) {
  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? PROGRAM_EVENTS_DEFAULT_LIMIT), 1),
    PROGRAM_EVENTS_MAX_LIMIT,
  )
  const conditions = [eq(programEvents.userId, userId), eq(programEvents.programId, programId)]
  if (options.before !== undefined) {
    // Compound cursor matching the (occurredAt, id) sort: a timestamp-only
    // cursor would skip unreturned rows TIED on the last page's timestamp.
    // `beforeId` is the last row's id from the prior page; without it the
    // timestamp-only form stands (first page, or a caller with only a date).
    conditions.push(
      options.beforeId !== undefined
        ? or(
            lt(programEvents.occurredAt, options.before),
            and(
              eq(programEvents.occurredAt, options.before),
              lt(programEvents.id, options.beforeId),
            ),
          )!
        : lt(programEvents.occurredAt, options.before),
    )
  }
  return db
    .select()
    .from(programEvents)
    .where(and(...conditions))
    // id as the tiebreak so same-timestamp rows page deterministically.
    .orderBy(desc(programEvents.occurredAt), desc(programEvents.id))
    .limit(limit)
}

/** One row as `listProgramEvents` returns it. */
export type ProgramEventRow = Awaited<ReturnType<typeof listProgramEvents>>[number]
