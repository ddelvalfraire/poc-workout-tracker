import { describe, it, expect } from 'vitest'
import { aggregateVolumeBalance } from './balance'
import type { MuscleGroupVolume } from '@/db/muscle-volume'
import type { PlannedGroupVolume } from '@/db/planned-volume'

const done = (group: string, currentSets: number): MuscleGroupVolume =>
  ({ group, currentSets, previousSets: 0 }) as MuscleGroupVolume
const plan = (group: string, plannedSets: number): PlannedGroupVolume =>
  ({ group, plannedSets }) as PlannedGroupVolume

describe('aggregateVolumeBalance', () => {
  it('joins performed against planned per group', () => {
    const out = aggregateVolumeBalance([done('Chest', 14)], [plan('Chest', 13)])
    expect(out?.groups[0]).toEqual({
      group: 'Chest',
      doneSets: 14,
      plannedSets: 13,
      percent: 108,
    })
  })

  it('does not cap a group that beat its plan', () => {
    // Clamping to 100 would make over-reaching look identical to exactly
    // meeting the plan, which is a different fact.
    expect(aggregateVolumeBalance([done('Back', 30)], [plan('Back', 10)])?.groups[0].percent).toBe(
      300,
    )
  })

  it('counts a planned group with nothing performed as zero, not missing', () => {
    const out = aggregateVolumeBalance([], [plan('Delts', 11)])
    expect(out?.groups[0]).toMatchObject({ doneSets: 0, percent: 0 })
  })

  it('drops groups the program never planned', () => {
    // Training something unplanned is not being "behind" on it, and it has no
    // denominator to draw a bar against.
    const out = aggregateVolumeBalance([done('Calves', 6)], [plan('Chest', 10)])
    expect(out?.groups.map((g) => g.group)).toEqual(['Chest'])
  })

  it('picks the lagging group by ABSOLUTE shortfall, not proportion', () => {
    // Delts is 7 sets short (36%); Calves is 1 set short of 2 (50%). Being 7
    // sets behind matters more than being half of a two-set plan behind.
    const out = aggregateVolumeBalance(
      [done('Delts', 4), done('Calves', 1)],
      [plan('Delts', 11), plan('Calves', 2)],
    )
    expect(out?.lagging?.group).toBe('Delts')
  })

  it('reports no lagging group when every plan is met', () => {
    const out = aggregateVolumeBalance([done('Chest', 13)], [plan('Chest', 13)])
    expect(out?.lagging).toBeNull()
  })

  it('returns null without a plan to measure against', () => {
    expect(aggregateVolumeBalance([done('Chest', 10)], [])).toBeNull()
    expect(aggregateVolumeBalance([done('Chest', 10)], [plan('Chest', 0)])).toBeNull()
  })
})
