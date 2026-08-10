import { describe, it, expect, vi, beforeEach } from 'vitest'

const { detailMock, weekStateMock, deriveMock } = vi.hoisted(() => ({
  detailMock: vi.fn(),
  weekStateMock: vi.fn(),
  deriveMock: vi.fn(),
}))

vi.mock('./programs', () => ({
  getProgramDetail: detailMock,
  programWeekState: weekStateMock,
  deriveDayPrescription: deriveMock,
}))

import { restartTmPlan } from './restart-plan'

const USER = 'user_123'
const PID = '22222222-2222-4222-8222-222222222222'

const AMRAP = { scheme: 'amrap-cycle', trainingMaxKg: 140, incrementKg: 2.5, wave: [[0.85]] }

const detail = () => ({
  id: PID,
  userId: USER,
  status: 'active',
  mesocycleWeeks: 4,
  deloadWeek: 4,
  autoregulation: true,
  autoregStallPolicy: 'all-sets',
  deloadPolicy: null,
  days: [
    { exercises: [{ name: 'Squat', progression: AMRAP }] },
    { exercises: [{ name: 'Bench', progression: { ...AMRAP, trainingMaxKg: 100 } }] },
  ],
})

beforeEach(() => {
  vi.clearAllMocks()
  detailMock.mockResolvedValue(detail())
  weekStateMock.mockResolvedValue({ currentWeek: 3, blockComplete: true })
})

describe('restartTmPlan', () => {
  it('derives EVERY day at the current week and splits flags from increments', async () => {
    // Arrange — Squat flagged (M4), Bench clean
    deriveMock
      .mockResolvedValueOnce([{ autoreg: { action: 'flag' } }])
      .mockResolvedValueOnce([{ autoreg: null }])

    // Act
    const plan = await restartTmPlan(USER, PID)

    // Assert — both days derived (no collapsed-day skipping here)
    expect(deriveMock).toHaveBeenCalledTimes(2)
    expect(deriveMock).toHaveBeenNthCalledWith(
      1,
      USER,
      expect.objectContaining({
        program: expect.objectContaining({ id: PID, mesocycleWeeks: 4 }),
      }),
      3, // the CURRENT week
    )
    expect(plan).toEqual({
      flags: [{ exerciseName: 'Squat', dayPosition: 0, exercisePosition: 0, currentTmKg: 140 }],
      increments: [
        { exerciseName: 'Bench', dayPosition: 1, exercisePosition: 0, fromKg: 100, toKg: 102.5 },
      ],
    })
  })

  it('returns every increment on a clean block (no flags anywhere)', async () => {
    deriveMock.mockResolvedValue([{ autoreg: null }])
    const plan = await restartTmPlan(USER, PID)
    expect(plan?.flags).toEqual([])
    expect(plan?.increments.map((i) => i.exerciseName)).toEqual(['Squat', 'Bench'])
  })

  it('returns null when the program is not owned (no derivation runs)', async () => {
    detailMock.mockResolvedValue(undefined)
    expect(await restartTmPlan(USER, PID)).toBeNull()
    expect(deriveMock).not.toHaveBeenCalled()
  })
})
