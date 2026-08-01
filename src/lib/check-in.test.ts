import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/check-ins', () => ({ getCheckInFacts: vi.fn() }))

import {
  daysSinceCheckIn,
  getCheckInStatus,
  isCheckInDue,
  latestCheckInAt,
} from './check-in'
import { getCheckInFacts } from '@/db/check-ins'

const mockedFacts = vi.mocked(getCheckInFacts)

const NOW = new Date('2026-07-31T14:00:00Z')

function facts(overrides: Partial<NonNullable<Awaited<ReturnType<typeof getCheckInFacts>>>> = {}) {
  return {
    programName: 'PPL',
    cadenceDays: 14,
    latestBodyweightAt: null,
    latestMeasurementAt: null,
    latestPhotoAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('latestCheckInAt', () => {
  it('returns null when every source is empty', () => {
    expect(latestCheckInAt([null, null, null])).toBeNull()
  })

  it('picks the max across sources — a fresh photo beats an old weigh-in', () => {
    const weigh = new Date('2026-07-01T08:00:00Z')
    const tape = new Date('2026-07-10T08:00:00Z')
    const photo = new Date('2026-07-20T08:00:00Z')
    expect(latestCheckInAt([weigh, tape, photo])).toBe(photo)
    expect(latestCheckInAt([photo, null, weigh])).toBe(photo)
  })
})

describe('isCheckInDue', () => {
  it('is due when there has never been a check-in', () => {
    expect(isCheckInDue(null, 14, NOW)).toBe(true)
  })

  it('is due exactly at the cadence boundary (last + cadence == now)', () => {
    const last = new Date(NOW.getTime() - 14 * 24 * 60 * 60 * 1000)
    expect(isCheckInDue(last, 14, NOW)).toBe(true)
  })

  it('is not due one millisecond before the cadence elapses', () => {
    const last = new Date(NOW.getTime() - 14 * 24 * 60 * 60 * 1000 + 1)
    expect(isCheckInDue(last, 14, NOW)).toBe(false)
  })

  it('is not due the day after a check-in', () => {
    const last = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000)
    expect(isCheckInDue(last, 14, NOW)).toBe(false)
  })
})

describe('daysSinceCheckIn', () => {
  it('floors partial days and never goes negative', () => {
    const last = new Date(NOW.getTime() - 16.7 * 24 * 60 * 60 * 1000)
    expect(daysSinceCheckIn(last, NOW)).toBe(16)
    expect(daysSinceCheckIn(new Date(NOW.getTime() + 1000), NOW)).toBe(0)
  })
})

describe('getCheckInStatus', () => {
  it('returns null when no active program suggests a cadence', async () => {
    mockedFacts.mockResolvedValue(null)
    expect(await getCheckInStatus('user_1', NOW)).toBeNull()
  })

  it('is due with no history at all (the first check-in is immediately due)', async () => {
    mockedFacts.mockResolvedValue(facts())
    expect(await getCheckInStatus('user_1', NOW)).toEqual({
      due: true,
      programName: 'PPL',
      cadenceDays: 14,
      lastCheckInAt: null,
      daysSinceLast: null,
    })
  })

  it('derives last check-in from the freshest source (multi-source max)', async () => {
    // Arrange — the photo is the freshest of the three, 16 days ago
    mockedFacts.mockResolvedValue(
      facts({
        latestBodyweightAt: new Date('2026-06-01T08:00:00Z'),
        latestMeasurementAt: new Date('2026-06-20T08:00:00Z'),
        latestPhotoAt: new Date('2026-07-15T08:00:00Z'),
      }),
    )

    // Act
    const status = await getCheckInStatus('user_1', NOW)

    // Assert — 16 days > 14-day cadence → due, recency from the photo
    expect(status).toEqual({
      due: true,
      programName: 'PPL',
      cadenceDays: 14,
      lastCheckInAt: new Date('2026-07-15T08:00:00Z'),
      daysSinceLast: 16,
    })
  })

  it('is not due when any source is within the cadence', async () => {
    // Arrange — an old photo but a weigh-in 2 days ago
    mockedFacts.mockResolvedValue(
      facts({
        latestBodyweightAt: new Date('2026-07-29T08:00:00Z'),
        latestPhotoAt: new Date('2026-06-01T08:00:00Z'),
      }),
    )

    // Act
    const status = await getCheckInStatus('user_1', NOW)

    // Assert
    expect(status?.due).toBe(false)
    expect(status?.daysSinceLast).toBe(2)
  })
})
