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
  rememberSwapAction,
} from './actions'
import { requireUserId } from '@/lib/auth'
import {
  saveWorkout,
  updateWorkout,
  deleteWorkout,
  getLastPerformance,
  getWorkoutDetail,
  hasAnyCompletedWorkout,
  getWorkoutAnalyticsState,
} from '@/db/workouts'
import { captureServerEvent } from '@/lib/analytics'
import { getProgramDayDetail } from '@/db/programs'
import { substituteProgramExercise } from '@/db/program-patches'
import { autoSyncPlanToPerformance } from '@/lib/auto-plan-sync'
import { checkTrophies } from '@/lib/trophies'
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
  // Analytics pre-reads: resolve to "user has history / workout unknown" so
  // no event fires unless a test arranges otherwise.
  hasAnyCompletedWorkout: vi.fn(async () => true),
  getWorkoutAnalyticsState: vi.fn(async () => null),
}))
vi.mock('@/lib/analytics', async (importOriginal) => ({
  // Keep the pure prop builders real; only the transport is stubbed.
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  captureServerEvent: vi.fn(async () => {}),
}))
vi.mock('@/db/programs', () => ({
  getProgramDayDetail: vi.fn(),
}))
vi.mock('@/db/prescriptions', () => ({ deriveDayPrescription: vi.fn() }))
vi.mock('@/db/program-patches', () => ({
  updateProgramExercise: vi.fn(),
  substituteProgramExercise: vi.fn(),
}))
// The auto-sync helper is unit-tested in lib/auto-plan-sync.test.ts; here we
// only assert the actions invoke it at the right seam.
vi.mock('@/lib/auto-plan-sync', () => ({ autoSyncPlanToPerformance: vi.fn() }))
// Same treatment for the trophy seam (unit-tested in lib/trophies.test.ts):
// assert only that the actions fire it with the live-finish trigger.
vi.mock('@/lib/trophies', () => ({ checkTrophies: vi.fn(async () => []) }))
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
const mockedAutoSync = vi.mocked(autoSyncPlanToPerformance)
const mockedCheckTrophies = vi.mocked(checkTrophies)

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
    // Auto plan-sync runs against the saved workout (a no-op for quick logs —
    // the helper's provenance guard — but the seam must always fire).
    expect(mockedAutoSync).toHaveBeenCalledWith(USER, ID)
    // The trophy seam rides the same post-save moment with the live-finish
    // trigger (attribution + retroactive-quiet live inside the helper).
    expect(mockedCheckTrophies).toHaveBeenCalledWith(USER, { kind: 'finish', workoutId: ID })
    expect(mockedRevalidate).toHaveBeenCalledWith('/')
  })

  it('rejects malformed input before touching the database', async () => {
    // Act + Assert — no exercises fails parseWorkoutInput
    await expect(saveWorkoutAction({ exercises: [] })).rejects.toThrow()
    expect(mockedSave).not.toHaveBeenCalled()
    expect(mockedDeleteDraft).not.toHaveBeenCalled()
  })

  it('fires workout_completed with is_first from the pre-save read', async () => {
    // Arrange — no completed history yet, so this save is the activation event
    mockedSave.mockResolvedValue({ id: ID })
    vi.mocked(hasAnyCompletedWorkout).mockResolvedValueOnce(false)

    // Act
    await saveWorkoutAction(VALID_INPUT)

    // Assert — capture is fire-and-forget (a microtask behind the action), so
    // wait for it rather than asserting synchronously.
    await vi.waitFor(() => {
      expect(vi.mocked(captureServerEvent)).toHaveBeenCalledWith(
        USER,
        expect.objectContaining({
          name: 'workout_completed',
          properties: expect.objectContaining({ is_first: true }),
        }),
      )
    })
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
    // The finish path: a live program session completes through this action,
    // and the plan silently adopts outperformed loads right here.
    expect(mockedAutoSync).toHaveBeenCalledWith(USER, ID)
    // Live program finishes celebrate through this path — same trigger shape
    // as the save action.
    expect(mockedCheckTrophies).toHaveBeenCalledWith(USER, { kind: 'finish', workoutId: ID })
    expect(mockedRevalidate).toHaveBeenCalledWith('/')
    expect(mockedRevalidate).toHaveBeenCalledWith(`/workout/${ID}`)
  })

  it('fires workout_completed when the edit is the completing one', async () => {
    // Arrange — pre-read says the session was still in progress
    mockedUpdate.mockResolvedValue({ id: ID })
    vi.mocked(getWorkoutAnalyticsState).mockResolvedValueOnce({
      startedAt: new Date('2026-01-01T10:00:00Z'),
      completedAt: null,
      setCount: 3,
    })

    // Act
    await updateWorkoutAction(ID, VALID_INPUT)

    // Assert — fire-and-forget, so wait for the microtask
    await vi.waitFor(() => {
      expect(vi.mocked(captureServerEvent)).toHaveBeenCalledWith(
        USER,
        expect.objectContaining({ name: 'workout_completed' }),
      )
    })
  })

  it('does not fire workout_completed when the workout was already completed', async () => {
    // Arrange — pre-read says completion happened on an earlier edit
    mockedUpdate.mockResolvedValue({ id: ID })
    vi.mocked(getWorkoutAnalyticsState).mockResolvedValueOnce({
      startedAt: new Date('2026-01-01T10:00:00Z'),
      completedAt: new Date('2026-01-01T11:00:00Z'),
      setCount: 3,
    })

    // Act
    await updateWorkoutAction(ID, VALID_INPUT)
    // Give the void capture chain its microtask before asserting the negative.
    await new Promise((r) => setTimeout(r, 0))

    // Assert
    expect(vi.mocked(captureServerEvent)).not.toHaveBeenCalled()
  })

  it('throws and does not revalidate when the workout is not owned', async () => {
    // Arrange — repo signals "not owned (or gone)" with null
    mockedUpdate.mockResolvedValue(null)

    // Act + Assert — no auto-sync either: nothing was written
    await expect(updateWorkoutAction(ID, VALID_INPUT)).rejects.toThrow('workout not found')
    expect(mockedAutoSync).not.toHaveBeenCalled()
    expect(mockedCheckTrophies).not.toHaveBeenCalled()
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

  it('fires workout_abandoned when deleting a never-completed session', async () => {
    // Arrange — in-progress session with 3 sets logged
    mockedDelete.mockResolvedValue([{ id: ID }] as Awaited<ReturnType<typeof deleteWorkout>>)
    vi.mocked(getWorkoutAnalyticsState).mockResolvedValueOnce({
      startedAt: new Date(Date.now() - 10 * 60_000),
      completedAt: null,
      setCount: 3,
    })

    // Act
    await deleteWorkoutAction(ID)

    // Assert
    await vi.waitFor(() => {
      expect(vi.mocked(captureServerEvent)).toHaveBeenCalledWith(
        USER,
        expect.objectContaining({
          name: 'workout_abandoned',
          properties: expect.objectContaining({ set_count_logged: 3 }),
        }),
      )
    })
  })

  it('does not fire workout_abandoned when deleting completed history', async () => {
    // Arrange — deleting an old logged session is history management
    mockedDelete.mockResolvedValue([{ id: ID }] as Awaited<ReturnType<typeof deleteWorkout>>)
    vi.mocked(getWorkoutAnalyticsState).mockResolvedValueOnce({
      startedAt: new Date('2026-01-01T10:00:00Z'),
      completedAt: new Date('2026-01-01T11:00:00Z'),
      setCount: 12,
    })

    // Act
    await deleteWorkoutAction(ID)
    await new Promise((r) => setTimeout(r, 0))

    // Assert
    expect(vi.mocked(captureServerEvent)).not.toHaveBeenCalled()
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


describe('rememberSwapAction', () => {
  const DAY = {
    id: 'day-1',
    position: 2,
    program: { id: 'prog-1' },
    exercises: [{ wgerExerciseId: 1706, source: 'wger', position: 1 }],
  }

  function armHappyPath() {
    vi.mocked(getWorkoutDetail).mockResolvedValue({
      id: ID,
      programDayId: 'day-1',
    } as never)
    vi.mocked(getProgramDayDetail).mockResolvedValue(DAY as never)
    vi.mocked(substituteProgramExercise).mockResolvedValue({ id: 'pe-1' } as never)
  }

  it('patches the slot identity and does NOT revalidate any path (#214)', async () => {
    // Arrange
    armHappyPath()

    // Act
    await rememberSwapAction(ID, 1706, { wgerExerciseId: 4, name: 'Elevated Lunge', source: 'custom' }, 'wger')

    // Assert — the write lands on the resolved slot…
    expect(vi.mocked(substituteProgramExercise)).toHaveBeenCalledWith(
      USER,
      'prog-1',
      2,
      1,
      { wgerExerciseId: 4, source: 'custom', name: 'Elevated Lunge' },
      'ui',
    )
    // …and no revalidation fires mid-session: a Server-Action revalidatePath
    // re-renders the CURRENT route too, which is the #214 full-reload jank.
    expect(mockedRevalidate).not.toHaveBeenCalled()
  })

  it('throws when the slot is gone and still never revalidates', async () => {
    armHappyPath()
    vi.mocked(getProgramDayDetail).mockResolvedValue({ ...DAY, exercises: [] } as never)

    await expect(
      rememberSwapAction(ID, 1706, { wgerExerciseId: 4, name: 'X', source: 'custom' }, 'wger'),
    ).rejects.toThrow('exercise not found in program')
    expect(mockedRevalidate).not.toHaveBeenCalled()
  })
})
