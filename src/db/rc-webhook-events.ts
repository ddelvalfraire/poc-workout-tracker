import { and, desc, eq, isNotNull, lt, or, sql } from 'drizzle-orm'
import { db } from './index'
import { rcWebhookEvents, type RcWebhookEventStatus } from './schema'

/**
 * The RevenueCat webhook inbox: insert-first dedupe, retry bookkeeping, and
 * the dead-letter record in one table. See docs/SPIKE-REVENUECAT.md for why
 * this exists (RC redelivers with the same event id; delivery is
 * at-least-once and unordered; the inbox is what makes both safe).
 */

/**
 * What this delivery is, decided by the insert:
 * - `new`: first time we have seen this event id.
 * - `retry`: seen before but not finished (received/failed) — process again.
 * - `already-done`: finished (processed/ignored/orphaned) — return 200 now,
 *   nothing to do. Orphaned counts as done because retrying cannot fix it.
 */
export type InboxDisposition = 'new' | 'retry' | 'already-done'

export interface InboxEventInput {
  /** RC's event id — the dedupe key. */
  id: string
  type: string
  appUserId: string | null
  environment: string
  /** The full raw event, as parsed JSON. */
  payload: unknown
}

export interface InboxRow {
  id: string
  type: string
  appUserId: string | null
  environment: string
  payload: unknown
  status: RcWebhookEventStatus
  attempts: number
  lastError: string | null
  receivedAt: Date
  processedAt: Date | null
}

/** Statuses that mean "this event's story is over" — a redelivery is a no-op. */
const DONE: readonly RcWebhookEventStatus[] = ['processed', 'ignored', 'orphaned']

/**
 * Insert-first: the ON CONFLICT DO NOTHING against the primary key is the
 * dedupe guard, so two concurrent deliveries of the same id cannot both be
 * `new`. The loser reads the row's status to learn whether this is a
 * duplicate of finished work or a retry of unfinished work. A retry bumps
 * `attempts` so the dead-letter query can tell "failed once, RC will retry"
 * from "failed six times, nobody is coming".
 */
export async function recordEvent(input: InboxEventInput): Promise<InboxDisposition> {
  const inserted = await db
    .insert(rcWebhookEvents)
    .values({
      id: input.id,
      type: input.type,
      appUserId: input.appUserId,
      environment: input.environment,
      payload: input.payload,
    })
    .onConflictDoNothing({ target: rcWebhookEvents.id })
    .returning({ id: rcWebhookEvents.id })

  if (inserted.length > 0) return 'new'

  const [existing] = await db
    .select({ status: rcWebhookEvents.status })
    .from(rcWebhookEvents)
    .where(eq(rcWebhookEvents.id, input.id))
    .limit(1)

  // Insert conflicted but the row is gone: purged between the two statements
  // (account deletion). The event's story is over either way.
  if (!existing) return 'already-done'
  if (DONE.includes(existing.status)) return 'already-done'

  await db
    .update(rcWebhookEvents)
    .set({ attempts: sql`${rcWebhookEvents.attempts} + 1` })
    .where(eq(rcWebhookEvents.id, input.id))
  return 'retry'
}

export async function markProcessed(id: string): Promise<void> {
  await setStatus(id, 'processed', null)
}

export async function markIgnored(id: string): Promise<void> {
  await setStatus(id, 'ignored', null)
}

/** Permanently unprocessable (unknown user). RC gets a 200; the note says why. */
export async function markOrphaned(id: string, note: string): Promise<void> {
  await setStatus(id, 'orphaned', note)
}

/** Transient failure. RC gets a 5xx and redelivers with the same id. */
export async function markFailed(id: string, error: string): Promise<void> {
  await setStatus(id, 'failed', error)
}

async function setStatus(
  id: string,
  status: RcWebhookEventStatus,
  note: string | null,
): Promise<void> {
  await db
    .update(rcWebhookEvents)
    .set({ status, lastError: note, processedAt: new Date() })
    .where(eq(rcWebhookEvents.id, id))
}

/**
 * The backstop cron's worklist: failed rows, plus `received` rows old enough
 * that no request can still be working on them (a function died
 * mid-processing and RC's retries are exhausted or also died).
 */
export async function listReprocessable(opts: {
  staleReceivedBefore: Date
  limit?: number
}): Promise<InboxRow[]> {
  return db
    .select()
    .from(rcWebhookEvents)
    .where(
      or(
        eq(rcWebhookEvents.status, 'failed'),
        and(
          eq(rcWebhookEvents.status, 'received'),
          lt(rcWebhookEvents.receivedAt, opts.staleReceivedBefore),
        ),
      ),
    )
    .orderBy(rcWebhookEvents.receivedAt)
    .limit(opts.limit ?? 100)
}

/**
 * Retention trim: null out raw payloads past their useful life. The METADATA
 * row stays forever — it is the dedupe record — but payloads can carry
 * subscriber-attribute PII and have no replay value once RC's retries and
 * our backstop are long past. Returns how many were trimmed.
 */
export async function trimPayloads(olderThan: Date): Promise<number> {
  const trimmed = await db
    .update(rcWebhookEvents)
    .set({ payload: null })
    .where(
      and(isNotNull(rcWebhookEvents.payload), lt(rcWebhookEvents.receivedAt, olderThan)),
    )
    .returning({ id: rcWebhookEvents.id })
  return trimmed.length
}

/**
 * Ops resolution: closes a dead-letter row so the alerting tally stops
 * counting it. Terminal-ignored rather than a new status — a resolved row
 * behaves exactly like any other finished event (redeliveries dedupe against
 * it). The note carries who resolved it and why; there is no actor column,
 * so attribution lives in the note by contract (the ops action writes it).
 */
export async function resolveEvent(id: string, note: string): Promise<boolean> {
  const updated = await db
    .update(rcWebhookEvents)
    .set({ status: 'ignored', lastError: note, processedAt: new Date() })
    .where(
      and(
        eq(rcWebhookEvents.id, id),
        or(eq(rcWebhookEvents.status, 'failed'), eq(rcWebhookEvents.status, 'orphaned')),
      ),
    )
    .returning({ id: rcWebhookEvents.id })
  return updated.length > 0
}

/** The dead-letter rows themselves, newest first — the ops panel's list. */
export async function listDeadLetterRows(limit = 50): Promise<
  Array<{
    id: string
    type: string
    appUserId: string | null
    status: RcWebhookEventStatus
    attempts: number
    lastError: string | null
    receivedAt: Date
  }>
> {
  return db
    .select({
      id: rcWebhookEvents.id,
      type: rcWebhookEvents.type,
      appUserId: rcWebhookEvents.appUserId,
      status: rcWebhookEvents.status,
      attempts: rcWebhookEvents.attempts,
      lastError: rcWebhookEvents.lastError,
      receivedAt: rcWebhookEvents.receivedAt,
    })
    .from(rcWebhookEvents)
    .where(or(eq(rcWebhookEvents.status, 'failed'), eq(rcWebhookEvents.status, 'orphaned')))
    .orderBy(desc(rcWebhookEvents.receivedAt))
    .limit(limit)
}

/** The alerting tally: rows a human should know about. */
export async function countDeadLetters(): Promise<{ failed: number; orphaned: number }> {
  const rows = await db
    .select({
      status: rcWebhookEvents.status,
      count: sql<number>`count(*)::int`,
    })
    .from(rcWebhookEvents)
    .where(or(eq(rcWebhookEvents.status, 'failed'), eq(rcWebhookEvents.status, 'orphaned')))
    .groupBy(rcWebhookEvents.status)

  const tally = { failed: 0, orphaned: 0 }
  for (const row of rows) {
    if (row.status === 'failed') tally.failed = row.count
    if (row.status === 'orphaned') tally.orphaned = row.count
  }
  return tally
}
