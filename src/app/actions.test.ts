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
  setDefaultRestSec: vi.fn(async () => {}),
  setRestTimerEnabled: vi.fn(async () => {}),
  getWeightUnit: vi.fn(async () => 'lb'),
}))
vi.mock('@/db/bodyweight', () => ({
  logBodyweight: vi.fn(async () => ({ id: 'bw1' })),
  deleteBodyweightLog: vi.fn(async () => ({ id: 'bw1' })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  setWeightUnitAction,
  setEquipmentAction,
  setBodyweightAction,
  deleteBodyweightLogAction,
  setDefaultRestSecAction,
  setRestTimerEnabledAction,
} from './actions'
import {
  setWeightUnit,
  setEquipment,
  setDefaultRestSec,
  setRestTimerEnabled,
  getWeightUnit,
} from '@/db/preferences'
import { logBodyweight, deleteBodyweightLog } from '@/db/bodyweight'
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
    expect(logBodyweight).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('rejects a value over the 500 kg sanity ceiling', async () => {
    // 1200 lb ≈ 544 kg — plausible column-wise, absurd human-wise
    await expect(setBodyweightAction(1200)).rejects.toThrow('between 0.01 and 500 kg')
    expect(logBodyweight).not.toHaveBeenCalled()
  })

  it('rejects a sub-precision value that would round to a stored 0.00 kg', async () => {
    // 0.01 lb ≈ 0.0045 kg — positive, but under the numeric(5,2) step;
    // without the floor it would store as 0.00 and scoring would read zero
    await expect(setBodyweightAction(0.01)).rejects.toThrow('between 0.01 and 500 kg')
    expect(logBodyweight).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('converts the display-unit input to kg using the STORED unit and logs a weigh-in', async () => {
    // Act — user's stored unit is lb (mocked); 181.5 lb → 82.33 kg (2dp)
    await setBodyweightAction(181.5)

    // Assert — the settings edit and the /bodyweight quick log share this
    // write path: a history row is appended, prefs sync in the data layer.
    expect(getWeightUnit).toHaveBeenCalledWith('user_123')
    expect(logBodyweight).toHaveBeenCalledWith('user_123', 82.33)
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })
})

describe('deleteBodyweightLogAction', () => {
  const LOG_ID = '2f0a4c1e-1111-4222-8333-444455556666'

  it.each([
    ['a non-string', 42],
    ['a non-uuid string', 'not-a-uuid'],
    ['an uppercase uuid (our pages send lowercase)', '2F0A4C1E-1111-4222-8333-444455556666'],
  ])('rejects %s without deleting or revalidating', async (_label, value) => {
    await expect(deleteBodyweightLogAction(value)).rejects.toThrow('invalid bodyweight log id')
    expect(deleteBodyweightLog).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('deletes an owned entry and revalidates the layout', async () => {
    // Act
    await deleteBodyweightLogAction(LOG_ID)

    // Assert
    expect(deleteBodyweightLog).toHaveBeenCalledWith('user_123', LOG_ID)
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('throws (no revalidate) when the entry is not owned or already gone', async () => {
    // Arrange — the ownership-scoped delete matched nothing
    vi.mocked(deleteBodyweightLog).mockResolvedValueOnce(null)

    // Act / Assert
    await expect(deleteBodyweightLogAction(LOG_ID)).rejects.toThrow('not found')
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('setDefaultRestSecAction', () => {
  it.each([
    ['a non-number', '90'],
    ['a negative value', -1],
    ['a value over the 3600 ceiling', 3601],
    ['a non-integer', 90.5],
    ['undefined (only explicit null clears)', undefined],
  ])('rejects %s without writing or revalidating', async (_label, value) => {
    await expect(setDefaultRestSecAction(value)).rejects.toThrow('between 0 and 3600')
    expect(setDefaultRestSec).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('persists a valid rest target for the user and revalidates the layout', async () => {
    // Act
    await setDefaultRestSecAction(90)

    // Assert
    expect(setDefaultRestSec).toHaveBeenCalledWith('user_123', 90)
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('persists null to clear the target (count-up only)', async () => {
    // Act
    await setDefaultRestSecAction(null)

    // Assert
    expect(setDefaultRestSec).toHaveBeenCalledWith('user_123', null)
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('accepts the 0 and 3600 boundary values', async () => {
    // Act
    await setDefaultRestSecAction(0)
    await setDefaultRestSecAction(3600)

    // Assert
    expect(setDefaultRestSec).toHaveBeenNthCalledWith(1, 'user_123', 0)
    expect(setDefaultRestSec).toHaveBeenNthCalledWith(2, 'user_123', 3600)
  })
})

describe('setRestTimerEnabledAction', () => {
  it.each([
    ['a string', 'true'],
    ['a number', 1],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s without writing or revalidating', async (_label, value) => {
    await expect(setRestTimerEnabledAction(value)).rejects.toThrow('must be a boolean')
    expect(setRestTimerEnabled).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each([[true], [false]])(
    'persists %s for the user and revalidates the layout',
    async (flag) => {
      // Act
      await setRestTimerEnabledAction(flag)

      // Assert
      expect(setRestTimerEnabled).toHaveBeenCalledWith('user_123', flag)
      expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
    },
  )
})
