import { and, desc, eq, inArray, lt, or } from 'drizzle-orm'
import { db } from './index'
import { workoutEvents } from './schema'

/**
 * The session change log's only write and read paths — the workout twin of
 * program-events.ts. Events are appended by the mutating db functions
 * (workouts.ts) INSIDE their own transaction, never by tools or routes
 * directly, so a logged event implies the change committed. The log is
 * read-only by construction: no update or delete exists here (rows die with
 * the workout via FK cascade).
 */

/**
 * WHAT the write meant, lifted from clinical documentation practice. It is
 * DECLARED by the calling code path and never derived here — see the schema
 * comment for why `workouts.completedAt` cannot discriminate.
 */
export type WorkoutEventKind = 'original' | 'late_entry' | 'amendment' | 'system'

/** WHO made the change. Same boundary derivation as ProgramEventActor: server
 *  actions pass 'ui', the MCP layer separates 'coach' (in-memory bridge) from
 *  'mcp' (HTTP), and 'system' marks the app's own writes. */
export type WorkoutEventActor = 'ui' | 'mcp' | 'coach' | 'system'

/** What a caller declares about ITS OWN intent. Every mutating workout write
 *  takes one — an unlogged write path should not be expressible. */
export interface WorkoutChangeContext {
  actor: WorkoutEventActor
  kind: WorkoutEventKind
  /**
   * The kind to use when the SUBJECT HELD NO LOGGED VALUE before this write —
   * a first fill of a blank prescribed set is that set's own original record,
   * not a correction of one. Omitted → `kind` stands for both cases.
   *
   * This is still a DECLARATION, not a derivation: the caller supplies both
   * words and the write path only picks which of the caller's two sentences is
   * true, from the before-image it already reads for the diff — never from a
   * clock. It exists for `instantiate_program_day` + the MCP patch tools, the
   * documented way to live-log a program day: every set starts blank, so a
   * tool that could only say 'amendment' would produce a session whose log is
   * all corrections and no record.
   */
  blankSubjectKind?: WorkoutEventKind
}

/** Any handle that can run the insert — normally a transaction, so the event
 *  commits or rolls back with the change it describes. */
type EventWriter = Pick<typeof db, 'insert'>

export interface WorkoutEventInput {
  workoutId: string
  userId: string
  kind: WorkoutEventKind
  actor: WorkoutEventActor
  /** The mutation name, e.g. 'update_set'. */
  action: string
  /** One compact human line, e.g. 'Set 3 of Squat — weight 100 → 102.5'. */
  summary: string
  /** Columns this ONE intent touched. Empty for a creation or a removal. */
  changed?: readonly string[]
  /** Subject snapshot before the change — null for a creation. */
  before?: unknown
  /** Subject snapshot after the change — null for a removal. */
  after?: unknown
}

function eventValues(event: WorkoutEventInput) {
  return {
    workoutId: event.workoutId,
    userId: event.userId,
    kind: event.kind,
    actor: event.actor,
    action: event.action,
    summary: event.summary,
    changed: [...(event.changed ?? [])],
    before: event.before ?? null,
    after: event.after ?? null,
  }
}

/** Appends one event row. Must run on the mutation's own transaction handle. */
export async function recordWorkoutEvent(tx: EventWriter, event: WorkoutEventInput): Promise<void> {
  await tx.insert(workoutEvents).values(eventValues(event))
}

/** Appends several rows in ONE insert. updateWorkout replaces the whole tree,
 *  so a single call can legitimately carry several intents (set 2 corrected,
 *  set 5 added) — batching keeps that one round trip. Empty input writes
 *  nothing: an edit that changed nothing must not manufacture history. */
export async function recordWorkoutEvents(
  tx: EventWriter,
  events: readonly WorkoutEventInput[],
): Promise<void> {
  if (events.length === 0) return
  await tx.insert(workoutEvents).values(events.map(eventValues))
}

export const WORKOUT_EVENTS_DEFAULT_LIMIT = 25
export const WORKOUT_EVENTS_MAX_LIMIT = 100

/** The kinds that CONTRADICT what was recorded — the surface for a reader
 *  asking "what was changed after the fact?". Exported so that filter is one
 *  named decision rather than a literal sprinkled through callers. */
export const AMENDMENT_KINDS: readonly WorkoutEventKind[] = ['amendment']

/**
 * A workout's events, newest first. Ownership is enforced by the `userId`
 * filter on the event rows themselves (stamped at write time), so no join to
 * `workouts` is needed — a caller can never read another user's log.
 *
 * `kinds` narrows the stream: pass `AMENDMENT_KINDS` for the corrections-only
 * view, omit it for the full record (creation, late entries and system writes
 * included). The default is deliberately the FULL stream — a reader that asks
 * for everything gets everything; narrowing is the caller's declared choice,
 * exactly like `kind` itself.
 *
 * `before` is an exclusive cursor on `occurredAt` for paging older events,
 * compounded with `beforeId` so same-timestamp ties page losslessly; `limit`
 * is clamped to 1..100 (default 25).
 */
export function listWorkoutEvents(
  userId: string,
  workoutId: string,
  options: {
    limit?: number
    before?: Date
    beforeId?: string
    kinds?: readonly WorkoutEventKind[]
  } = {},
) {
  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? WORKOUT_EVENTS_DEFAULT_LIMIT), 1),
    WORKOUT_EVENTS_MAX_LIMIT,
  )
  const conditions = [eq(workoutEvents.userId, userId), eq(workoutEvents.workoutId, workoutId)]
  // An empty kinds array would compile to a false predicate; treat it as "no
  // filter asked for" rather than silently returning nothing.
  if (options.kinds !== undefined && options.kinds.length > 0) {
    conditions.push(inArray(workoutEvents.kind, [...options.kinds]))
  }
  if (options.before !== undefined) {
    // Compound cursor matching the (occurredAt, id) sort: a timestamp-only
    // cursor would skip unreturned rows TIED on the last page's timestamp.
    // `beforeId` is the last row's id from the prior page; without it the
    // timestamp-only form stands (first page, or a caller with only a date).
    conditions.push(
      options.beforeId !== undefined
        ? or(
            lt(workoutEvents.occurredAt, options.before),
            and(
              eq(workoutEvents.occurredAt, options.before),
              lt(workoutEvents.id, options.beforeId),
            ),
          )!
        : lt(workoutEvents.occurredAt, options.before),
    )
  }
  return db
    .select()
    .from(workoutEvents)
    .where(and(...conditions))
    // id as the tiebreak so same-timestamp rows page deterministically.
    .orderBy(desc(workoutEvents.occurredAt), desc(workoutEvents.id))
    .limit(limit)
}

/** One row as `listWorkoutEvents` returns it. */
export type WorkoutEventRow = Awaited<ReturnType<typeof listWorkoutEvents>>[number]
