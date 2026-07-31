import { describe, it, expect } from 'vitest'
import {
  LOW_VOLUME_FLOOR,
  lowVolumeGroups,
  OVER_PLAN_RATIO,
  overPlanGroups,
  setsDeltaLabel,
  underPlanGroups,
  withPlanned,
} from './volume-view'
import type { MuscleGroupVolume } from '@/db/muscle-volume'
import type { PlannedVolume } from '@/db/planned-volume'

function group(over: Partial<MuscleGroupVolume>): MuscleGroupVolume {
  return { group: 'Chest', currentSets: 0, previousSets: 0, ...over }
}

function plan(groups: PlannedVolume['groups']): PlannedVolume {
  return { programId: 'prog-1', programName: 'PPL', groups, totalSets: 0 }
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

describe('underPlanGroups', () => {
  it('flags groups short of plan, skips met, unplanned, and Other', () => {
    const groups = [
      group({ group: 'Chest', currentSets: 9 }), // short → flag
      group({ group: 'Back', currentSets: 12 }), // met exactly
      group({ group: 'Quads', currentSets: 0 }), // plan skips it → no flag
      group({ group: 'Other', currentSets: 0 }), // honesty bucket, no target
    ]
    const planned = plan([
      { group: 'Chest', plannedSets: 12 },
      { group: 'Back', plannedSets: 12 },
      { group: 'Quads', plannedSets: 0 },
      { group: 'Other', plannedSets: 3 },
    ])

    expect(underPlanGroups(groups, planned)).toEqual([
      { group: 'Chest', performedSets: 9, plannedSets: 12 },
    ])
  })

  it('flags an untouched group the plan trains (unlike the floor rule)', () => {
    const groups = [group({ group: 'Calves', currentSets: 0, previousSets: 0 })]
    const planned = plan([{ group: 'Calves', plannedSets: 6 }])

    expect(underPlanGroups(groups, planned)).toHaveLength(1)
  })
})

describe('overPlanGroups', () => {
  it('flags only past the ratio — the boundary itself stays quiet', () => {
    const groups = [
      group({ group: 'Chest', currentSets: 12 * OVER_PLAN_RATIO }), // exactly 1.5× → quiet
      group({ group: 'Back', currentSets: 19 }), // 19 > 12 × 1.5 → note
      group({ group: 'Quads', currentSets: 20 }), // plan skips it → never a note
    ]
    const planned = plan([
      { group: 'Chest', plannedSets: 12 },
      { group: 'Back', plannedSets: 12 },
      { group: 'Quads', plannedSets: 0 },
    ])

    expect(overPlanGroups(groups, planned)).toEqual([
      { group: 'Back', performedSets: 19, plannedSets: 12 },
    ])
  })
})

describe('withPlanned', () => {
  it('attaches plannedSets to every performed group, 0 when unplanned', () => {
    const groups = [group({ group: 'Chest', currentSets: 9 }), group({ group: 'Back' })]
    const planned = plan([{ group: 'Chest', plannedSets: 12 }])

    expect(withPlanned(groups, planned)).toEqual([
      { group: 'Chest', currentSets: 9, previousSets: 0, plannedSets: 12 },
      { group: 'Back', currentSets: 0, previousSets: 0, plannedSets: 0 },
    ])
  })

  it("appends a planned-only 'Other' row so its target still shows", () => {
    const groups = [group({ group: 'Chest' })]
    const planned = plan([{ group: 'Other', plannedSets: 2 }])

    expect(withPlanned(groups, planned).at(-1)).toEqual({
      group: 'Other',
      currentSets: 0,
      previousSets: 0,
      plannedSets: 2,
    })
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
