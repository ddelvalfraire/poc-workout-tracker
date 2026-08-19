import { createHash } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
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
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/)
  if (v4) return `${v4[1]}.${v4[2]}.0.0`
  if (ip.includes(':')) {
    const groups = ip.split(':')
    if (groups.length < 2 || groups[0] === '') return null
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
export async function upsertConsentDocument(input: {
  docType: 'tos' | 'privacy' | 'health_notice' | 'analytics_notice'
  contentMd: string
  isMaterial: boolean
  effectiveAt: Date
}): Promise<{ id: string; version: number; unchanged: boolean }> {
  const sha = createHash('sha256').update(input.contentMd).digest('hex')
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
