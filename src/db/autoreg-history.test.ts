import { describe, it, expect, beforeEach } from 'vitest'
import { vi } from 'vitest'

/**
 * Recording stub for the autoreg history assembly, in the instantiate-program
 * idiom: `db.select(...)` chains resolve rows from `selectQueue` in call order
 * (slots first, then set rows), and each where-predicate is captured so the
 * harness can prove the trained/provenance filters are actually in the query
 * — canned rows can't catch a dropped predicate.
 */
let selectQueue: unknown[][] = []
let capturedWheres: unknown[] = []

function selectChain() {
  const rows = selectQueue.shift() ?? []
  const obj = {
    from: () => obj,
    innerJoin: () => obj,
    where: (predicate: unknown) => {
      capturedWheres.push(predicate)
      return obj
    },
    orderBy: () => obj,
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

const slot = (workoutId: string, programWeek: number, workoutExerciseId: string) => ({
  workoutId,
  programWeek,
  workoutExerciseId,
})

beforeEach(() => {
  selectQueue = []
  capturedWheres = []
})

describe('getRecentTrainedSessions', () => {
  it('returns the two most recent sessions with their set rows, freshest first', async () => {
    // Arrange — three prior sessions; only the first two should be consulted
    selectQueue = [
      [slot('w3', 3, 'we3'), slot('w2', 2, 'we2'), slot('w1', 1, 'we1')],
      [
        { workoutExerciseId: 'we3', reps: 6, weightKg: 100, completed: true, setType: 'working' },
        { workoutExerciseId: 'we2', reps: 8, weightKg: 100, completed: true, setType: 'working' },
      ],
    ]

    // Act
    const sessions = await getRecentTrainedSessions(USER, PID, 'wger', 1)

    // Assert
    expect(sessions).toEqual([
      {
        workoutId: 'w3',
        programWeek: 3,
        sets: [{ reps: 6, weightKg: 100, completed: true, setType: 'working' }],
      },
      {
        workoutId: 'w2',
        programWeek: 2,
        sets: [{ reps: 8, weightKg: 100, completed: true, setType: 'working' }],
      },
    ])
  })

  it('keeps only the FIRST slot when a day repeats the exercise', async () => {
    // Arrange — w2 lists the exercise twice (position order in the row order)
    selectQueue = [
      [slot('w2', 2, 'we2a'), slot('w2', 2, 'we2b'), slot('w1', 1, 'we1')],
      [
        { workoutExerciseId: 'we2a', reps: 5, weightKg: 100, completed: true, setType: 'working' },
        { workoutExerciseId: 'we2b', reps: 9, weightKg: 60, completed: true, setType: 'working' },
        { workoutExerciseId: 'we1', reps: 8, weightKg: 97.5, completed: true, setType: 'working' },
      ],
    ]

    // Act
    const sessions = await getRecentTrainedSessions(USER, PID, 'wger', 1)

    // Assert — two distinct workouts, the repeat's second slot dropped
    expect(sessions.map((s) => s.workoutId)).toEqual(['w2', 'w1'])
    expect(sessions[0].sets).toHaveLength(1)
    expect(sessions[0].sets[0].reps).toBe(5)
  })

  it('scopes the query to the program, the composite identity, and TRAINED workouts', async () => {
    // Arrange
    selectQueue = [[]]

    // Act
    await getRecentTrainedSessions(USER, PID, 'custom', 7, 'w-current')

    // Assert — the slot query predicate carries every gate: user, program
    // provenance, composite identity, weight_reps-only, stamped week, the
    // current-workout exclusion, and the ≥1-completed-set invariant.
    const predicate = capturedWheres[0]
    for (const column of [
      'user_id',
      'program_id',
      'wger_exercise_id',
      'source',
      'logging_type',
      'program_week',
      'completed',
    ]) {
      expect(predicateMentionsColumn(predicate, column)).toBe(true)
    }
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
