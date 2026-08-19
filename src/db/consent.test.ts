import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stubs for the Drizzle builders, mirroring bodyweight.test.ts:
 * selects resolve to `selectQueue` entries (shifted per call so multi-select
 * flows can be scripted), inserts record their values, `.returning()` yields
 * deterministic ids, `.onConflictDoUpdate(c)` records the projection upsert.
 */
let selectQueue: Record<string, unknown>[][] = []
const inserts: { values: unknown }[] = []
const upserts: { values: unknown; conflict: unknown }[] = []
// Pseudonymization-path recorders: the op log proves ordering (GUC first),
// `executed` captures raw sql statements, updates/deletes capture arguments.
const ops: string[] = []
const executed: unknown[] = []
const updates: { set: unknown; where: unknown }[] = []
const deletes: { where: unknown }[] = []
let updateReturnRows: Record<string, unknown>[] = []

function nextSelectRows() {
  return selectQueue.length > 0 ? selectQueue.shift()! : []
}

function makeDb() {
  const selectBuilder = () => {
    const rowsPromise = () => Promise.resolve(nextSelectRows())
    const b: Record<string, unknown> = {}
    b.from = () => b
    b.where = () => b
    b.orderBy = () => b
    b.limit = () => rowsPromise()
    // getConsentState awaits after .where() with no .limit(): make the
    // builder thenable so both shapes resolve.
    b.then = (resolve: (rows: unknown[]) => void) => rowsPromise().then(resolve)
    return b
  }
  const database = {
    // Advisory lock (recordConsent) and the SET LOCAL GUC (pseudonymize).
    execute: (statement: unknown) => {
      ops.push('execute')
      executed.push(statement)
      return Promise.resolve()
    },
    update: () => ({
      set: (s: unknown) => ({
        where: (w: unknown) => {
          ops.push('update')
          updates.push({ set: s, where: w })
          return { returning: () => Promise.resolve(updateReturnRows) }
        },
      }),
    }),
    delete: () => ({
      where: (w: unknown) => {
        ops.push('delete')
        deletes.push({ where: w })
        return Promise.resolve()
      },
    }),
    select: () => selectBuilder(),
    insert: () => ({
      values: (v: unknown) => {
        inserts.push({ values: v })
        const chain = {
          returning: () => Promise.resolve([{ id: 'row-1', version: 2 }]),
          onConflictDoUpdate: (c: unknown) => {
            upserts.push({ values: v, conflict: c })
            return Promise.resolve()
          },
          then: (resolve: (v: unknown) => void) => Promise.resolve().then(resolve),
        }
        return chain
      },
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(database),
  }
  return database
}

vi.mock('./index', () => ({ db: makeDb() }))

import {
  truncateIp,
  upsertConsentDocument,
  recordConsent,
  hasConsent,
  requireConsent,
  pseudonymizeConsentRecords,
  ConsentRequiredError,
} from './consent'

const PRESENTATION = {
  route: '/onboarding',
  surface: 'signup' as const,
  controlLabel: 'Store your health data',
}

beforeEach(() => {
  selectQueue = []
  inserts.length = 0
  upserts.length = 0
  ops.length = 0
  executed.length = 0
  updates.length = 0
  deletes.length = 0
  updateReturnRows = []
})

describe('truncateIp', () => {
  it('keeps only the /16 of an IPv4', () => {
    expect(truncateIp('203.0.113.42')).toBe('203.0.0.0')
  })

  it('unwraps IPv4-mapped-IPv6 (the dual-stack socket form Node emits)', () => {
    expect(truncateIp('::ffff:203.0.113.42')).toBe('203.0.0.0')
  })

  it('keeps only the first two hextets of an IPv6', () => {
    expect(truncateIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8::')
  })

  it('degrades to null on garbage or absence — never throws', () => {
    expect(truncateIp('not-an-ip')).toBeNull()
    expect(truncateIp('')).toBeNull()
    expect(truncateIp(null)).toBeNull()
    expect(truncateIp(undefined)).toBeNull()
  })

  it('never stores colon-containing non-IP strings as evidence', () => {
    expect(truncateIp('account@example.com:token')).toBeNull()
    expect(truncateIp('https://evil.example:443')).toBeNull()
    expect(truncateIp('a:b')).toBeNull() // two groups is not an IPv6
  })

  it('rejects out-of-range IPv4 octets and loopback-ish compressed IPv6', () => {
    expect(truncateIp('999.1.2.3')).toBeNull()
    expect(truncateIp('::1')).toBeNull() // non-identifying anyway; store nothing
  })
})

describe('upsertConsentDocument', () => {
  it('is idempotent for unchanged content (same hash = no new version)', async () => {
    // Arrange — the stored latest version has the hash of exactly this text
    const content = '# Terms v-current'
    const { createHash } = await import('node:crypto')
    const sha = createHash('sha256').update(content).digest('hex')
    selectQueue.push([{ id: 'doc-1', version: 3, contentSha256: sha }])

    // Act
    const result = await upsertConsentDocument({
      docType: 'tos',
      contentMd: content,
      isMaterial: true,
      effectiveAt: new Date('2026-08-18T00:00:00Z'),
    })

    // Assert — returned as-is, nothing inserted
    expect(result).toEqual({ id: 'doc-1', version: 3, unchanged: true })
    expect(inserts).toHaveLength(0)
  })

  it('bumps the version when content changed', async () => {
    // Arrange — latest is v1 with a different hash
    selectQueue.push([{ id: 'doc-1', version: 1, contentSha256: 'old-hash' }])

    // Act
    const result = await upsertConsentDocument({
      docType: 'tos',
      contentMd: '# Terms v2',
      isMaterial: true,
      effectiveAt: new Date('2026-08-18T00:00:00Z'),
    })

    // Assert — insert carried version 2 and a real sha
    expect(result.unchanged).toBe(false)
    expect(inserts).toHaveLength(1)
    const values = inserts[0].values as { version: number; contentSha256: string }
    expect(values.version).toBe(2)
    expect(values.contentSha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('recordConsent', () => {
  it('rejects a grant without a document version — evidence must anchor to text', async () => {
    await expect(
      recordConsent({
        userId: 'user_1',
        purpose: 'health_collect',
        action: 'granted',
        presentation: PRESENTATION,
      }),
    ).rejects.toThrow(/requires a documentId/)
    expect(inserts).toHaveLength(0)
  })

  it('appends the event and projects granted=true, with truncated IP', async () => {
    // Act
    await recordConsent({
      userId: 'user_1',
      purpose: 'health_collect',
      action: 'granted',
      documentId: 'doc-1',
      ip: '203.0.113.42',
      userAgent: 'test-agent',
      presentation: PRESENTATION,
    })

    // Assert — event insert, then the projection's insert-values (recorded
    // before its onConflictDoUpdate lands in `upserts`)
    expect(inserts).toHaveLength(2)
    const event = inserts[0].values as Record<string, unknown>
    expect(event).toMatchObject({
      userId: 'user_1',
      purpose: 'health_collect',
      action: 'granted',
      documentId: 'doc-1',
      ipTruncated: '203.0.0.0',
      presentation: PRESENTATION,
    })
    expect(upserts).toHaveLength(1)
    expect(upserts[0].values).toMatchObject({ granted: true, eventId: 'row-1' })
  })

  it('withdrawal needs no document, projects granted=false, and enqueues the fan-out', async () => {
    // Act
    await recordConsent({
      userId: 'user_1',
      purpose: 'analytics_identity',
      action: 'withdrawn',
      presentation: { ...PRESENTATION, surface: 'settings', route: '/settings' },
      downstream: [{ processor: 'posthog', action: 'person_delete' }],
    })

    // Assert — event, projection values, then the downstream batch
    expect(inserts).toHaveLength(3)
    expect(inserts[0].values).toMatchObject({ action: 'withdrawn', documentId: null })
    expect(inserts[2].values).toEqual([
      { eventId: 'row-1', processor: 'posthog', action: 'person_delete' },
    ])
    expect(upserts[0].values).toMatchObject({ granted: false })
  })
})

describe('hasConsent / requireConsent', () => {
  it('passes when the projection row is granted', async () => {
    selectQueue.push([{ granted: true }])
    await expect(requireConsent('user_1', 'health_collect')).resolves.toBeUndefined()
  })

  it('throws ConsentRequiredError when never granted (absent row)', async () => {
    selectQueue.push([])
    await expect(requireConsent('user_1', 'health_collect')).rejects.toBeInstanceOf(
      ConsentRequiredError,
    )
  })

  it('throws after withdrawal (row present, granted=false)', async () => {
    selectQueue.push([{ granted: false }])
    await expect(hasConsent('user_1', 'analytics_identity')).resolves.toBe(false)
  })
})

/** Walks a (possibly circular) drizzle condition tree collecting the string
 *  params — enough to assert which values a where clause binds. */
function collectStrings(root: unknown): string[] {
  const seen = new Set<object>()
  const found: string[] = []
  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      found.push(node)
      return
    }
    if (node === null || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    for (const value of Object.values(node)) walk(value)
  }
  walk(root)
  return found
}

describe('pseudonymizeConsentRecords', () => {
  it('sets the GUC via SET LOCAL as the first statement of the transaction', async () => {
    // Arrange — the user has one event; the update reports one row touched
    selectQueue.push([{ id: 'ev-1' }])
    updateReturnRows = [{ id: 'ev-1' }]

    // Act
    await pseudonymizeConsentRecords('user_1')

    // Assert — the GUC grant precedes every mutation, and it is the
    // transaction-scoped form (SET LOCAL), so the permission dies at commit
    expect(ops[0]).toBe('execute')
    const statement = JSON.stringify(executed[0])
    expect(statement).toContain('SET LOCAL')
    expect(statement).toContain('app.consent_pseudonymize')
    expect(ops.indexOf('execute')).toBeLessThan(ops.indexOf('update'))
    expect(ops.indexOf('execute')).toBeLessThan(ops.indexOf('delete'))
  })

  it('replaces user_id with one irreversible random pseudonym across all events', async () => {
    selectQueue.push([{ id: 'ev-1' }, { id: 'ev-2' }])
    updateReturnRows = [{ id: 'ev-1' }, { id: 'ev-2' }]

    const result = await pseudonymizeConsentRecords('user_1')

    // One update statement rewrites every event row to the same pseudonym —
    // random uuid (nothing derivable back to user_1), deleted: prefix.
    expect(updates).toHaveLength(1)
    const set = updates[0].set as { userId: string }
    expect(set.userId).toMatch(/^deleted:[0-9a-f]{8}-[0-9a-f-]{27}$/)
    expect(set.userId).not.toContain('user_1')
    expect(result.pseudonym).toBe(set.userId)
    expect(result.eventsPseudonymized).toBe(2)
  })

  it('reconciles projection + stale pending fan-out in the same transaction, sparing keepEventId', async () => {
    selectQueue.push([{ id: 'ev-1' }, { id: 'ev-final' }])
    updateReturnRows = [{ id: 'ev-1' }, { id: 'ev-final' }]

    await pseudonymizeConsentRecords('user_1', { keepEventId: 'ev-final' })

    // Two deletes: stale pending downstream actions first, then the
    // consent_current projection rows. The keep-list rides in the fan-out
    // delete's where clause (ne keepEventId) so the deletion event's own
    // pending rows survive for the orchestrator to complete.
    expect(deletes).toHaveLength(2)
    const fanOutParams = collectStrings(deletes[0].where)
    expect(fanOutParams).toContain('ev-final')
    expect(fanOutParams).toContain('pending')
  })

  it('skips the fan-out delete when the user has no events (nothing to reconcile)', async () => {
    selectQueue.push([])
    updateReturnRows = []

    const result = await pseudonymizeConsentRecords('user_ghost')

    // Only the projection delete runs; the update touches nothing.
    expect(deletes).toHaveLength(1)
    expect(result.eventsPseudonymized).toBe(0)
  })
})

describe('append-only trigger migrations (SQL fixtures)', () => {
  // The trigger itself runs in Postgres, out of unit-test reach — but the
  // migration files are in-repo facts we can hold still: the block branch
  // must remain, and the ONLY bypass must be the exact GUC the controlled
  // path sets. A drive-by edit that widens the gate fails here.
  it('0049 keeps the RAISE for mutations without the GUC and gates on the exact setting', async () => {
    const { readFile } = await import('node:fs/promises')
    const sql = await readFile('drizzle/0049_consent_pseudonymize_guc.sql', 'utf8')
    expect(sql).toContain("current_setting('app.consent_pseudonymize', true) = 'on'")
    expect(sql).toContain('RAISE EXCEPTION')
    expect(sql).toMatch(/consent_events is append-only/)
    // The replacement targets the 0047 function name, so the existing
    // trigger binding (BEFORE UPDATE OR DELETE) keeps pointing at it.
    expect(sql).toContain('FUNCTION consent_events_block_mutation()')
  })

  it('0048 consent_documents trigger stays unconditional (documents are never user-scoped)', async () => {
    const { readFile } = await import('node:fs/promises')
    const sql = await readFile('drizzle/0048_consent_documents_append_only.sql', 'utf8')
    expect(sql).toContain('RAISE EXCEPTION')
    expect(sql).not.toContain('consent_pseudonymize')
  })
})
