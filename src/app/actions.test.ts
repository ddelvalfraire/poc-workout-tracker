import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests the write boundary of setWeightUnitAction with auth, the db layer, and
 * Next's cache all mocked — so the test asserts the action's own guard + wiring
 * (validate → persist → revalidate) without a real user, database, or request.
 */
vi.mock('@/lib/auth', () => ({ requireUserId: vi.fn(async () => 'user_123') }))
vi.mock('@/db/preferences', () => ({
  setWeightUnit: vi.fn(async () => {}),
  setEquipment: vi.fn(async () => {}),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { setWeightUnitAction, setEquipmentAction } from './actions'
import { setWeightUnit, setEquipment } from '@/db/preferences'
import { revalidatePath } from 'next/cache'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('setWeightUnitAction', () => {
  it('rejects an invalid unit without writing or revalidating', async () => {
    await expect(setWeightUnitAction('stone')).rejects.toThrow('invalid weight unit')
    expect(setWeightUnit).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('persists a valid unit for the user and revalidates the layout', async () => {
    await setWeightUnitAction('kg')
    expect(setWeightUnit).toHaveBeenCalledWith('user_123', 'kg')
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })
})

describe('setEquipmentAction', () => {
  it('rejects invalid equipment without writing or revalidating', async () => {
    await expect(setEquipmentAction({ unit: 'lb', bars: [], plates: [45] })).rejects.toThrow(
      'must not be empty',
    )
    expect(setEquipment).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('persists normalized equipment for the user and revalidates the layout', async () => {
    // Act — unsorted with a duplicate; the boundary normalizes
    await setEquipmentAction({ unit: 'lb', bars: [35, 45], plates: [2.5, 45, 45, 25] })

    // Assert
    expect(setEquipment).toHaveBeenCalledWith('user_123', {
      unit: 'lb',
      bars: [45, 35],
      plates: [45, 25, 2.5],
    })
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })
})
