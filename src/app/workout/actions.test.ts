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
import { requireUserId } from '@/lib/auth'
import { saveWorkout, updateWorkout, deleteWorkout, getLastPerformance } from '@/db/workouts'
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
}))
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
