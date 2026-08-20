import { describe, it, expect } from 'vitest'
import {
  continuesTechniqueGroup,
  expandTechniqueStages,
  isTechniqueKind,
  startsRestPeriod,
} from './technique'
import type { DerivedSet } from './progression'
import type { Technique } from './program-input'

/** A derived working set with every optional target nulled, for overriding. */
function derivedSet(overrides: Partial<DerivedSet> = {}): DerivedSet {
  return {
    setNumber: 1,
    setType: 'working',
    metricMode: 'reps_weight',
    repMin: 8,
    repMax: 8,
    rir: null,
    rpe: null,
    loadKg: 100,
    tempo: null,
    durationSec: null,
    distanceM: null,
    restSec: 180,
    technique: null,
    derivedFrom: 'template',
    sourceIndex: 0,
    ...overrides,
  }
}

const dropSet: Technique = {
  version: 1,
  kind: 'drop-set',
  stages: [
    { loadKg: 80, reps: 6 },
    { loadKg: 60, reps: 6 },
  ],
}

describe('expandTechniqueStages', () => {
  it('leaves a technique-free prescription untouched apart from renumbering', () => {
    const sets = [derivedSet({ setNumber: 4 }), derivedSet({ setNumber: 9, loadKg: 90 })]

    const rows = expandTechniqueStages(sets)

    expect(rows).toEqual([
      { ...sets[0], setNumber: 1 },
      { ...sets[1], setNumber: 2 },
    ])
    expect(rows.every((r) => r.techniqueStage === undefined)).toBe(true)
  })

  it('expands one technique set into the top set plus one row per stage', () => {
    const rows = expandTechniqueStages([derivedSet({ technique: dropSet })])

    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.setNumber)).toEqual([1, 2, 3])
    expect(rows.map((r) => r.loadKg)).toEqual([100, 80, 60])
    expect(rows.map((r) => r.repMin)).toEqual([8, 6, 6])
    expect(rows.map((r) => r.techniqueStage?.index)).toEqual([0, 1, 2])
    // One group, one kind, and every row keeps the top set's chassis.
    expect(new Set(rows.map((r) => r.techniqueStage?.group)).size).toBe(1)
    expect(rows.every((r) => r.techniqueStage?.kind === 'drop-set')).toBe(true)
    expect(rows.every((r) => r.setType === 'working' && r.sourceIndex === 0)).toBe(true)
  })

  it('keeps the between-set rest on the LAST row and defaults intra-set rest to 0', () => {
    const rows = expandTechniqueStages([derivedSet({ technique: dropSet })])

    // No rest between stages — that absence IS the drop set.
    expect(rows.map((r) => r.restSec)).toEqual([0, 0, 180])
  })

  it('honours an authored intra-set pause (the rest-pause prescription)', () => {
    const restPause: Technique = {
      version: 1,
      kind: 'rest-pause',
      stages: [
        { reps: 3, restSec: 20 },
        { reps: 2, restSec: 20 },
      ],
    }

    const rows = expandTechniqueStages([derivedSet({ technique: restPause })])

    // stages[i].restSec is the pause AFTER stage i; the set's own 180 s
    // between-set rest rides the last row, where the set truly ends.
    expect(rows.map((r) => r.restSec)).toEqual([20, 20, 180])
    // An unauthored stage load means "the lifter types it", never a phantom
    // prescription inherited from the top set.
    expect(rows.map((r) => r.loadKg)).toEqual([100, null, null])
  })

  it('renumbers across a mixed list and keeps groups distinct per source set', () => {
    const rows = expandTechniqueStages([
      derivedSet({ setNumber: 1, sourceIndex: 0 }),
      derivedSet({ setNumber: 2, sourceIndex: 1, technique: dropSet }),
      derivedSet({ setNumber: 3, sourceIndex: 2, technique: dropSet }),
    ])

    expect(rows.map((r) => r.setNumber)).toEqual([1, 2, 3, 4, 5, 6, 7])
    const groups = rows.map((r) => r.techniqueStage?.group)
    expect(groups[0]).toBeUndefined()
    expect(new Set(groups.slice(1, 4)).size).toBe(1)
    expect(new Set(groups.slice(4)).size).toBe(1)
    expect(groups[1]).not.toBe(groups[4])
  })

  it('passes an empty-stage technique through as a single ordinary row', () => {
    // Defensive: the schema requires min(1) stages, but stored JSONB is data.
    const empty = { version: 1, kind: 'cluster', stages: [] } as unknown as Technique

    const rows = expandTechniqueStages([derivedSet({ technique: empty })])

    expect(rows).toHaveLength(1)
    expect(rows[0].techniqueStage).toBeUndefined()
  })
})

describe('isTechniqueKind', () => {
  it('accepts the four kinds and rejects everything else', () => {
    expect(isTechniqueKind('rest-pause')).toBe(true)
    expect(isTechniqueKind('myo-reps')).toBe(true)
    expect(isTechniqueKind('giant-set')).toBe(false)
    expect(isTechniqueKind(null)).toBe(false)
  })
})

describe('the rest rule between stages', () => {
  const stage = (group: string, stageIndex: number) =>
    ({ kind: 'drop-set', group, stageIndex }) as const

  it('reads two rows of one group as continuing, and anything else as not', () => {
    expect(continuesTechniqueGroup(stage('g1', 0), stage('g1', 1))).toBe(true)
    expect(continuesTechniqueGroup(stage('g1', 1), stage('g2', 0))).toBe(false)
    expect(continuesTechniqueGroup(stage('g1', 0), undefined)).toBe(false)
    expect(continuesTechniqueGroup(undefined, stage('g1', 0))).toBe(false)
  })

  it('starts no rest period between stages with no prescribed pause', () => {
    // The drop set's whole point — and the ad-hoc case, where there is no
    // plan at all, so the session default must not sneak a 2-minute clock in.
    expect(startsRestPeriod(stage('g1', 0), stage('g1', 1), null)).toBe(false)
    expect(startsRestPeriod(stage('g1', 0), stage('g1', 1), 0)).toBe(false)
  })

  it('counts down an authored intra-set pause (rest-pause / cluster)', () => {
    expect(startsRestPeriod(stage('g1', 0), stage('g1', 1), 20)).toBe(true)
  })

  it('always starts a rest period after the LAST stage and after ordinary sets', () => {
    expect(startsRestPeriod(stage('g1', 1), undefined, null)).toBe(true)
    expect(startsRestPeriod(undefined, undefined, null)).toBe(true)
  })
})
