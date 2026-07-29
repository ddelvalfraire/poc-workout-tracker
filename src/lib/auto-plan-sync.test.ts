import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { autoSyncPlanToPerformance } from './auto-plan-sync'
import { getWorkoutDetail, latestCompletedWorkoutForDay } from '@/db/workouts'
import { getProgramDayDetail } from '@/db/programs'
import { syncProgramExerciseLoads } from '@/db/program-patches'
import { getWeightUnit } from '@/db/preferences'
import { revalidatePath } from 'next/cache'

/**
 * Unit tests for the automatic plan-sync pipeline. The detector and the
 * narrow patch are unit-tested in lib/plan-sync.test.ts and
 * db/program-patches.test.ts; here we mock them at the module boundary and
 * assert the pipeline's guards (silent no-ops), the patch/event wiring, and —
 * critically — that a failing sync NEVER rejects: the workout save that
 * triggered it is the fact, and the helper's contract is "resolves, always".
 */

vi.mock('@/db/workouts', () => ({
  getWorkoutDetail: vi.fn(),
  latestCompletedWorkoutForDay: vi.fn(),
}))
vi.mock('@/db/programs', () => ({ getProgramDayDetail: vi.fn() }))
vi.mock('@/db/program-patches', () => ({ syncProgramExerciseLoads: vi.fn() }))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const mockedGetWorkoutDetail = vi.mocked(getWorkoutDetail)
const mockedLatestForDay = vi.mocked(latestCompletedWorkoutForDay)
const mockedGetDayDetail = vi.mocked(getProgramDayDetail)
const mockedSyncLoads = vi.mocked(syncProgramExerciseLoads)
const mockedGetUnit = vi.mocked(getWeightUnit)
const mockedRevalidate = vi.mocked(revalidatePath)

const USER = 'user_123'
const ID = '11111111-1111-1111-1111-111111111111'

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
  program: { id: 'pid-1', planSync: true },
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

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  // The fail-soft path logs; keep test output clean and assert on it.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('autoSyncPlanToPerformance', () => {
  it('applies one narrow patch per outperformed exercise, actor ui, with the change-log summary', async () => {
    // Arrange
    arrangeHappyPath()

    // Act
    await autoSyncPlanToPerformance(USER, ID)

    // Assert — server-computed loads, one event-writing patch, program pages refreshed.
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
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('no-ops silently for a quick log (no program provenance)', async () => {
    mockedGetWorkoutDetail.mockResolvedValue({
      ...(WORKOUT as object),
      programDayId: null,
    } as typeof WORKOUT)

    await autoSyncPlanToPerformance(USER, ID)

    expect(mockedLatestForDay).not.toHaveBeenCalled()
    expect(mockedSyncLoads).not.toHaveBeenCalled()
    expect(mockedRevalidate).not.toHaveBeenCalled()
  })

  it('no-ops silently when the workout is missing or not yet completed', async () => {
    mockedGetWorkoutDetail.mockResolvedValue(undefined)
    await autoSyncPlanToPerformance(USER, ID)

    mockedGetWorkoutDetail.mockResolvedValue({
      ...(WORKOUT as object),
      completedAt: null,
    } as typeof WORKOUT)
    await autoSyncPlanToPerformance(USER, ID)

    expect(mockedSyncLoads).not.toHaveBeenCalled()
  })

  it('no-ops when a newer completed session exists for the day (stale edits must not regress the plan)', async () => {
    mockedGetWorkoutDetail.mockResolvedValue(WORKOUT)
    mockedLatestForDay.mockReturnValue(
      Promise.resolve([{ id: 'newer-workout' }]) as unknown as ReturnType<
        typeof latestCompletedWorkoutForDay
      >,
    )

    await autoSyncPlanToPerformance(USER, ID)

    expect(mockedGetDayDetail).not.toHaveBeenCalled()
    expect(mockedSyncLoads).not.toHaveBeenCalled()
  })

  it('no-ops when the program opted out (planSync false) — deliberate-percentage plans stay put', async () => {
    arrangeHappyPath()
    mockedGetDayDetail.mockResolvedValue({
      ...(DAY as object),
      program: { id: 'pid-1', planSync: false },
    } as typeof DAY)

    await autoSyncPlanToPerformance(USER, ID)

    expect(mockedSyncLoads).not.toHaveBeenCalled()
    expect(mockedRevalidate).not.toHaveBeenCalled()
  })

  it('no-ops when the program day no longer exists', async () => {
    mockedGetWorkoutDetail.mockResolvedValue(WORKOUT)
    mockedLatestForDay.mockReturnValue(
      Promise.resolve([{ id: ID }]) as unknown as ReturnType<typeof latestCompletedWorkoutForDay>,
    )
    mockedGetDayDetail.mockResolvedValue(null)

    await autoSyncPlanToPerformance(USER, ID)

    expect(mockedSyncLoads).not.toHaveBeenCalled()
  })

  it('is idempotent: an already-synced plan produces no patch and no revalidate', async () => {
    arrangeHappyPath()
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

    await autoSyncPlanToPerformance(USER, ID)

    expect(mockedSyncLoads).not.toHaveBeenCalled()
    expect(mockedRevalidate).not.toHaveBeenCalled()
  })

  it('skips revalidation when the patch reports the slot vanished (nothing changed)', async () => {
    arrangeHappyPath()
    mockedSyncLoads.mockResolvedValue(null)

    await autoSyncPlanToPerformance(USER, ID)

    expect(mockedRevalidate).not.toHaveBeenCalled()
  })

  it('NEVER rejects when the patch throws — the workout save must survive; the failure is logged', async () => {
    arrangeHappyPath()
    mockedSyncLoads.mockRejectedValue(new Error('db down'))

    await expect(autoSyncPlanToPerformance(USER, ID)).resolves.toBeUndefined()

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'auto plan-sync failed (workout saved; plan left unchanged)',
      expect.any(Error),
    )
  })

  it('NEVER rejects when even the first read throws', async () => {
    mockedGetWorkoutDetail.mockRejectedValue(new Error('db down'))

    await expect(autoSyncPlanToPerformance(USER, ID)).resolves.toBeUndefined()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })
})
