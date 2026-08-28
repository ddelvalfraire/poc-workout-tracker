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

    const rows = expandTechniqueStages(sets, 'kg')

    expect(rows).toEqual([
      { ...sets[0], setNumber: 1 },
      { ...sets[1], setNumber: 2 },
    ])
    expect(rows.every((r) => r.techniqueStage === undefined)).toBe(true)
  })

  it('expands one technique set into the top set plus one row per stage', () => {
    const rows = expandTechniqueStages([derivedSet({ technique: dropSet })], 'kg')

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
    const rows = expandTechniqueStages([derivedSet({ technique: dropSet })], 'kg')

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

    const rows = expandTechniqueStages([derivedSet({ technique: restPause })], 'kg')

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
    ], 'kg')

    expect(rows.map((r) => r.setNumber)).toEqual([1, 2, 3, 4, 5, 6, 7])
    const groups = rows.map((r) => r.techniqueStage?.group)
    expect(groups[0]).toBeUndefined()
    expect(new Set(groups.slice(1, 4)).size).toBe(1)
    expect(new Set(groups.slice(4)).size).toBe(1)
    expect(groups[1]).not.toBe(groups[4])
  })

  it('keeps CLONED technique sets in separate groups (the weekly-volume resize)', () => {
    // resizeWorkingSets clones its last working set verbatim — same technique,
    // same sourceIndex. Two adjacent drop sets must stay two groups, or the
    // fused group counts wrong and the wire refuses to save the session.
    const rows = expandTechniqueStages([
      derivedSet({ sourceIndex: 1, technique: dropSet }),
      derivedSet({ sourceIndex: 1, technique: dropSet }),
    ], 'kg')

    const groups = rows.map((r) => r.techniqueStage?.group)
    expect(new Set(groups).size).toBe(2)
    expect(rows.map((r) => r.techniqueStage?.index)).toEqual([0, 1, 2, 0, 1, 2])
    expect(groups[0]).not.toBe(groups[3])
  })

  describe('percentage stage loads (technique-authoring §02)', () => {
    const pctDrop: Technique = {
      version: 1,
      kind: 'drop-set',
      stages: [{ loadPct: 0.8, reps: 6 }],
    }

    it('resolves a percentage against the top set, so the drop keeps its shape', () => {
      // The decay this field exists to stop: 80 kg is −20% off a 100 kg top
      // set and −30% off 115. A percentage stays −20% in both weeks.
      const wk1 = expandTechniqueStages([derivedSet({ loadKg: 100, technique: pctDrop })], 'kg')
      const wk6 = expandTechniqueStages([derivedSet({ loadKg: 115, technique: pctDrop })], 'kg')

      expect(wk1[1].loadKg).toBe(80)
      // 115 × 0.8 = 92, which is not on the 1.25 kg grid — the drop lands on
      // 92.5, the nearest weight that can actually go on the bar.
      expect(wk6[1].loadKg).toBe(92.5)
    })

    it('quantizes the resolved load to the loadable grid', () => {
      // 103 × 0.8 = 82.4, which is not a weight anyone can load.
      const rows = expandTechniqueStages([derivedSet({ loadKg: 103, technique: pctDrop })], 'kg')

      expect(rows[1].loadKg).toBe(82.5)
    })

    it('resolves to null when the top set has no load, never to zero', () => {
      // A percentage of nothing is nothing — inventing a number here would be
      // the phantom prescription an absent stage load exists to avoid.
      const rows = expandTechniqueStages([derivedSet({ loadKg: null, technique: pctDrop })], 'kg')

      expect(rows[1].loadKg).toBeNull()
    })

    it('leaves an absolute stage load alone', () => {
      const rows = expandTechniqueStages([derivedSet({ loadKg: 115, technique: dropSet })], 'kg')

      expect(rows.map((r) => r.loadKg)).toEqual([115, 80, 60])
    })

    it('leaves a stage with neither load null — typed at the rack', () => {
      const captured: Technique = { version: 1, kind: 'drop-set', stages: [{ reps: 6 }] }

      const rows = expandTechniqueStages([derivedSet({ loadKg: 100, technique: captured })], 'kg')

      expect(rows[1].loadKg).toBeNull()
    })

    it('resolves to null on a timed set — duration is never scaled by a load', () => {
      // The spec's rule is metric-mode based, and so is the code. A timed row
      // derives with a null load today, so this would pass either way; the
      // guard exists so a legacy or mixed row cannot put a weight on a
      // duration set, which is the hazard applyOverride already guards.
      const timed = derivedSet({
        metricMode: 'duration',
        loadKg: 60,
        durationSec: 45,
        technique: pctDrop,
      })

      const rows = expandTechniqueStages([timed], 'kg')

      expect(rows[1].loadKg).toBeNull()
      expect(rows[1].durationSec).toBe(45)
    })

    it('resolves on the reader\'s grid, not always the kg one', () => {
      const rows = expandTechniqueStages([derivedSet({ loadKg: 100, technique: pctDrop })], 'lb')

      // Whatever the lb grid snaps to, it must be loadable there and close to 80.
      expect(rows[1].loadKg).not.toBeNull()
      expect(Math.abs((rows[1].loadKg as number) - 80)).toBeLessThan(2)
    })
  })

  it('passes an empty-stage technique through as a single ordinary row', () => {
    // Defensive: the schema requires min(1) stages, but stored JSONB is data.
    const empty = { version: 1, kind: 'cluster', stages: [] } as unknown as Technique

    const rows = expandTechniqueStages([derivedSet({ technique: empty })], 'kg')

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
