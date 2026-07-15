import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCustomExerciseAction, updateCustomExerciseAction } from './actions'
import { requireUserId } from '@/lib/auth'
import { createCustomExercise, updateCustomExercise } from '@/db/custom-exercises'

/**
 * Action-boundary tests (the workout actions convention): db helpers are
 * mocked — their own suites own the SQL — and these assert validation,
 * ownership translation, and the duplicate-name mapping.
 */

vi.mock('@/lib/auth', () => ({ requireUserId: vi.fn() }))
vi.mock('@/db/custom-exercises', () => ({
  createCustomExercise: vi.fn(),
  updateCustomExercise: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const mockedRequireUserId = vi.mocked(requireUserId)
const mockedCreate = vi.mocked(createCustomExercise)
const mockedUpdate = vi.mocked(updateCustomExercise)

const USER = 'user_123'
const ROW = {
  id: 7,
  userId: USER,
  name: 'Cable Face Pull',
  category: 'Shoulders',
  equipment: null,
  muscles: ['Shoulders'],
  musclesSecondary: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as Awaited<ReturnType<typeof createCustomExercise>>

beforeEach(() => {
  vi.clearAllMocks()
  mockedRequireUserId.mockResolvedValue(USER)
})

describe('createCustomExerciseAction', () => {
  it('validates via the schema and returns the UI subset', async () => {
    mockedCreate.mockResolvedValue(ROW)

    const result = await createCustomExerciseAction({
      name: 'Cable Face Pull',
      category: 'Shoulders',
      muscles: ['Shoulders'],
    })

    expect(mockedCreate).toHaveBeenCalledWith(USER, {
      name: 'Cable Face Pull',
      category: 'Shoulders',
      muscles: ['Shoulders'],
    })
    expect(result).toEqual({
      id: 7,
      name: 'Cable Face Pull',
      category: 'Shoulders',
      muscles: ['Shoulders'],
      musclesSecondary: [],
    })
  })

  it('rejects a bad category before touching the database', async () => {
    await expect(createCustomExerciseAction({ name: 'X', category: 'Yoga' })).rejects.toThrow()
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('translates the unique-name violation into a human sentence', async () => {
    mockedCreate.mockRejectedValue(
      new Error(
        'duplicate key value violates unique constraint "custom_exercises_user_name_unique"',
      ),
    )

    await expect(
      createCustomExerciseAction({ name: 'Cable Face Pull', category: 'Shoulders' }),
    ).rejects.toThrow('You already have a custom exercise with this name.')
  })
})

describe('updateCustomExerciseAction', () => {
  it('throws not-found when the exercise is not owned', async () => {
    mockedUpdate.mockResolvedValue(null)

    await expect(
      updateCustomExerciseAction(7, { name: 'X', category: 'Shoulders' }),
    ).rejects.toThrow('custom exercise not found')
  })

  it('rejects a non-integer id before validating input', async () => {
    await expect(
      updateCustomExerciseAction('7', { name: 'X', category: 'Shoulders' }),
    ).rejects.toThrow('invalid exercise id')
    expect(mockedUpdate).not.toHaveBeenCalled()
  })

  it('passes the full-field input through on success', async () => {
    mockedUpdate.mockResolvedValue({ ...ROW, name: 'Renamed' })

    const result = await updateCustomExerciseAction(7, {
      name: 'Renamed',
      category: 'Shoulders',
      muscles: ['Shoulders'],
      musclesSecondary: ['Trapezius'],
    })

    expect(mockedUpdate).toHaveBeenCalledWith(USER, 7, {
      name: 'Renamed',
      category: 'Shoulders',
      muscles: ['Shoulders'],
      musclesSecondary: ['Trapezius'],
    })
    expect(result.name).toBe('Renamed')
  })
})
