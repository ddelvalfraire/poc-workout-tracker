import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateWorkoutAction, deleteWorkoutAction } from './actions'
import { requireUserId } from '@/lib/auth'
import { updateWorkout, deleteWorkout } from '@/db/workouts'
import { revalidatePath } from 'next/cache'

/**
 * Action-layer tests for the ownership/not-found control flow. The DB helpers
 * (the real authorization boundary) are unit-tested separately in
 * `src/db/*.test.ts`; here we mock them and assert that the actions translate a
 * "no row" result into a thrown error and revalidate the right paths on success.
 * `parseWorkoutInput` runs for real (it's pure) with a minimal valid payload.
 */

vi.mock('@/lib/auth', () => ({ requireUserId: vi.fn() }))
vi.mock('@/db/workouts', () => ({ updateWorkout: vi.fn(), deleteWorkout: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const mockedRequireUserId = vi.mocked(requireUserId)
const mockedUpdate = vi.mocked(updateWorkout)
const mockedDelete = vi.mocked(deleteWorkout)
const mockedRevalidate = vi.mocked(revalidatePath)

const USER = 'user_123'
const ID = '11111111-1111-1111-1111-111111111111'
const VALID_INPUT = { exercises: [{ wgerExerciseId: 1, name: 'Plank', sets: [] }] }

beforeEach(() => {
  vi.clearAllMocks()
  mockedRequireUserId.mockResolvedValue(USER)
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

    // Assert
    expect(mockedDelete).toHaveBeenCalledWith(USER, ID)
    expect(mockedRevalidate).toHaveBeenCalledWith('/')
  })

  it('throws and does not revalidate when nothing was deleted', async () => {
    // Arrange — empty result means not owned (or already gone)
    mockedDelete.mockResolvedValue([] as Awaited<ReturnType<typeof deleteWorkout>>)

    // Act + Assert
    await expect(deleteWorkoutAction(ID)).rejects.toThrow('workout not found')
    expect(mockedRevalidate).not.toHaveBeenCalled()
  })
})
