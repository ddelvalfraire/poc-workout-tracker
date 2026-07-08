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
  setBodyweight: vi.fn(async () => {}),
  getWeightUnit: vi.fn(async () => 'lb'),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { setWeightUnitAction, setEquipmentAction, setBodyweightAction } from './actions'
import { setWeightUnit, setEquipment, setBodyweight, getWeightUnit } from '@/db/preferences'
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

describe('setBodyweightAction', () => {
  it.each([
    ['a non-number', '180'],
    ['zero', 0],
    ['a negative value', -80],
    ['a non-finite value', Infinity],
  ])('rejects %s without writing or revalidating', async (_label, value) => {
    await expect(setBodyweightAction(value)).rejects.toThrow('positive number')
    expect(setBodyweight).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('rejects a value over the 500 kg sanity ceiling', async () => {
    // 1200 lb ≈ 544 kg — plausible column-wise, absurd human-wise
    await expect(setBodyweightAction(1200)).rejects.toThrow('between 0 and 500 kg')
    expect(setBodyweight).not.toHaveBeenCalled()
  })

  it('converts the display-unit input to kg using the STORED unit and revalidates', async () => {
    // Act — user's stored unit is lb (mocked); 181.5 lb → 82.33 kg (2dp)
    await setBodyweightAction(181.5)

    // Assert
    expect(getWeightUnit).toHaveBeenCalledWith('user_123')
    expect(setBodyweight).toHaveBeenCalledWith('user_123', 82.33)
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })
})
