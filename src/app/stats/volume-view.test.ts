import { describe, it, expect } from 'vitest'
import { LOW_VOLUME_FLOOR, lowVolumeGroups, setsDeltaLabel } from './volume-view'
import type { MuscleGroupVolume } from '@/db/muscle-volume'

function group(over: Partial<MuscleGroupVolume>): MuscleGroupVolume {
  return { group: 'Chest', currentSets: 0, previousSets: 0, ...over }
}

describe('lowVolumeGroups', () => {
  it('flags active groups under the floor, skips untrained and healthy ones', () => {
    const groups = [
      group({ group: 'Chest', currentSets: 4, previousSets: 12 }), // slipped → flag
      group({ group: 'Back', currentSets: 12 }), // healthy
      group({ group: 'Quads', currentSets: 0, previousSets: 0 }), // untouched → no nag
      group({ group: 'Core', currentSets: 0, previousSets: 6 }), // dropped to zero → flag
    ]

    expect(lowVolumeGroups(groups).map((g) => g.group)).toEqual(['Chest', 'Core'])
  })

  it('treats the floor as exclusive and never flags Other', () => {
    const groups = [
      group({ group: 'Chest', currentSets: LOW_VOLUME_FLOOR }),
      group({ group: 'Other', currentSets: 1 }),
    ]

    expect(lowVolumeGroups(groups)).toEqual([])
  })
})

describe('setsDeltaLabel', () => {
  it('signs the difference and names the period', () => {
    expect(setsDeltaLabel(24, 18)).toBe('+6 vs last week')
    expect(setsDeltaLabel(12, 20)).toBe('−8 vs last week')
  })

  it('returns null when flat', () => {
    expect(setsDeltaLabel(10, 10)).toBeNull()
  })
})
