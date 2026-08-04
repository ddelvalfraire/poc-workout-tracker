import { describe, it, expect } from 'vitest'
import {
  bulletWidthPct,
  LOW_VOLUME_FLOOR,
  lowVolumeGroups,
  OVER_PLAN_RATIO,
  overPlanGroups,
  setsDeltaLabel,
  sortGroupsForDisplay,
  underPlanGroups,
  verdictForStats,
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

describe('sortGroupsForDisplay', () => {
  it('sorts by shortfall descending when a plan exists', () => {
    const groups = [
      { ...group({ group: 'Chest', currentSets: 10 }), plannedSets: 12 }, // −2
      { ...group({ group: 'Back', currentSets: 3 }), plannedSets: 12 }, // −9
      { ...group({ group: 'Quads', currentSets: 14 }), plannedSets: 10 }, // +4 over
    ]

    expect(sortGroupsForDisplay(groups, true).map((g) => g.group)).toEqual([
      'Back',
      'Chest',
      'Quads',
    ])
  })

  it('sorts by currentSets descending without a plan', () => {
    const groups = [
      group({ group: 'Chest', currentSets: 4 }),
      group({ group: 'Back', currentSets: 12 }),
      group({ group: 'Quads', currentSets: 8 }),
    ]

    expect(sortGroupsForDisplay(groups, false).map((g) => g.group)).toEqual([
      'Back',
      'Quads',
      'Chest',
    ])
  })

  it('keeps catalog order on ties and never mutates the input', () => {
    const groups = [
      group({ group: 'Chest', currentSets: 8 }),
      group({ group: 'Back', currentSets: 8 }),
    ]
    const before = groups.map((g) => ({ ...g }))

    expect(sortGroupsForDisplay(groups, false).map((g) => g.group)).toEqual(['Chest', 'Back'])
    expect(groups).toEqual(before)
  })
})

describe('bulletWidthPct', () => {
  it('is a whole percent of the planned track', () => {
    expect(bulletWidthPct(6, 12)).toBe(50)
    expect(bulletWidthPct(4, 12)).toBe(33)
  })

  it('caps at 100 when performed exceeds plan', () => {
    expect(bulletWidthPct(19, 12)).toBe(100)
  })

  it('is 0 for a zero/absent plan (never NaN or Infinity)', () => {
    expect(bulletWidthPct(5, 0)).toBe(0)
  })
})

describe('verdictForStats', () => {
  it('names the single worst under-plan group', () => {
    const verdict = verdictForStats({
      planned: plan([]),
      under: [
        { group: 'Chest', performedSets: 10, plannedSets: 12 }, // −2
        { group: 'Back', performedSets: 6, plannedSets: 12 }, // −6 → worst
      ],
      currentSets: 30,
      previousSets: 28,
      daysLeft: null,
    })

    expect(verdict.headline).toBe('Back is behind.')
    expect(verdict.context).toBe('6 of 12 planned sets')
  })

  it('appends days-left only when provided (calendar mode)', () => {
    const under = [{ group: 'Back' as const, performedSets: 6, plannedSets: 12 }]
    const base = { planned: plan([]), under, currentSets: 6, previousSets: 0 }

    expect(verdictForStats({ ...base, daysLeft: 3 }).context).toBe(
      '6 of 12 planned sets · 3 days left this week',
    )
    expect(verdictForStats({ ...base, daysLeft: 1 }).context).toBe(
      '6 of 12 planned sets · 1 day left this week',
    )
  })

  it('reads on plan when nothing is under', () => {
    const verdict = verdictForStats({
      planned: plan([]),
      under: [],
      currentSets: 24,
      previousSets: 20,
      daysLeft: 2,
    })

    expect(verdict.headline).toBe('On plan.')
    expect(verdict.context).toBe('Every planned group at its weekly target · 2 days left this week')
  })

  it('falls back to no-plan copy with the week total and delta', () => {
    const verdict = verdictForStats({
      planned: null,
      under: [],
      currentSets: 24,
      previousSets: 18,
      daysLeft: null,
    })

    expect(verdict.headline).toBe('No plan set.')
    expect(verdict.context).toBe('24 sets this week · +6 vs last week')
  })

  it('omits the delta when flat and handles the singular set', () => {
    const verdict = verdictForStats({
      planned: null,
      under: [],
      currentSets: 1,
      previousSets: 1,
      daysLeft: null,
    })

    expect(verdict.context).toBe('1 set this week')
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
