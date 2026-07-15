import { describe, it, expect } from 'vitest'
import { substituteSlot, type SlotForSubstitution } from './substitute-slot'
import type { Progression } from './program-input'

type SlotSet = SlotForSubstitution['sets'][number]
type SlotOverride = SlotSet['overrides'][number]

/** A full override row, all target columns null unless overridden. */
function override(over: Partial<SlotOverride> & { week: number }): SlotOverride {
  return {
    repMin: null,
    repMax: null,
    rir: null,
    rpe: null,
    suggestedLoadKg: null,
    tempo: null,
    durationSec: null,
    distanceM: null,
    restSec: null,
    technique: null,
    ...over,
  }
}

/** A full template set row with every column populated where sensible. */
function fullSet(over: Partial<SlotSet> = {}): SlotSet {
  return {
    setNumber: 1,
    setType: 'working',
    metricMode: 'reps_weight',
    repMin: 8,
    repMax: 12,
    rir: 2,
    rpe: null,
    suggestedLoadKg: 100,
    tempo: '3-1-1',
    durationSec: null,
    distanceM: null,
    restSec: 120,
    technique: { version: 1, kind: 'drop-set', stages: [{ loadKg: 80, reps: 8 }] },
    overrides: [],
    ...over,
  }
}

function slot(over: Partial<SlotForSubstitution> = {}): SlotForSubstitution {
  return { wgerExerciseId: 73, progression: null, sets: [fullSet()], ...over }
}

describe('substituteSlot', () => {
  it('re-points the slot at the substitute id', () => {
    expect(substituteSlot(slot(), 42).wgerExerciseId).toBe(42)
  })

  it('strips template loads and preserves every other set field verbatim', () => {
    // Act
    const result = substituteSlot(slot(), 42)

    // Assert — the load belonged to the original movement; the scheme didn't
    expect(result.sets[0]).toEqual({
      setNumber: 1,
      setType: 'working',
      metricMode: 'reps_weight',
      repMin: 8,
      repMax: 12,
      rir: 2,
      rpe: null,
      suggestedLoadKg: null,
      tempo: '3-1-1',
      durationSec: null,
      distanceM: null,
      restSec: 120,
      technique: { version: 1, kind: 'drop-set', stages: [{ loadKg: 80, reps: 8 }] },
      overrides: [],
    })
  })

  it('strips override loads but keeps the override targets and week', () => {
    // Arrange
    const input = slot({
      sets: [fullSet({ overrides: [override({ week: 3, suggestedLoadKg: 90, restSec: 150 })] })],
    })

    // Act
    const result = substituteSlot(input, 42)

    // Assert
    expect(result.sets[0].overrides[0]).toMatchObject({
      week: 3,
      suggestedLoadKg: null,
      restSec: 150,
    })
  })

  it('drops training-max-based progressions (their loads are original-movement absolutes)', () => {
    const percent: Progression = { scheme: 'percent-1rm', trainingMaxKg: 140, weekPercents: [0.7, 0.8] }
    const amrap: Progression = { scheme: 'amrap-cycle', trainingMaxKg: 140, incrementKg: 2.5, wave: [[0.65, 0.75]] }

    expect(substituteSlot(slot({ progression: percent }), 42).progression).toBeNull()
    expect(substituteSlot(slot({ progression: amrap }), 42).progression).toBeNull()
  })

  it('keeps history- and structure-anchored schemes unchanged', () => {
    const keep: Progression[] = [
      { scheme: 'rpe-target', targetRpe: 8 },
      { scheme: 'rep-progression', incrementReps: 1, incrementSec: 0 },
      { scheme: 'weekly-volume', mevSets: 3, mrvSets: 6 },
      { scheme: 'linear', incrementKg: 2.5 },
      { scheme: 'double-progression', repMin: 8, repMax: 12, incrementKg: 2.5 },
    ]
    for (const progression of keep) {
      expect(substituteSlot(slot({ progression }), 42).progression).toEqual(progression)
    }
    expect(substituteSlot(slot({ progression: null }), 42).progression).toBeNull()
  })

  it('does not mutate the input slot', () => {
    // Arrange
    const input = slot({
      sets: [fullSet({ overrides: [override({ week: 2, suggestedLoadKg: 95 })] })],
    })

    // Act
    substituteSlot(input, 42)

    // Assert — deep: loads survive on the original
    expect(input.wgerExerciseId).toBe(73)
    expect(input.sets[0].suggestedLoadKg).toBe(100)
    expect(input.sets[0].overrides[0].suggestedLoadKg).toBe(95)
  })
})
