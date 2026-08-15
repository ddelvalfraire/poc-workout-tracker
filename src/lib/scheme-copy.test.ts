import { describe, expect, it } from 'vitest'

import { AUTOREG_DEFAULT_STEP_KG } from './autoregulate'
import type { Progression } from './program-input'
import {
  repFillHoldReason,
  schemeName,
  schemeSentence,
  schemeSubtitle,
  type ProgressionScheme,
} from './scheme-copy'

const ALL_SCHEMES: ProgressionScheme[] = [
  'linear',
  'double-progression',
  'percent-1rm',
  'rpe-target',
  'weekly-volume',
  'rep-progression',
  'amrap-cycle',
]

describe('schemeSubtitle / schemeName', () => {
  it('covers every scheme with a non-empty plain sentence and name', () => {
    for (const scheme of ALL_SCHEMES) {
      expect(schemeSubtitle(scheme).length).toBeGreaterThan(0)
      expect(schemeName(scheme).length).toBeGreaterThan(0)
    }
  })

  it('speaks the researched picker one-liners (issue #228 comment)', () => {
    expect(schemeSubtitle('double-progression')).toBe(
      'Work up to the top of your rep range, then the weight goes up and reps start over.',
    )
    expect(schemeSubtitle('linear')).toBe('Add weight every session you complete all sets.')
    expect(schemeSubtitle('rep-progression')).toBe('Same weight, more reps each session.')
  })

  it('never leaks engine vocabulary into a subtitle', () => {
    for (const scheme of ALL_SCHEMES) {
      const subtitle = schemeSubtitle(scheme)
      expect(subtitle).not.toMatch(/anchor|quorum|load steps/i)
      expect(subtitle).not.toContain('undefined')
    }
  })
})

describe('schemeSentence — actual numbers, quantized, in the display unit', () => {
  it('linear: names the quantized increment in lb', () => {
    // 2.27 kg is 5.0 lb — the sentence prints the loadable 5 lb, never kg.
    const p: Progression = { scheme: 'linear', incrementKg: 2.27 }
    expect(schemeSentence(p, { unit: 'lb' })).toBe('Complete all sets → +5 lb next session.')
  })

  it('double progression: rep top, current load, and increment', () => {
    const p: Progression = {
      scheme: 'double-progression',
      repMin: 8,
      repMax: 12,
      incrementKg: 2.27,
    }
    // 29.48 kg = 65.0 lb.
    expect(schemeSentence(p, { unit: 'lb', currentLoadKg: 29.48 })).toBe(
      'Hit 12 reps on every set at 65 lb → +5 lb next session.',
    )
  })

  it('double progression: omits the load clause when no current load is known', () => {
    const p: Progression = {
      scheme: 'double-progression',
      repMin: 8,
      repMax: 12,
      incrementKg: 2.5,
    }
    expect(schemeSentence(p, { unit: 'kg' })).toBe(
      'Hit 12 reps on every set → +2.5 kg next session.',
    )
  })

  it('double progression: a zero increment speaks the engine default step (2.5 kg)', () => {
    const p: Progression = { scheme: 'double-progression', repMin: 8, repMax: 12, incrementKg: 0 }
    expect(schemeSentence(p, { unit: 'kg' })).toBe(
      'Hit 12 reps on every set → +2.5 kg next session.',
    )
  })

  it("guards the local DEFAULT_STEP_KG mirror against the engine's AUTOREG_DEFAULT_STEP_KG", () => {
    // scheme-copy cannot import autoregulate (autoregulate imports it), so
    // the default step is mirrored locally — this test (no cycle here) pins
    // the copy's zero-increment sentence to the engine's actual default step.
    const p: Progression = { scheme: 'double-progression', repMin: 8, repMax: 12, incrementKg: 0 }
    expect(schemeSentence(p, { unit: 'kg' })).toContain(`+${AUTOREG_DEFAULT_STEP_KG} kg`)
  })

  it('percent-1rm: the percent span of a quantized training max', () => {
    const p: Progression = {
      scheme: 'percent-1rm',
      trainingMaxKg: 63.5, // 140.0 lb
      weekPercents: [0.7, 0.8, 0.9],
    }
    expect(schemeSentence(p, { unit: 'lb' })).toBe(
      'Week loads are 70–90% of your 140 lb training max.',
    )
  })

  it('percent-1rm: a single percent collapses the span', () => {
    const p: Progression = { scheme: 'percent-1rm', trainingMaxKg: 100, weekPercents: [0.75] }
    expect(schemeSentence(p, { unit: 'kg' })).toBe(
      'Week loads are 75% of your 100 kg training max.',
    )
  })

  it('rep-progression: reps with a cap', () => {
    const p: Progression = {
      scheme: 'rep-progression',
      incrementReps: 1,
      incrementSec: 0,
      maxReps: 20,
    }
    expect(schemeSentence(p, { unit: 'lb' })).toBe('+1 rep each session, up to 20.')
  })

  it('rep-progression: seconds variant, capless plural', () => {
    const timed: Progression = { scheme: 'rep-progression', incrementReps: 0, incrementSec: 30 }
    expect(schemeSentence(timed, { unit: 'kg' })).toBe('+30 sec each session.')
    const uncapped: Progression = { scheme: 'rep-progression', incrementReps: 2, incrementSec: 0 }
    expect(schemeSentence(uncapped, { unit: 'kg' })).toBe('+2 reps each session.')
  })

  it('amrap-cycle: the researched sentence with the actual bump', () => {
    const p: Progression = {
      scheme: 'amrap-cycle',
      trainingMaxKg: 100,
      incrementKg: 2.5,
      wave: [[0.65, 0.75, 0.85]],
    }
    expect(schemeSentence(p, { unit: 'kg' })).toBe(
      'Beat your rep record on the last set to earn the next training-max bump (+2.5 kg).',
    )
  })

  it('weekly-volume: the set ramp', () => {
    const p: Progression = { scheme: 'weekly-volume', mevSets: 12, mrvSets: 20 }
    expect(schemeSentence(p, { unit: 'lb' })).toBe('12 → 20 sets across the block, added weekly.')
  })

  it('rpe-target: the target effort', () => {
    const p: Progression = { scheme: 'rpe-target', targetRpe: 8 }
    expect(schemeSentence(p, { unit: 'lb' })).toBe(
      'Loads picked from your estimated max to land at RPE 8.',
    )
  })
})

describe('schemeSentence — missing data degrades to the subtitle', () => {
  it('linear with no increment falls back', () => {
    const p: Progression = { scheme: 'linear', incrementKg: 0 }
    expect(schemeSentence(p, { unit: 'lb' })).toBe(schemeSubtitle('linear'))
  })

  it('percent-1rm with a zero training max falls back', () => {
    const p: Progression = { scheme: 'percent-1rm', trainingMaxKg: 0, weekPercents: [0.7] }
    expect(schemeSentence(p, { unit: 'lb' })).toBe(schemeSubtitle('percent-1rm'))
  })

  it('amrap-cycle with no bump falls back (static wave loading)', () => {
    const p: Progression = {
      scheme: 'amrap-cycle',
      trainingMaxKg: 100,
      incrementKg: 0,
      wave: [[0.65]],
    }
    expect(schemeSentence(p, { unit: 'kg' })).toBe(schemeSubtitle('amrap-cycle'))
  })

  it('never renders "undefined", "NaN", or a raw-kg load in a lb account', () => {
    const configs: Progression[] = [
      { scheme: 'linear', incrementKg: Number.NaN },
      { scheme: 'double-progression', repMin: 0, repMax: 0, incrementKg: 2.5 },
      { scheme: 'weekly-volume', mevSets: 0, mrvSets: 0 },
      { scheme: 'rep-progression', incrementReps: 0, incrementSec: 0 },
    ]
    for (const p of configs) {
      const sentence = schemeSentence(p, { unit: 'lb', currentLoadKg: 30.21 })
      expect(sentence).not.toContain('undefined')
      expect(sentence).not.toContain('NaN')
      expect(sentence).not.toContain('66.6') // 30.21 kg raw — must never surface
      expect(sentence).toBe(schemeSubtitle(p.scheme))
    }
  })
})

describe('repFillHoldReason (shared with autoregReason)', () => {
  it('speaks the issue-#228 target sentence with the rep top', () => {
    expect(repFillHoldReason('65 lb', 12)).toBe(
      'Stay at 65 lb — hit 12 reps on every set, then the weight goes up',
    )
  })

  it('stays imperative without a governing top', () => {
    expect(repFillHoldReason('100 kg', 0)).toBe(
      'Stay at 100 kg — add reps on every set, then the weight goes up',
    )
  })
})
