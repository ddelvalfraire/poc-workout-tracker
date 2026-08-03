import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stub for the workout share layer (mirrors program-shares.test.ts).
 * Selects resolve from a per-call queue; inserts/updates record their table +
 * values and resolve queued ids. `./workouts` is mocked — detail-read fidelity
 * is workouts.test.ts's job; here we assert the GATES and, for resolve, the
 * PROJECTION: exactly the summary fields cross, notes provably never do.
 */

const selectQueue: unknown[][] = []
const inserts: { table: unknown; values: unknown }[] = []
const updates: { table: unknown; values: unknown }[] = []
let insertReturningQueue: unknown[][] = []
let updateReturningQueue: unknown[][] = []

type Resolve = (value: unknown) => unknown

interface FluentSelect {
  from: () => FluentSelect
  innerJoin: () => FluentSelect
  where: () => FluentSelect
  orderBy: () => FluentSelect
  limit: () => FluentSelect
  then: (resolve: Resolve) => Promise<unknown>
}

function makeSelect(rows: unknown[]): FluentSelect {
  const builder: FluentSelect = {
    from: () => builder,
    innerJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => builder,
    then: (resolve: Resolve) => Promise.resolve(rows).then(resolve),
  }
  return builder
}

function makeDb() {
  return {
    select: () => makeSelect(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table, values: v })
        return {
          returning: () => Promise.resolve(insertReturningQueue.shift() ?? []),
        }
      },
    }),
    update: (table: unknown) => ({
      set: (v: unknown) => {
        updates.push({ table, values: v })
        return {
          where: () => ({
            returning: () => Promise.resolve(updateReturningQueue.shift() ?? []),
          }),
        }
      },
    }),
  }
}

vi.mock('./index', () => ({ db: makeDb() }))

const { getWorkoutDetail, getExerciseHistoryBefore } = vi.hoisted(() => ({
  getWorkoutDetail: vi.fn(),
  getExerciseHistoryBefore: vi.fn(),
}))
vi.mock('./workouts', () => ({ getWorkoutDetail, getExerciseHistoryBefore }))
// mintShareToken is imported from program-shares; mocking ./programs cuts that
// module's deep import chain without faking the token mint itself.
vi.mock('./programs', () => ({ getProgramDetail: vi.fn(), copyProgramTree: vi.fn() }))

import {
  createWorkoutShare,
  revokeWorkoutShare,
  getActiveWorkoutShare,
  resolveWorkoutShare,
} from './workout-shares'
import { UnfinishedWorkoutShareError } from './workout-errors'
import { workoutShares } from './schema'

const OWNER = 'user_owner'
const VISITOR = 'user_visitor'
const WORKOUT_ID = 'workout-1'
const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz012345'
const COMPLETED = new Date('2026-08-01T12:00:00Z')
const STARTED = new Date('2026-08-01T11:00:00Z')

/** The 32-char base64url alphabet shape every minted token must have. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32}$/

/** An owned-workout authz slice as readOwnedWorkout selects it. */
function ownedRow(over: Record<string, unknown> = {}) {
  return { userId: OWNER, completedAt: COMPLETED, ...over }
}

/** A share row joined to its workout, as readWorkoutShareByToken selects it. */
function shareRow(over: Record<string, unknown> = {}) {
  return {
    workoutId: WORKOUT_ID,
    revokedAt: null,
    ownerUserId: OWNER,
    completedAt: COMPLETED,
    ...over,
  }
}

/** A full WorkoutDetail as getWorkoutDetail returns it — INCLUDING everything
 *  the projection must strip: notes at both levels and the provenance ids. */
function detailRow() {
  return {
    id: WORKOUT_ID,
    userId: OWNER,
    name: 'Push A',
    startedAt: STARTED,
    completedAt: COMPLETED,
    createdAt: STARTED,
    programDayId: 'day-secret',
    programWeek: 3,
    notes: 'private workout note',
    importBatchId: 'batch-secret',
    exercises: [
      {
        id: 'ex-1',
        workoutId: WORKOUT_ID,
        wgerExerciseId: 73,
        source: 'wger',
        name: 'Bench Press',
        position: 0,
        loggingType: 'weight_reps',
        notes: 'private exercise note',
        skipped: false,
        sets: [
          {
            id: 'set-1',
            workoutExerciseId: 'ex-1',
            setNumber: 1,
            reps: 5,
            weight: 100,
            completed: true,
            setType: 'working',
            prescribedLoadKg: 97.5,
            prescribedRepMin: 5,
            metricMode: 'reps_weight',
            durationSec: null,
            distanceM: null,
          },
        ],
      },
      {
        id: 'ex-2',
        workoutId: WORKOUT_ID,
        wgerExerciseId: 91,
        source: 'wger',
        name: 'Overhead Press',
        position: 1,
        loggingType: 'weight_reps',
        notes: null,
        skipped: true,
        sets: [],
      },
    ],
  }
}

beforeEach(() => {
  selectQueue.length = 0
  inserts.length = 0
  updates.length = 0
  insertReturningQueue = []
  updateReturningQueue = []
  getWorkoutDetail.mockReset()
  getExerciseHistoryBefore.mockReset()
  getExerciseHistoryBefore.mockResolvedValue([])
})

describe('createWorkoutShare', () => {
  it('returns null for a workout the user does not own', async () => {
    // Arrange — the ownership-scoped read matches nothing
    selectQueue.push([])

    // Act / Assert
    expect(await createWorkoutShare(VISITOR, WORKOUT_ID)).toBeNull()
    expect(inserts).toHaveLength(0)
  })

  it('refuses a live session with UnfinishedWorkoutShareError', async () => {
    // Arrange — owned but completedAt null: can() denies manage
    selectQueue.push([ownedRow({ completedAt: null })])

    // Act / Assert
    await expect(createWorkoutShare(OWNER, WORKOUT_ID)).rejects.toBeInstanceOf(
      UnfinishedWorkoutShareError,
    )
    expect(inserts).toHaveLength(0)
  })

  it('is idempotent: an existing live share is returned, no new token minted', async () => {
    // Arrange — owned + a live share already exists
    selectQueue.push([ownedRow()], [{ id: 'share-1', token: TOKEN }])

    // Act
    const result = await createWorkoutShare(OWNER, WORKOUT_ID)

    // Assert
    expect(result).toEqual({ id: 'share-1', token: TOKEN })
    expect(inserts).toHaveLength(0)
  })

  it('mints a well-shaped token when no live share exists', async () => {
    // Arrange — owned, no live share; the insert echoes what it received
    selectQueue.push([ownedRow()], [])
    insertReturningQueue.push([{ id: 'share-2', token: 'echoed-by-db' }])

    // Act
    const result = await createWorkoutShare(OWNER, WORKOUT_ID)

    // Assert — one insert into workout_shares with a 32-char base64url token
    expect(result).toEqual({ id: 'share-2', token: 'echoed-by-db' })
    expect(inserts).toHaveLength(1)
    expect(inserts[0].table).toBe(workoutShares)
    const values = inserts[0].values as { workoutId: string; token: string }
    expect(values.workoutId).toBe(WORKOUT_ID)
    expect(values.token).toMatch(TOKEN_SHAPE)
  })
})

describe('revokeWorkoutShare', () => {
  it('returns null when not owned and revokes nothing', async () => {
    // Arrange
    selectQueue.push([])

    // Act / Assert
    expect(await revokeWorkoutShare(VISITOR, WORKOUT_ID)).toBeNull()
    expect(updates).toHaveLength(0)
  })

  it('refuses a live session with UnfinishedWorkoutShareError', async () => {
    // Arrange
    selectQueue.push([ownedRow({ completedAt: null })])

    // Act / Assert
    await expect(revokeWorkoutShare(OWNER, WORKOUT_ID)).rejects.toBeInstanceOf(
      UnfinishedWorkoutShareError,
    )
    expect(updates).toHaveLength(0)
  })

  it('stamps revokedAt on live shares and reports the count', async () => {
    // Arrange
    selectQueue.push([ownedRow()])
    updateReturningQueue.push([{ id: 'share-1' }, { id: 'share-2' }])

    // Act
    const result = await revokeWorkoutShare(OWNER, WORKOUT_ID)

    // Assert
    expect(result).toEqual({ revoked: 2 })
    expect(updates).toHaveLength(1)
    expect(updates[0].table).toBe(workoutShares)
    expect((updates[0].values as { revokedAt: Date }).revokedAt).toBeInstanceOf(Date)
  })
})

describe('getActiveWorkoutShare', () => {
  it('returns the live token for the owner and null when none', async () => {
    // Arrange / Act / Assert
    selectQueue.push([{ token: TOKEN }])
    expect(await getActiveWorkoutShare(OWNER, WORKOUT_ID)).toEqual({ token: TOKEN })

    selectQueue.push([])
    expect(await getActiveWorkoutShare(OWNER, WORKOUT_ID)).toBeNull()
  })
})

describe('resolveWorkoutShare (the public read)', () => {
  it('returns null for an unknown token', async () => {
    // Arrange
    selectQueue.push([])

    // Act / Assert
    expect(await resolveWorkoutShare('tok_unknown')).toBeNull()
    expect(getWorkoutDetail).not.toHaveBeenCalled()
  })

  it.each([
    ['revoked share', shareRow({ revokedAt: new Date() })],
    ['live (unfinished) session', shareRow({ completedAt: null })],
  ])('returns the same constant-shape null for a %s', async (_label, row) => {
    // Arrange
    selectQueue.push([row])

    // Act / Assert — no distinguishing signal, and no content read happens
    expect(await resolveWorkoutShare(TOKEN)).toBeNull()
    expect(getWorkoutDetail).not.toHaveBeenCalled()
  })

  it('projects EXACTLY the summary fields — notes and provenance provably absent', async () => {
    // Arrange
    selectQueue.push([shareRow()])
    getWorkoutDetail.mockResolvedValue(detailRow())

    // Act
    const result = await resolveWorkoutShare(TOKEN)

    // Assert — the read runs under the OWNER's id…
    expect(getWorkoutDetail).toHaveBeenCalledWith(OWNER, WORKOUT_ID)
    expect(getExerciseHistoryBefore).toHaveBeenCalledWith(OWNER, [73, 91], STARTED)
    expect(result).not.toBeNull()

    // …and the result is shape-equal to the projection at EVERY level: any
    // field added to the detail read can never leak by accident.
    expect(Object.keys(result!).sort()).toEqual(['ownerUserId', 'prExerciseIds', 'workout'])
    expect(result!.workout).toEqual({
      id: WORKOUT_ID,
      name: 'Push A',
      startedAt: STARTED,
      completedAt: COMPLETED,
      exercises: [
        {
          id: 'ex-1',
          name: 'Bench Press',
          loggingType: 'weight_reps',
          skipped: false,
          sets: [
            {
              id: 'set-1',
              setNumber: 1,
              reps: 5,
              weight: 100,
              metricMode: 'reps_weight',
              durationSec: null,
              distanceM: null,
            },
          ],
        },
        {
          id: 'ex-2',
          name: 'Overhead Press',
          loggingType: 'weight_reps',
          skipped: true,
          sets: [],
        },
      ],
    })

    // The hard rule, stated as a search: the private strings appear NOWHERE
    // in anything the public page can reach.
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('private workout note')
    expect(serialized).not.toContain('private exercise note')
    expect(serialized).not.toContain('day-secret')
    expect(serialized).not.toContain('batch-secret')
  })

  it('badges a PR when the session beats prior history (owner history stays internal)', async () => {
    // Arrange — prior bench history with a LOWER best e1RM than today's set
    selectQueue.push([shareRow()])
    getWorkoutDetail.mockResolvedValue(detailRow())
    getExerciseHistoryBefore.mockResolvedValue([
      { wgerExerciseId: 73, source: 'wger', reps: 5, weight: 90, loggingType: 'weight_reps' },
    ])

    // Act
    const result = await resolveWorkoutShare(TOKEN)

    // Assert — ex-1 badges; ex-2 (no history, no sets) does not
    expect(result!.prExerciseIds).toEqual(['ex-1'])
  })

  it('claims no PR on a first-ever session (no prior baseline)', async () => {
    // Arrange
    selectQueue.push([shareRow()])
    getWorkoutDetail.mockResolvedValue(detailRow())

    // Act / Assert
    expect((await resolveWorkoutShare(TOKEN))!.prExerciseIds).toEqual([])
  })
})
