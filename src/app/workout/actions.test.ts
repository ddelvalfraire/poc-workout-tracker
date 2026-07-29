import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  saveWorkoutAction,
  updateWorkoutAction,
  deleteWorkoutAction,
  getLastPerformanceAction,
  getExerciseSheetAction,
  getExerciseBestAction,
  getWorkoutDraftAction,
  putWorkoutDraftAction,
  deleteWorkoutDraftAction,
} from './actions'
import { syncPlanToPerformanceAction } from './actions'
import { requireUserId } from '@/lib/auth'
import {
  saveWorkout,
  updateWorkout,
  deleteWorkout,
  getLastPerformance,
  getWorkoutDetail,
  latestCompletedWorkoutForDay,
} from '@/db/workouts'
import { getProgramDayDetail } from '@/db/programs'
import { syncProgramExerciseLoads } from '@/db/program-patches'
import { getWeightUnit } from '@/db/preferences'
import { getExerciseStats, getExerciseSessions } from '@/db/exercise-stats'
import { getWorkoutDraft, putWorkoutDraft, deleteWorkoutDraft } from '@/db/workout-drafts'
import { DRAFT_TTL_MS } from '@/app/workout/new/draft-payload'
import { revalidatePath } from 'next/cache'

/**
 * Action-layer tests for the ownership/not-found control flow. The DB helpers
 * (the real authorization boundary) are unit-tested separately in
 * `src/db/*.test.ts`; here we mock them and assert that the actions translate a
 * "no row" result into a thrown error and revalidate the right paths on success.
 * `parseWorkoutInput` runs for real (it's pure) with a minimal valid payload.
 */

vi.mock('@/lib/auth', () => ({ requireUserId: vi.fn() }))
vi.mock('@/db/workouts', () => ({
  saveWorkout: vi.fn(),
  updateWorkout: vi.fn(),
  deleteWorkout: vi.fn(),
  getLastPerformance: vi.fn(),
  getWorkoutDetail: vi.fn(),
  latestCompletedWorkoutForDay: vi.fn(),
}))
vi.mock('@/db/programs', () => ({
  getProgramDayDetail: vi.fn(),
  deriveDayPrescription: vi.fn(),
}))
vi.mock('@/db/program-patches', () => ({
  updateProgramExercise: vi.fn(),
  syncProgramExerciseLoads: vi.fn(),
}))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn() }))
vi.mock('@/db/exercise-stats', () => ({
  getExerciseStats: vi.fn(),
  getExerciseSessions: vi.fn(),
}))
vi.mock('@/db/workout-drafts', () => ({
  getWorkoutDraft: vi.fn(),
  putWorkoutDraft: vi.fn(),
  deleteWorkoutDraft: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const mockedRequireUserId = vi.mocked(requireUserId)
const mockedSave = vi.mocked(saveWorkout)
const mockedUpdate = vi.mocked(updateWorkout)
const mockedGetLast = vi.mocked(getLastPerformance)
const mockedGetStats = vi.mocked(getExerciseStats)
const mockedGetSessions = vi.mocked(getExerciseSessions)
const mockedDelete = vi.mocked(deleteWorkout)
const mockedGetDraft = vi.mocked(getWorkoutDraft)
const mockedPutDraft = vi.mocked(putWorkoutDraft)
const mockedDeleteDraft = vi.mocked(deleteWorkoutDraft)
const mockedRevalidate = vi.mocked(revalidatePath)
const mockedGetWorkoutDetail = vi.mocked(getWorkoutDetail)
const mockedLatestForDay = vi.mocked(latestCompletedWorkoutForDay)
const mockedGetDayDetail = vi.mocked(getProgramDayDetail)
const mockedSyncLoads = vi.mocked(syncProgramExerciseLoads)
const mockedGetUnit = vi.mocked(getWeightUnit)

const USER = 'user_123'
const ID = '11111111-1111-1111-1111-111111111111'
const VALID_INPUT = { exercises: [{ wgerExerciseId: 1, name: 'Plank', sets: [] }] }

beforeEach(() => {
  vi.clearAllMocks()
  mockedRequireUserId.mockResolvedValue(USER)
})

describe('saveWorkoutAction', () => {
  it('returns the id, deletes the new-surface draft, and revalidates home', async () => {
    // Arrange
    mockedSave.mockResolvedValue({ id: ID })

    // Act
    const result = await saveWorkoutAction(VALID_INPUT)

    // Assert
    expect(result).toEqual({ id: ID })
    expect(mockedSave).toHaveBeenCalledWith(USER, expect.objectContaining({ exercises: expect.any(Array) }))
    // The saved workout supersedes the /workout/new draft on every device.
    expect(mockedDeleteDraft).toHaveBeenCalledWith(USER, 'new')
    expect(mockedRevalidate).toHaveBeenCalledWith('/')
  })

  it('rejects malformed input before touching the database', async () => {
    // Act + Assert — no exercises fails parseWorkoutInput
    await expect(saveWorkoutAction({ exercises: [] })).rejects.toThrow()
    expect(mockedSave).not.toHaveBeenCalled()
    expect(mockedDeleteDraft).not.toHaveBeenCalled()
  })
})

describe('getLastPerformanceAction', () => {
  it('passes a valid exercise id through, dropping a non-string exclude', async () => {
    // Arrange
    mockedGetLast.mockResolvedValue(null)

    // Act
    await getLastPerformanceAction(73, 42 /* not a string → dropped */)

    // Assert
    expect(mockedGetLast).toHaveBeenCalledWith(USER, 'wger', 73, undefined)
  })

  it('forwards a string exclude id (edit mode must not report itself)', async () => {
    mockedGetLast.mockResolvedValue(null)

    await getLastPerformanceAction(73, ID)

    expect(mockedGetLast).toHaveBeenCalledWith(USER, 'wger', 73, ID)
  })

  it('rejects a non-integer or non-positive exercise id before touching the database', async () => {
    for (const bad of ['73', 0, -1, 1.5]) {
      await expect(getLastPerformanceAction(bad)).rejects.toThrow('invalid exercise id')
    }
    expect(mockedGetLast).not.toHaveBeenCalled()
  })

  it('forwards a custom source and rejects junk sources', async () => {
    mockedGetLast.mockResolvedValue(null)

    await getLastPerformanceAction(73, undefined, 'custom')
    expect(mockedGetLast).toHaveBeenCalledWith(USER, 'custom', 73, undefined)

    await expect(getLastPerformanceAction(73, undefined, 'homemade')).rejects.toThrow(
      /invalid exercise source/,
    )
  })
})

describe('getExerciseSheetAction', () => {
  const STATS = {
    exercise: { wgerExerciseId: 73, source: 'wger', name: 'Bench', loggingType: 'weight_reps' },
    totalSessions: 1,
    totalCompletedSets: 1,
    records: { bestE1rm: null, heaviestLoadKg: null, mostReps: null, bestSessionVolumeKg: null },
    trend: [],
  } as unknown as Awaited<ReturnType<typeof getExerciseStats>>

  it('reads stats and the recent sessions under the wger identity', async () => {
    // Arrange
    mockedGetStats.mockResolvedValue(STATS)
    mockedGetSessions.mockResolvedValue([])

    // Act
    const result = await getExerciseSheetAction(73)

    // Assert
    expect(mockedGetStats).toHaveBeenCalledWith(USER, 'wger', 73)
    expect(mockedGetSessions).toHaveBeenCalledWith(USER, 'wger', 73, { limit: 3, offset: 0 })
    expect(result).toEqual({ stats: STATS, recent: [] })
  })

  it('returns null when the exercise has no completed history', async () => {
    mockedGetStats.mockResolvedValue(null)
    mockedGetSessions.mockResolvedValue([])

    expect(await getExerciseSheetAction(73)).toBeNull()
  })

  it('rejects a non-integer or non-positive exercise id before touching the database', async () => {
    for (const bad of ['73', 0, -1, 1.5, null]) {
      await expect(getExerciseSheetAction(bad)).rejects.toThrow('invalid exercise id')
    }
    expect(mockedGetStats).not.toHaveBeenCalled()
    expect(mockedGetSessions).not.toHaveBeenCalled()
  })
})

describe('getExerciseBestAction', () => {
  it('returns the all-time best e1RM under the wger identity', async () => {
    mockedGetStats.mockResolvedValue({
      records: { bestE1rm: { e1rm: 122.5 } },
    } as unknown as Awaited<ReturnType<typeof getExerciseStats>>)

    expect(await getExerciseBestAction(73)).toBe(122.5)
    expect(mockedGetStats).toHaveBeenCalledWith(USER, 'wger', 73)
  })

  it('returns null when there is no history or no e1rm-scorable record', async () => {
    mockedGetStats.mockResolvedValue(null)
    expect(await getExerciseBestAction(73)).toBeNull()

    mockedGetStats.mockResolvedValue({
      records: { bestE1rm: null },
    } as unknown as Awaited<ReturnType<typeof getExerciseStats>>)
    expect(await getExerciseBestAction(73)).toBeNull()
  })

  it('rejects a non-integer or non-positive exercise id before touching the database', async () => {
    for (const bad of ['73', 0, -1, 1.5, null]) {
      await expect(getExerciseBestAction(bad)).rejects.toThrow('invalid exercise id')
    }
    expect(mockedGetStats).not.toHaveBeenCalled()
  })
})

describe('updateWorkoutAction', () => {
  it('returns the id and revalidates home + detail on success', async () => {
    // Arrange
    mockedUpdate.mockResolvedValue({ id: ID })

    // Act
    const result = await updateWorkoutAction(ID, VALID_INPUT)

    // Assert
    expect(result).toEqual({ id: ID })
    expect(mockedUpdate).toHaveBeenCalledWith(USER, ID, expect.objectContaining({ exercises: expect.any(Array) }))
    // The saved edit supersedes this workout's cross-device draft.
    expect(mockedDeleteDraft).toHaveBeenCalledWith(USER, ID)
    expect(mockedRevalidate).toHaveBeenCalledWith('/')
    expect(mockedRevalidate).toHaveBeenCalledWith(`/workout/${ID}`)
  })

  it('throws and does not revalidate when the workout is not owned', async () => {
    // Arrange — repo signals "not owned (or gone)" with null
    mockedUpdate.mockResolvedValue(null)

    // Act + Assert
    await expect(updateWorkoutAction(ID, VALID_INPUT)).rejects.toThrow('workout not found')
    expect(mockedRevalidate).not.toHaveBeenCalled()
  })

  it('rejects malformed input before touching the database', async () => {
    // Act + Assert — no exercises fails parseWorkoutInput
    await expect(updateWorkoutAction(ID, { exercises: [] })).rejects.toThrow()
    expect(mockedUpdate).not.toHaveBeenCalled()
  })
})

describe('deleteWorkoutAction', () => {
  it('revalidates home when an owned row is deleted', async () => {
    // Arrange — deleteWorkout returns the deleted row(s)
    mockedDelete.mockResolvedValue([{ id: ID }] as Awaited<ReturnType<typeof deleteWorkout>>)

    // Act
    await deleteWorkoutAction(ID)

    // Assert — the workout's draft goes with it, or the home banner would
    // keep advertising a session whose Resume 404s
    expect(mockedDelete).toHaveBeenCalledWith(USER, ID)
    expect(mockedDeleteDraft).toHaveBeenCalledWith(USER, ID)
    expect(mockedRevalidate).toHaveBeenCalledWith('/')
  })

  it('throws and does not revalidate when nothing was deleted', async () => {
    // Arrange — empty result means not owned (or already gone)
    mockedDelete.mockResolvedValue([] as Awaited<ReturnType<typeof deleteWorkout>>)

    // Act + Assert — no draft cleanup either: ownership failed
    await expect(deleteWorkoutAction(ID)).rejects.toThrow('workout not found')
    expect(mockedDeleteDraft).not.toHaveBeenCalled()
    expect(mockedRevalidate).not.toHaveBeenCalled()
  })
})

/** A structurally valid draft payload (one exercise, one set). */
const DRAFT_PAYLOAD = {
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
        sets: [{ id: 's1', reps: '5', weight: '100', completed: false }],
      },
    ],
  },
}

describe('getWorkoutDraftAction', () => {
  it('returns the stored payload for a fresh draft', async () => {
    mockedGetDraft.mockResolvedValue({ payload: DRAFT_PAYLOAD, updatedAt: new Date() })

    expect(await getWorkoutDraftAction('new')).toEqual(DRAFT_PAYLOAD)
    expect(mockedGetDraft).toHaveBeenCalledWith(USER, 'new')
  })

  it('returns null when no draft exists', async () => {
    mockedGetDraft.mockResolvedValue(undefined)

    expect(await getWorkoutDraftAction(ID)).toBeNull()
  })

  it('lazily deletes and nulls an expired draft (TTL vs updated_at)', async () => {
    // Arrange — last touched just past the TTL
    mockedGetDraft.mockResolvedValue({
      payload: DRAFT_PAYLOAD,
      updatedAt: new Date(Date.now() - DRAFT_TTL_MS - 1_000),
    })

    // Act + Assert
    expect(await getWorkoutDraftAction('new')).toBeNull()
    expect(mockedDeleteDraft).toHaveBeenCalledWith(USER, 'new')
  })

  it('rejects a malformed key before touching the database', async () => {
    await expect(getWorkoutDraftAction('../etc')).rejects.toThrow('invalid draft key')
    expect(mockedGetDraft).not.toHaveBeenCalled()
  })
})

describe('putWorkoutDraftAction', () => {
  it('upserts a structurally valid payload', async () => {
    await putWorkoutDraftAction('new', DRAFT_PAYLOAD)

    expect(mockedPutDraft).toHaveBeenCalledWith(USER, 'new', DRAFT_PAYLOAD)
  })

  it('rejects an invalid payload before touching the database', async () => {
    await expect(putWorkoutDraftAction('new', { v: 1, junk: true })).rejects.toThrow(
      'invalid draft payload',
    )
    expect(mockedPutDraft).not.toHaveBeenCalled()
  })

  it('normalizes key case before storing', async () => {
    await putWorkoutDraftAction('NEW', DRAFT_PAYLOAD)
    expect(mockedPutDraft).toHaveBeenCalledWith(USER, 'new', DRAFT_PAYLOAD)
  })

  it('rejects an oversized payload', async () => {
    // Arrange — inflate the name past the 32 KB serialized cap
    const oversized = { ...DRAFT_PAYLOAD, name: 'x'.repeat(40_000) }

    // Act + Assert
    await expect(putWorkoutDraftAction('new', oversized)).rejects.toThrow('draft payload too large')
    expect(mockedPutDraft).not.toHaveBeenCalled()
  })
})

describe('deleteWorkoutDraftAction', () => {
  it('deletes by validated key', async () => {
    await deleteWorkoutDraftAction(ID)
    expect(mockedDeleteDraft).toHaveBeenCalledWith(USER, ID)
  })

  it('normalizes key case so one session cannot mint two surfaces', async () => {
    await deleteWorkoutDraftAction(ID.toUpperCase())
    expect(mockedDeleteDraft).toHaveBeenCalledWith(USER, ID)
  })

  it('rejects a malformed key', async () => {
    await expect(deleteWorkoutDraftAction('nope!')).rejects.toThrow('invalid draft key')
    expect(mockedDeleteDraft).not.toHaveBeenCalled()
  })
})

describe('syncPlanToPerformanceAction', () => {
  // A completed program workout that beat the plan (80 → 120 on both sets).
  const WORKOUT = {
    id: ID,
    programDayId: 'pd1',
    completedAt: new Date('2026-07-01T11:00:00Z'),
    exercises: [
      {
        wgerExerciseId: 73,
        source: 'wger',
        loggingType: 'weight_reps',
        skipped: false,
        sets: [
          { setNumber: 1, reps: 12, weight: 120, completed: true, setType: 'working' },
          { setNumber: 2, reps: 12, weight: 120, completed: true, setType: 'working' },
        ],
      },
    ],
  } as unknown as Awaited<ReturnType<typeof getWorkoutDetail>>

  const DAY = {
    position: 2,
    program: { id: 'pid-1' },
    exercises: [
      {
        position: 0,
        wgerExerciseId: 73,
        source: 'wger',
        name: 'Leg Extension',
        sets: [
          { setNumber: 1, setType: 'working', metricMode: 'reps_weight', repMin: 12, suggestedLoadKg: 80 },
          { setNumber: 2, setType: 'working', metricMode: 'reps_weight', repMin: 12, suggestedLoadKg: 80 },
        ],
      },
    ],
  } as unknown as Awaited<ReturnType<typeof getProgramDayDetail>>

  function arrangeHappyPath() {
    mockedGetWorkoutDetail.mockResolvedValue(WORKOUT)
    mockedLatestForDay.mockReturnValue(
      Promise.resolve([{ id: ID }]) as unknown as ReturnType<typeof latestCompletedWorkoutForDay>,
    )
    mockedGetDayDetail.mockResolvedValue(DAY)
    mockedGetUnit.mockResolvedValue('kg')
    mockedSyncLoads.mockResolvedValue({ updated: 2 })
  }

  it('recomputes candidates server-side and applies one narrow patch per exercise', async () => {
    // Arrange
    arrangeHappyPath()

    // Act
    const result = await syncPlanToPerformanceAction(ID)

    // Assert — the patch got the SERVER-computed loads, actor 'ui', unit-aware summary.
    expect(result).toEqual({ syncedExercises: 1 })
    expect(mockedSyncLoads).toHaveBeenCalledTimes(1)
    expect(mockedSyncLoads).toHaveBeenCalledWith(
      USER,
      'pid-1',
      2,
      0,
      [
        { setNumber: 1, suggestedLoadKg: 120 },
        { setNumber: 2, suggestedLoadKg: 120 },
      ],
      'ui',
      'Leg Extension: 80 → 120 kg (synced to performance)',
    )
    expect(mockedRevalidate).toHaveBeenCalledWith('/programs')
    expect(mockedRevalidate).toHaveBeenCalledWith('/programs/pid-1')
    expect(mockedRevalidate).toHaveBeenCalledWith(`/workout/${ID}`)
  })

  it('rejects a malformed workout id before touching the database', async () => {
    await expect(syncPlanToPerformanceAction(42)).rejects.toThrow('invalid workout id')
    expect(mockedGetWorkoutDetail).not.toHaveBeenCalled()
  })

  it('throws when the workout is not owned/found', async () => {
    mockedGetWorkoutDetail.mockResolvedValue(undefined)

    await expect(syncPlanToPerformanceAction(ID)).rejects.toThrow('workout not found')
    expect(mockedSyncLoads).not.toHaveBeenCalled()
  })

  it('throws when the workout has no program provenance', async () => {
    mockedGetWorkoutDetail.mockResolvedValue({
      ...(WORKOUT as object),
      programDayId: null,
    } as typeof WORKOUT)

    await expect(syncPlanToPerformanceAction(ID)).rejects.toThrow('workout has no program')
    expect(mockedSyncLoads).not.toHaveBeenCalled()
  })

  it('throws when the workout is not finished', async () => {
    mockedGetWorkoutDetail.mockResolvedValue({
      ...(WORKOUT as object),
      completedAt: null,
    } as typeof WORKOUT)

    await expect(syncPlanToPerformanceAction(ID)).rejects.toThrow('workout is not finished')
    expect(mockedSyncLoads).not.toHaveBeenCalled()
  })

  it('throws when a newer completed session exists for the day (stale summaries must not regress the plan)', async () => {
    mockedGetWorkoutDetail.mockResolvedValue(WORKOUT)
    mockedLatestForDay.mockReturnValue(
      Promise.resolve([{ id: 'newer-workout' }]) as unknown as ReturnType<
        typeof latestCompletedWorkoutForDay
      >,
    )

    await expect(syncPlanToPerformanceAction(ID)).rejects.toThrow(
      'a newer session exists for this day',
    )
    expect(mockedSyncLoads).not.toHaveBeenCalled()
  })

  it('throws when the program day no longer exists', async () => {
    mockedGetWorkoutDetail.mockResolvedValue(WORKOUT)
    mockedLatestForDay.mockReturnValue(
      Promise.resolve([{ id: ID }]) as unknown as ReturnType<typeof latestCompletedWorkoutForDay>,
    )
    mockedGetDayDetail.mockResolvedValue(null)

    await expect(syncPlanToPerformanceAction(ID)).rejects.toThrow('program day not found')
    expect(mockedSyncLoads).not.toHaveBeenCalled()
  })

  it('is a no-op (no patch, no revalidate) when the plan already matches — idempotent re-run', async () => {
    arrangeHappyPath()
    // The plan already carries the performed loads: nothing to sync.
    mockedGetDayDetail.mockResolvedValue({
      ...(DAY as object),
      exercises: [
        {
          ...(DAY as unknown as { exercises: { sets: unknown[] }[] }).exercises[0],
          sets: [
            { setNumber: 1, setType: 'working', metricMode: 'reps_weight', repMin: 12, suggestedLoadKg: 120 },
            { setNumber: 2, setType: 'working', metricMode: 'reps_weight', repMin: 12, suggestedLoadKg: 120 },
          ],
        },
      ],
    } as typeof DAY)

    const result = await syncPlanToPerformanceAction(ID)

    expect(result).toEqual({ syncedExercises: 0 })
    expect(mockedSyncLoads).not.toHaveBeenCalled()
    expect(mockedRevalidate).not.toHaveBeenCalled()
  })

  it('counts only exercises whose patch actually changed rows', async () => {
    arrangeHappyPath()
    // The slot vanished between render and confirm: patch reports not-found.
    mockedSyncLoads.mockResolvedValue(null)

    const result = await syncPlanToPerformanceAction(ID)

    expect(result).toEqual({ syncedExercises: 0 })
  })
})
