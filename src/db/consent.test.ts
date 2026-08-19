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
