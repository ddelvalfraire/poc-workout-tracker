import { describe, it, expect } from 'vitest'
import {
  pickActiveSession,
  activeSessionFromWorkouts,
  resolveActiveSession,
  activeSessionHref,
  type WorkoutSessionRow,
} from './active-session'
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

/** A started-but-unfinished workout row, `ageMs` old. */
function workoutRow(ageMs: number, overrides: Partial<WorkoutSessionRow> = {}): WorkoutSessionRow {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'Push',
    startedAt: new Date(NOW.getTime() - ageMs),
    completedAt: null,
    exerciseCount: 6,
    setCount: 20,
    completedSetCount: 3,
    ...overrides,
  }
}

describe('activeSessionFromWorkouts', () => {
  it('projects a fresh in-progress workout into banner data', () => {
    // Act
    const session = activeSessionFromWorkouts([workoutRow(60_000)], NOW)

    // Assert — key is the workout id so the banner resumes into edit mode
    expect(session).toEqual({
      key: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      name: 'Push',
      exerciseCount: 6,
      setCount: 20,
      completedSetCount: 3,
      openedAt: workoutRow(60_000).startedAt,
    })
  })

  it('ignores completed workouts', () => {
    const completed = workoutRow(60_000, { completedAt: new Date(NOW.getTime() - 30_000) })

    expect(activeSessionFromWorkouts([completed], NOW)).toBeNull()
  })

  it('ignores stale starts past the session window', () => {
    expect(activeSessionFromWorkouts([workoutRow(DRAFT_TTL_MS + 1_000)], NOW)).toBeNull()
  })

  it('picks the freshest of several in-progress workouts', () => {
    const rows = [
      workoutRow(3_600_000, { id: '11111111-1111-1111-1111-111111111111', name: 'Older' }),
      workoutRow(60_000, { id: '22222222-2222-2222-2222-222222222222', name: 'Fresh' }),
    ]

    expect(activeSessionFromWorkouts(rows, NOW)?.name).toBe('Fresh')
    expect(activeSessionFromWorkouts([...rows].reverse(), NOW)?.name).toBe('Fresh')
  })

  it('nulls a blank name for the card fallback label', () => {
    expect(activeSessionFromWorkouts([workoutRow(60_000, { name: null })], NOW)?.name).toBeNull()
    expect(activeSessionFromWorkouts([workoutRow(60_000, { name: '  ' })], NOW)?.name).toBeNull()
  })
})

describe('activeSessionHref', () => {
  it("routes the quick-log surface ('new') to /workout/new", () => {
    expect(activeSessionHref('new')).toBe('/workout/new')
  })

  it('routes a workout uuid to its edit route', () => {
    expect(activeSessionHref('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).toBe(
      '/workout/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/edit',
    )
  })
})

describe('resolveActiveSession', () => {
  it('prefers a draft touched more recently than an unrelated workout start', () => {
    // Arrange — the draft was edited AFTER the other workout was started
    const drafts = [row('new', 60_000)]
    const workouts = [workoutRow(30 * 60_000)]

    // Act
    const session = resolveActiveSession(drafts, workouts, NOW)

    // Assert
    expect(session?.key).toBe('new')
  })

  it('prefers a workout started after an unrelated draft was last touched', () => {
    // Arrange — a stale quick-log draft (still within TTL) vs a day the
    // lifter just started: the banner must surface what they are doing NOW
    const drafts = [row('new', 2 * 60 * 60_000)]
    const workouts = [workoutRow(30_000)]

    // Act
    const session = resolveActiveSession(drafts, workouts, NOW)

    // Assert
    expect(session?.key).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  })

  it('prefers the draft when it IS the workout (same key), regardless of recency', () => {
    // Arrange — the draft is that workout's live edit: one session, and the
    // draft carries unsaved sets the row does not have yet
    const drafts = [row('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 2 * 60 * 60_000)]
    const workouts = [workoutRow(30_000)]

    // Act
    const session = resolveActiveSession(drafts, workouts, NOW)

    // Assert — the draft's projection wins (3 sets, not the row's 20)
    expect(session?.key).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    expect(session?.setCount).toBe(3)
  })

  it('falls back to the in-progress workout when no draft exists', () => {
    expect(resolveActiveSession([], [workoutRow(60_000)], NOW)?.key).toBe(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    )
  })

  it('returns null when nothing is in progress', () => {
    expect(resolveActiveSession([], [], NOW)).toBeNull()
  })
})
