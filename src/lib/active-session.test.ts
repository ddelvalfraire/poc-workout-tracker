import { describe, it, expect } from 'vitest'
import { pickActiveSession } from './active-session'
import { DRAFT_TTL_MS } from '@/app/workout/new/draft-payload'

const NOW = new Date('2026-07-05T12:00:00.000Z')

/** A valid draft payload: two exercises, three sets, one checked off. */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    unit: 'kg',
    name: 'Leg Day',
    openedAt: '2026-07-05T11:40:00.000Z',
    draft: {
      exercises: [
        {
          id: 'ex1',
          wgerExerciseId: 73,
          name: 'Squat',
          category: 'Legs',
          sets: [
            { id: 's1', reps: '5', weight: '100', completed: true },
            { id: 's2', reps: '', weight: '', completed: false },
          ],
        },
        {
          id: 'ex2',
          wgerExerciseId: 74,
          name: 'Bench',
          category: 'Chest',
          sets: [{ id: 's3', reps: '', weight: '', completed: false }],
        },
      ],
    },
    ...overrides,
  }
}

function row(key: string, ageMs: number, p: unknown = payload()) {
  return { key, payload: p, updatedAt: new Date(NOW.getTime() - ageMs) }
}

describe('pickActiveSession', () => {
  it('projects the freshest valid draft into banner data', () => {
    // Act
    const session = pickActiveSession([row('new', 60_000)], NOW)

    // Assert
    expect(session).toEqual({
      key: 'new',
      name: 'Leg Day',
      exerciseCount: 2,
      setCount: 3,
      completedSetCount: 1,
      openedAt: new Date('2026-07-05T11:40:00.000Z'),
    })
  })

  it('returns null when there are no drafts', () => {
    expect(pickActiveSession([], NOW)).toBeNull()
  })

  it('ignores drafts older than the TTL (abandoned sessions)', () => {
    expect(pickActiveSession([row('new', DRAFT_TTL_MS + 1_000)], NOW)).toBeNull()
  })

  it('ignores malformed payloads (storage is untrusted)', () => {
    expect(pickActiveSession([row('new', 60_000, { junk: true })], NOW)).toBeNull()
    expect(pickActiveSession([row('new', 60_000, null)], NOW)).toBeNull()
  })

  it('picks the most recently updated draft when several are active', () => {
    // Arrange — an older edit-surface draft and a fresher new-surface one
    const rows = [
      row('11111111-1111-1111-1111-111111111111', 30 * 60_000, payload({ name: 'Old edit' })),
      row('new', 60_000, payload({ name: 'Fresh session' })),
    ]

    // Act + Assert — order in the array must not matter
    expect(pickActiveSession(rows, NOW)?.name).toBe('Fresh session')
    expect(pickActiveSession([...rows].reverse(), NOW)?.name).toBe('Fresh session')
  })

  it('nulls a blank name so the card can show its own fallback', () => {
    expect(pickActiveSession([row('new', 60_000, payload({ name: '  ' }))], NOW)?.name).toBeNull()
  })

  it('skips an invalid fresher draft in favor of a valid older one', () => {
    const rows = [
      row('new', 60_000, { junk: true }),
      row('22222222-2222-2222-2222-222222222222', 5 * 60_000),
    ]

    expect(pickActiveSession(rows, NOW)?.key).toBe('22222222-2222-2222-2222-222222222222')
  })
})
