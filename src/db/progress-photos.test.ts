import { describe, it, expect, vi, beforeEach } from 'vitest'
import { bytesToBase64 } from '@/lib/body/photo-input'

/**
 * Recording stubs for the Drizzle builders, mirroring body-measurements.test.ts:
 * single statements straight off `db` (no transaction — the blobs, not the row,
 * are the thing needing best-effort cleanup, and that lives in the route).
 */
const inserts: { values: unknown }[] = []
let deleteResult: unknown[] = []
let countResult = 0

vi.mock('./index', () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        inserts.push({ values: v })
        return { returning: () => Promise.resolve([{ id: 'p1' }]) }
      },
    }),
    delete: () => ({
      where: () => ({ returning: () => Promise.resolve(deleteResult) }),
    }),
    select: () => ({
      from: () => ({ where: () => Promise.resolve([{ value: countResult }]) }),
    }),
  },
}))

import {
  countProgressPhotos,
  deleteProgressPhoto,
  insertProgressPhoto,
} from './progress-photos'

const USER = 'user_123'
const VALID_HASH = bytesToBase64(new Uint8Array(25))

const base = {
  id: 'p1',
  blobKeyDisplay: 'user_123/p1/display.webp',
  blobKeyThumb: 'user_123/p1/thumb.webp',
  thumbHash: VALID_HASH,
}

beforeEach(() => {
  inserts.length = 0
  deleteResult = []
  countResult = 0
})

describe('insertProgressPhoto (user-scoped)', () => {
  it('inserts a minimal valid row (no pose/note → column defaults)', async () => {
    const result = await insertProgressPhoto(USER, base)
    expect(inserts[0].values).toEqual({ userId: USER, ...base })
    expect(result).toEqual({ id: 'p1' })
  })

  it('passes pose, note, and takenAt through when provided', async () => {
    const takenAt = new Date('2026-06-01T08:00:00Z')
    await insertProgressPhoto(USER, { ...base, pose: 'side', note: 'week 4', takenAt })
    expect(inserts[0].values).toEqual({
      userId: USER,
      ...base,
      pose: 'side',
      note: 'week 4',
      takenAt,
    })
  })

  it('rejects a bad thumb hash without inserting', async () => {
    await expect(
      insertProgressPhoto(USER, { ...base, thumbHash: 'nope' }),
    ).rejects.toThrow('invalid thumb hash')
    expect(inserts).toHaveLength(0)
  })

  it('rejects an unknown pose without inserting', async () => {
    await expect(
      // @ts-expect-error — exercising the runtime guard past the type
      insertProgressPhoto(USER, { ...base, pose: 'forward' }),
    ).rejects.toThrow('invalid pose')
    expect(inserts).toHaveLength(0)
  })

  it('rejects an over-long note without inserting', async () => {
    await expect(
      insertProgressPhoto(USER, { ...base, note: 'x'.repeat(501) }),
    ).rejects.toThrow('at most 500 characters')
    expect(inserts).toHaveLength(0)
  })

  it('rejects missing blob keys without inserting', async () => {
    await expect(
      insertProgressPhoto(USER, { ...base, blobKeyThumb: '' }),
    ).rejects.toThrow('missing blob keys')
    expect(inserts).toHaveLength(0)
  })
})

describe('countProgressPhotos', () => {
  it('returns the aggregate count', async () => {
    countResult = 7
    expect(await countProgressPhotos(USER)).toBe(7)
  })
})

describe('deleteProgressPhoto (user-scoped)', () => {
  it('returns the row with its blob keys when owned', async () => {
    deleteResult = [
      { id: 'p1', blobKeyDisplay: base.blobKeyDisplay, blobKeyThumb: base.blobKeyThumb },
    ]
    const result = await deleteProgressPhoto(USER, 'p1')
    expect(result).toEqual({
      id: 'p1',
      blobKeyDisplay: base.blobKeyDisplay,
      blobKeyThumb: base.blobKeyThumb,
    })
  })

  it('returns null when the row is not owned (or gone)', async () => {
    deleteResult = []
    expect(await deleteProgressPhoto(USER, 'someone-elses-id')).toBeNull()
  })
})
