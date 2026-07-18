import { describe, it, expect, beforeEach } from 'vitest'
import { vi } from 'vitest'

/**
 * Recording stub for the autoreg history assembly, in the instantiate-program
 * idiom: `db.select(...)` chains resolve rows from `selectQueue` in call order
 * (slots first, then set rows), and each where-predicate/order-by is captured
 * so the harness can prove the trained/completed/recency filters and the id
 * tiebreak are actually in the query — canned rows can't catch a dropped
 * predicate.
 */
let selectQueue: unknown[][] = []
let capturedWheres: unknown[] = []
let capturedOrders: unknown[][] = []

function selectChain() {
  const rows = selectQueue.shift() ?? []
  const obj = {
    from: () => obj,
    innerJoin: () => obj,
    where: (predicate: unknown) => {
      capturedWheres.push(predicate)
      return obj
    },
    orderBy: (...args: unknown[]) => {
      capturedOrders.push(args)
      return obj
    },
    limit: () => obj,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
  }
  return obj
}

/** Walks queryChunks only (columns are leaves) — same helper as
 *  instantiate-program.test.ts, for the same dropped-predicate reason. */
function predicateMentionsColumn(predicate: unknown, column: string): boolean {
  if (predicate === null || typeof predicate !== 'object') return false
  const p = predicate as { name?: unknown; queryChunks?: unknown[] }
  if (p.name === column) return true
  if (Array.isArray(p.queryChunks)) {
    return p.queryChunks.some((chunk) => predicateMentionsColumn(chunk, column))
  }
  return false
}

vi.mock('./index', () => ({
  db: { select: () => selectChain() },
}))

import { getRecentTrainedSessions } from './autoreg-history'

const USER = 'user_123'
const PID = 'p1'

/** Slot rows come back newest-first (the query orders); startedAt supplies
 *  the calendar-day dedupe key. */
const slot = (
  workoutId: string,
  programWeek: number,
  workoutExerciseId: string,
  startedAt = new Date(`2026-07-0${programWeek}T10:00:00Z`),
) => ({
  workoutId,
  programWeek,
  startedAt,
  workoutExerciseId,
})

const setRow = (
  workoutExerciseId: string,
  reps: number,
  weightKg: number,
  extra: Partial<{
    setNumber: number
    completed: boolean
    setType: string
    prescribedLoadKg: number | null
    prescribedRepMin: number | null
  }> = {},
) => ({
  workoutExerciseId,
  setNumber: extra.setNumber ?? 1,
  reps,
  weightKg,
  completed: extra.completed ?? true,
  setType: extra.setType ?? 'working',
  prescribedLoadKg: extra.prescribedLoadKg ?? weightKg,
  prescribedRepMin: extra.prescribedRepMin ?? 8,
})

beforeEach(() => {
  selectQueue = []
  capturedWheres = []
  capturedOrders = []
})

describe('getRecentTrainedSessions', () => {
  it('returns the three most recent sessions with snapshot-bearing set rows, freshest first', async () => {
    // Arrange — four prior sessions; only the first three should be consulted
    selectQueue = [
      [slot('w4', 4, 'we4'), slot('w3', 3, 'we3'), slot('w2', 2, 'we2'), slot('w1', 1, 'we1')],
      [setRow('we4', 6, 100), setRow('we3', 8, 100), setRow('we2', 8, 97.5)],
    ]

    // Act
    const sessions = await getRecentTrainedSessions(USER, PID, 'wger', 1)

    // Assert — window of 3, and each set row carries its prescribed snapshot
    expect(sessions.map((s) => s.workoutId)).toEqual(['w4', 'w3', 'w2'])
    expect(sessions[0].sets).toEqual([
      {
        setNumber: 1,
        reps: 6,
        weightKg: 100,
        completed: true,
        setType: 'working',
        prescribedLoadKg: 100,
        prescribedRepMin: 8,
      },
    ])
  })

  it('keeps only the FIRST slot when a day repeats the exercise', async () => {
    // Arrange — w2 lists the exercise twice (position order in the row order)
    selectQueue = [
      [slot('w2', 2, 'we2a'), slot('w2', 2, 'we2b'), slot('w1', 1, 'we1')],
      [setRow('we2a', 5, 100), setRow('we2b', 9, 60), setRow('we1', 8, 97.5)],
    ]

    // Act
    const sessions = await getRecentTrainedSessions(USER, PID, 'wger', 1)

    // Assert — two distinct workouts, the repeat's second slot dropped: a
    // slot-1 actual can never be scored against a slot-2 template.
    expect(sessions.map((s) => s.workoutId)).toEqual(['w2', 'w1'])
    expect(sessions[0].sets).toHaveLength(1)
    expect(sessions[0].sets[0].reps).toBe(5)
  })

  it('keeps one session per calendar day (the latest of a double-session day)', async () => {
    // Arrange — w3b and w3a share July 3rd; the later one (first in desc
    // order) wins, the earlier must not eat a window slot.
    selectQueue = [
      [
        slot('w3b', 3, 'we3b', new Date('2026-07-03T18:00:00Z')),
        slot('w3a', 3, 'we3a', new Date('2026-07-03T09:00:00Z')),
        slot('w2', 2, 'we2', new Date('2026-07-02T10:00:00Z')),
        slot('w1', 1, 'we1', new Date('2026-07-01T10:00:00Z')),
      ],
      [setRow('we3b', 6, 100), setRow('we2', 7, 100), setRow('we1', 8, 100)],
    ]

    // Act
    const sessions = await getRecentTrainedSessions(USER, PID, 'wger', 1)

    // Assert — w3a skipped; the window still reaches back to w1.
    expect(sessions.map((s) => s.workoutId)).toEqual(['w3b', 'w2', 'w1'])
  })

  it('truncates at the deload boundary: the deload session and everything older are dropped', async () => {
    // Arrange — deloadWeek 2: w2 is a planned back-off, and the stalls of w1
    // behind it are pre-deload memory that must not carry through.
    selectQueue = [
      [
        slot('w4', 4, 'we4', new Date('2026-07-04T10:00:00Z')),
        slot('w3', 3, 'we3', new Date('2026-07-03T10:00:00Z')),
        slot('w2', 2, 'we2', new Date('2026-07-02T10:00:00Z')),
        slot('w1', 1, 'we1', new Date('2026-07-01T10:00:00Z')),
      ],
      [setRow('we4', 5, 100), setRow('we3', 5, 100)],
    ]

    // Act
    const sessions = await getRecentTrainedSessions(USER, PID, 'wger', 1, { deloadWeek: 2 })

    // Assert — only the post-deload sessions testify.
    expect(sessions.map((s) => s.workoutId)).toEqual(['w4', 'w3'])
  })

  it('scopes the query to the program, the composite identity, completed + trained workouts, and recency', async () => {
    // Arrange
    selectQueue = [[]]

    // Act
    await getRecentTrainedSessions(USER, PID, 'custom', 7, { excludeWorkoutId: 'w-current' })

    // Assert — the slot query predicate carries every gate: user, program
    // provenance, composite identity, weight_reps-only, stamped week, the
    // completion requirement (live sessions must never testify), the 45-day
    // recency window, the current-workout exclusion, and the ≥1-completed-set
    // invariant.
    const predicate = capturedWheres[0]
    for (const column of [
      'user_id',
      'program_id',
      'wger_exercise_id',
      'source',
      'logging_type',
      'program_week',
      'completed_at',
      'started_at',
      'completed',
    ]) {
      expect(predicateMentionsColumn(predicate, column)).toBe(true)
    }
  })

  it('orders by startedAt desc with the workout id as tiebreak (no midnight flapping)', async () => {
    // Arrange
    selectQueue = [[]]

    // Act
    await getRecentTrainedSessions(USER, PID, 'wger', 1)

    // Assert — three order terms: started_at, id (the deterministic
    // tiebreak), then slot position.
    const [orderArgs] = capturedOrders
    expect(orderArgs).toHaveLength(3)
    expect(predicateMentionsColumn(orderArgs[0], 'started_at')).toBe(true)
    expect(predicateMentionsColumn(orderArgs[1], 'id')).toBe(true)
    expect(predicateMentionsColumn(orderArgs[2], 'position')).toBe(true)
  })

  it('returns [] (no second query) when nothing qualifies', async () => {
    // Arrange
    selectQueue = [[]]

    // Act
    const sessions = await getRecentTrainedSessions(USER, PID, 'wger', 1)

    // Assert
    expect(sessions).toEqual([])
    expect(capturedWheres).toHaveLength(1)
  })
})
