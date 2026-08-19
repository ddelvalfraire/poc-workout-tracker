import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { db } from './index'
import {
  consentDocuments,
  consentEvents,
  consentCurrent,
  consentDownstreamActions,
  type ConsentPurpose,
} from './schema'

/**
 * Consent ledger — the ONLY write path to the consent tables. The ledger is
 * append-only (grant/withdraw/reconfirm are new events, never updates); the
 * projection (consent_current) is rewritten in the same transaction so hot
 * gates stay one PK lookup. Design notes live on the schema tables and in the
 * PR 4 brief.
 */

/** How a consent control was presented — the reproducibility half of proof. */
export interface ConsentPresentation {
  route: string
  surface: 'signup' | 'settings' | 'interstitial'
  /** The exact user-visible label of the control that was acted on. */
  controlLabel: string
  locale?: string
}

export class ConsentRequiredError extends Error {
  constructor(public readonly purpose: ConsentPurpose) {
    super(`consent required: ${purpose}`)
    this.name = 'ConsentRequiredError'
  }
}

/**
 * Truncates an IP for consent-evidence storage (GDPR-practice minimization:
 * keep enough to corroborate, not enough to identify). IPv4 keeps the /16;
 * IPv6 keeps the first two hextets (first 32 bits). Anything unparsable
 * becomes null — evidence degrades, requests never fail on a weird header.
 */
export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  // Node reports IPv4 clients on dual-stack sockets as '::ffff:1.2.3.4' —
  // unwrap before the v4 check or the most common real-world form would
  // degrade to null instead of truncating.
  const unwrapped = ip.replace(/^::ffff:/i, '')
  const v4 = unwrapped.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    // Out-of-range octets ('999.1.2.3') are not an IP; store nothing.
    if (v4.slice(1).some((octet) => Number(octet) > 255)) return null
    return `${v4[1]}.${v4[2]}.0.0`
  }
  // IPv6: only hex groups and colons may appear — anything else (URLs,
  // 'user@host:token', header junk) must never be stored as evidence.
  if (/^[0-9a-f:]+$/i.test(unwrapped) && unwrapped.includes(':')) {
    const groups = unwrapped.split(':')
    if (groups.length < 3 || groups[0] === '' || groups[1] === '') return null
    return `${groups[0]}:${groups[1]}::`
  }
  return null
}

/**
 * Registers a document version, idempotently: if the newest stored version of
 * this docType has the same content hash, it is returned unchanged (safe to
 * call on every deploy); otherwise a new row with version = newest + 1 is
 * inserted. Content is the full text as shown to users — the court evidence.
 */
export async function upsertConsentDocument(
  input: {
    docType: 'tos' | 'privacy' | 'health_notice' | 'analytics_notice'
    contentMd: string
    isMaterial: boolean
    effectiveAt: Date
  },
  // Concurrent deploy-time seeding can race read-then-insert: both readers
  // see the same latest version, one insert loses to the unique index. One
  // retry re-reads (usually finding the winner's identical content = the
  // idempotent no-op path) instead of surfacing a raw 23505 to the deploy.
  retry = true,
): Promise<{ id: string; version: number; unchanged: boolean }> {
  const sha = createHash('sha256').update(input.contentMd).digest('hex')
  try {
    return await upsertConsentDocumentOnce(input, sha)
  } catch (error) {
    const isUniqueViolation =
      typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
    if (isUniqueViolation && retry) return upsertConsentDocument(input, false)
    throw error
  }
}

async function upsertConsentDocumentOnce(
  input: {
    docType: 'tos' | 'privacy' | 'health_notice' | 'analytics_notice'
    contentMd: string
    isMaterial: boolean
    effectiveAt: Date
  },
  sha: string,
): Promise<{ id: string; version: number; unchanged: boolean }> {
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({
        id: consentDocuments.id,
        version: consentDocuments.version,
        contentSha256: consentDocuments.contentSha256,
      })
      .from(consentDocuments)
      .where(eq(consentDocuments.docType, input.docType))
      .orderBy(desc(consentDocuments.version))
      .limit(1)
    if (latest && latest.contentSha256 === sha) {
      return { id: latest.id, version: latest.version, unchanged: true }
    }
    const [row] = await tx
      .insert(consentDocuments)
      .values({
        docType: input.docType,
        version: (latest?.version ?? 0) + 1,
        contentMd: input.contentMd,
        contentSha256: sha,
        isMaterial: input.isMaterial,
        effectiveAt: input.effectiveAt,
      })
      .returning({ id: consentDocuments.id, version: consentDocuments.version })
    return { id: row.id, version: row.version, unchanged: false }
  })
}

/** The newest version of a document type (what new consents should reference). */
export async function getActiveConsentDocument(
  docType: 'tos' | 'privacy' | 'health_notice' | 'analytics_notice',
) {
  const [row] = await db
    .select()
    .from(consentDocuments)
    .where(eq(consentDocuments.docType, docType))
    .orderBy(desc(consentDocuments.version))
    .limit(1)
  return row ?? null
}

/**
 * Appends one consent event and rewrites the projection, atomically. A
 * withdrawal may enqueue downstream propagation (e.g. PostHog person
 * deletion) in the same transaction — the fan-out rows are the MHMDA
 * propagation evidence, completed later by the worker.
 */
export async function recordConsent(input: {
  userId: string
  purpose: ConsentPurpose
  action: 'granted' | 'withdrawn' | 'reconfirmed'
  /** Required for grants/reconfirms; null for withdrawals. */
  documentId?: string | null
  ip?: string | null
  userAgent?: string | null
  presentation: ConsentPresentation
  downstream?: Array<{ processor: string; action: string }>
}): Promise<{ eventId: string }> {
  const granted = input.action !== 'withdrawn'
  if (granted && !input.documentId) {
    throw new Error(`consent ${input.action} for ${input.purpose} requires a documentId`)
  }
  return db.transaction(async (tx) => {
    // Serialize concurrent writers on the same (user, purpose): without this,
    // a grant that inserted its event first can commit its projection upsert
    // AFTER a later withdrawal, leaving consent_current claiming granted
    // while the ledger's newest event says withdrawn — an unacceptable
    // divergence for a compliance table. The advisory lock is transaction-
    // scoped (released automatically at commit/rollback).
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${input.userId + ':' + input.purpose}))`,
    )
    const [event] = await tx
      .insert(consentEvents)
      .values({
        userId: input.userId,
        purpose: input.purpose,
        action: input.action,
        documentId: input.documentId ?? null,
        ipTruncated: truncateIp(input.ip),
        userAgent: input.userAgent ?? null,
        presentation: input.presentation,
      })
      .returning({ id: consentEvents.id })

    await tx
      .insert(consentCurrent)
      .values({
        userId: input.userId,
        purpose: input.purpose,
        granted,
        documentId: input.documentId ?? null,
        eventId: event.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [consentCurrent.userId, consentCurrent.purpose],
        set: {
          granted,
          documentId: input.documentId ?? null,
          eventId: event.id,
          updatedAt: new Date(),
        },
      })

    if (input.downstream?.length) {
      await tx.insert(consentDownstreamActions).values(
        input.downstream.map((d) => ({
          eventId: event.id,
          processor: d.processor,
          action: d.action,
        })),
      )
    }
    return { eventId: event.id }
  })
}

/**
 * Account-deletion severance for the consent ledger. Events must SURVIVE
 * deletion (CA ARL >= 3-year retention; MHMDA proof) but stop pointing at a
 * person: every consent_events.user_id for this user becomes one irreversible
 * pseudonym (`deleted:` + a random uuid — random, so nothing maps back; one
 * value, so the per-user event sequence stays coherent as evidence).
 *
 * The 0047 trigger blocks all mutation; 0049 gates it on the
 * `app.consent_pseudonymize` GUC, which this function sets via SET LOCAL so
 * the permission exists only inside this one transaction. In the same
 * transaction the user's consent_current projection rows are deleted (the
 * person is gone, there is no current state) and their still-pending
 * downstream actions are deleted as superseded — account deletion propagates
 * harder than any single withdrawal. `keepEventId` exempts the deletion
 * event's own fan-out rows, which the orchestrator completes afterwards.
 */
export async function pseudonymizeConsentRecords(
  userId: string,
  opts: { keepEventId?: string } = {},
): Promise<{ pseudonym: string; eventsPseudonymized: number }> {
  const pseudonym = `deleted:${randomUUID()}`
  return db.transaction(async (tx) => {
    // SET LOCAL takes no bind parameters; the value is a constant, nothing
    // user-controlled is interpolated.
    await tx.execute(sql`SET LOCAL app.consent_pseudonymize = 'on'`)

    const events = await tx
      .select({ id: consentEvents.id })
      .from(consentEvents)
      .where(eq(consentEvents.userId, userId))
    const eventIds = events.map((e) => e.id)

    if (eventIds.length > 0) {
      const stale = [
        inArray(consentDownstreamActions.eventId, eventIds),
        eq(consentDownstreamActions.status, 'pending'),
      ]
      if (opts.keepEventId) stale.push(ne(consentDownstreamActions.eventId, opts.keepEventId))
      await tx.delete(consentDownstreamActions).where(and(...stale))
    }

    await tx.delete(consentCurrent).where(eq(consentCurrent.userId, userId))

    const updated = await tx
      .update(consentEvents)
      .set({ userId: pseudonym })
      .where(eq(consentEvents.userId, userId))
      .returning({ id: consentEvents.id })

    return { pseudonym, eventsPseudonymized: updated.length }
  })
}

/** All current consent states for a user (the ConsentProvider bootstrap read). */
export async function getConsentState(
  userId: string,
): Promise<Partial<Record<ConsentPurpose, { granted: boolean; documentId: string | null }>>> {
  const rows = await db
    .select({
      purpose: consentCurrent.purpose,
      granted: consentCurrent.granted,
      documentId: consentCurrent.documentId,
    })
    .from(consentCurrent)
    .where(eq(consentCurrent.userId, userId))
  const state: Partial<Record<ConsentPurpose, { granted: boolean; documentId: string | null }>> = {}
  for (const row of rows) {
    state[row.purpose] = { granted: row.granted, documentId: row.documentId }
  }
  return state
}

/** One-purpose check against the projection. Absent row = never granted. */
export async function hasConsent(userId: string, purpose: ConsentPurpose): Promise<boolean> {
  const [row] = await db
    .select({ granted: consentCurrent.granted })
    .from(consentCurrent)
    .where(and(eq(consentCurrent.userId, userId), eq(consentCurrent.purpose, purpose)))
    .limit(1)
  return row !== undefined && row.granted
}

/**
 * The authoritative gate for server actions/routes: throws
 * ConsentRequiredError when the purpose was never granted or was withdrawn.
 */
export async function requireConsent(userId: string, purpose: ConsentPurpose): Promise<void> {
  if (!(await hasConsent(userId, purpose))) throw new ConsentRequiredError(purpose)
}
