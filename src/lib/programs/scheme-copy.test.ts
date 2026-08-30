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

/**
 * The voice itself now lives in `messages/en.json` under `SchemeCopy`, and is
 * proved rendered word for word in scheme-copy-i18n.test.tsx. What is
 * asserted here is the DECISION: which message a config earns, and the
 * numbers it carries, quantized into the display unit.
 */
describe('schemeSubtitle / schemeName', () => {
  it('gives every scheme its own camelCase catalog leaf', () => {
    const leaves = ALL_SCHEMES.map((scheme) => schemeName(scheme).key)
    expect(leaves).toEqual([
      'name.linear',
      'name.doubleProgression',
      'name.percent1rm',
      'name.rpeTarget',
      'name.weeklyVolume',
      'name.repProgression',
      'name.amrapCycle',
    ])
    // The kebab-case discriminator is DATA; a message key must stay a legal
    // identifier for an Android / xcstrings export (I18N-KEYS.md §3).
    for (const key of leaves) expect(key).not.toContain('-')
  })

  it('pairs each scheme with the matching subtitle leaf', () => {
    for (const scheme of ALL_SCHEMES) {
      expect(schemeSubtitle(scheme).key).toBe(schemeName(scheme).key.replace('name.', 'subtitle.'))
    }
  })
})

describe('schemeSentence — actual numbers, quantized, in the display unit', () => {
  it('linear: names the quantized increment in lb', () => {
    // 2.27 kg is 5.0 lb — the message carries the loadable 5, never kg.
    const p: Progression = { scheme: 'linear', incrementKg: 2.27 }
    expect(schemeSentence(p, { unit: 'lb' })).toEqual({
      key: 'sentence.linear',
      values: { increment: 5, unit: 'lb' },
    })
  })

  it('double progression: rep top, current load, and increment', () => {
    const p: Progression = {
      scheme: 'double-progression',
      repMin: 8,
      repMax: 12,
      incrementKg: 2.27,
    }
    // 29.48 kg = 65.0 lb.
    expect(schemeSentence(p, { unit: 'lb', currentLoadKg: 29.48 })).toEqual({
      key: 'sentence.doubleProgressionAtLoad',
      values: { reps: 12, load: 65, increment: 5, unit: 'lb' },
    })
  })

  it('double progression: drops to the load-less message when no load is known', () => {
    const p: Progression = {
      scheme: 'double-progression',
      repMin: 8,
      repMax: 12,
      incrementKg: 2.5,
    }
    expect(schemeSentence(p, { unit: 'kg' })).toEqual({
      key: 'sentence.doubleProgression',
      values: { reps: 12, increment: 2.5, unit: 'kg' },
    })
  })

  it("guards the local DEFAULT_STEP_KG mirror against the engine's AUTOREG_DEFAULT_STEP_KG", () => {
    // scheme-copy cannot import autoregulate (autoregulate imports it), so
    // the default step is mirrored locally — this test (no cycle here) pins
    // the zero-increment branch to the engine's actual default step.
    const p: Progression = { scheme: 'double-progression', repMin: 8, repMax: 12, incrementKg: 0 }
    expect(schemeSentence(p, { unit: 'kg' })).toEqual({
      key: 'sentence.doubleProgression',
      values: { reps: 12, increment: AUTOREG_DEFAULT_STEP_KG, unit: 'kg' },
    })
  })

  it('percent-1rm: the percent span of a quantized training max', () => {
    const p: Progression = {
      scheme: 'percent-1rm',
      trainingMaxKg: 63.5, // 140.0 lb
      weekPercents: [0.7, 0.8, 0.9],
    }
    expect(schemeSentence(p, { unit: 'lb' })).toEqual({
      key: 'sentence.percent1rmRange',
      values: { min: 70, max: 90, trainingMax: 140, unit: 'lb' },
    })
  })

  it('percent-1rm: a single percent collapses to the span-less message', () => {
    const p: Progression = { scheme: 'percent-1rm', trainingMaxKg: 100, weekPercents: [0.75] }
    expect(schemeSentence(p, { unit: 'kg' })).toEqual({
      key: 'sentence.percent1rm',
      values: { percent: 75, trainingMax: 100, unit: 'kg' },
    })
  })

  it('rep-progression: one rep with a cap, and many without', () => {
    const capped: Progression = {
      scheme: 'rep-progression',
      incrementReps: 1,
      incrementSec: 0,
      maxReps: 20,
    }
    expect(schemeSentence(capped, { unit: 'lb' })).toEqual({
      key: 'sentence.repProgressionCapped',
      values: { reps: 1, cap: 20 },
    })
    const uncapped: Progression = { scheme: 'rep-progression', incrementReps: 2, incrementSec: 0 }
    expect(schemeSentence(uncapped, { unit: 'kg' })).toEqual({
      key: 'sentence.repProgression',
      values: { reps: 2 },
    })
  })

  it('rep-progression: seconds variant', () => {
    const timed: Progression = { scheme: 'rep-progression', incrementReps: 0, incrementSec: 30 }
    expect(schemeSentence(timed, { unit: 'kg' })).toEqual({
      key: 'sentence.secProgression',
      values: { seconds: 30 },
    })
  })

  it('amrap-cycle: the actual bump', () => {
    const p: Progression = {
      scheme: 'amrap-cycle',
      trainingMaxKg: 100,
      incrementKg: 2.5,
      wave: [[0.65, 0.75, 0.85]],
    }
    expect(schemeSentence(p, { unit: 'kg' })).toEqual({
      key: 'sentence.amrapCycle',
      values: { increment: 2.5, unit: 'kg' },
    })
  })

  it('weekly-volume: the set ramp', () => {
    const p: Progression = { scheme: 'weekly-volume', mevSets: 12, mrvSets: 20 }
    expect(schemeSentence(p, { unit: 'lb' })).toEqual({
      key: 'sentence.weeklyVolume',
      values: { mev: 12, mrv: 20 },
    })
  })

  it('rpe-target: the target effort', () => {
    const p: Progression = { scheme: 'rpe-target', targetRpe: 8 }
    expect(schemeSentence(p, { unit: 'lb' })).toEqual({
      key: 'sentence.rpeTarget',
      values: { rpe: 8 },
    })
  })
})

describe('schemeSentence — missing data degrades to the subtitle', () => {
  it('linear with no increment falls back', () => {
    const p: Progression = { scheme: 'linear', incrementKg: 0 }
    expect(schemeSentence(p, { unit: 'lb' })).toEqual(schemeSubtitle('linear'))
  })

  it('percent-1rm with a zero training max falls back', () => {
    const p: Progression = { scheme: 'percent-1rm', trainingMaxKg: 0, weekPercents: [0.7] }
    expect(schemeSentence(p, { unit: 'lb' })).toEqual(schemeSubtitle('percent-1rm'))
  })

  it('amrap-cycle with no bump falls back (static wave loading)', () => {
    const p: Progression = {
      scheme: 'amrap-cycle',
      trainingMaxKg: 100,
      incrementKg: 0,
      wave: [[0.65]],
    }
    expect(schemeSentence(p, { unit: 'kg' })).toEqual(schemeSubtitle('amrap-cycle'))
  })

  it('degrades structurally, so no NaN or raw-kg load can reach a lb account', () => {
    const configs: Progression[] = [
      { scheme: 'linear', incrementKg: Number.NaN },
      { scheme: 'double-progression', repMin: 0, repMax: 0, incrementKg: 2.5 },
      { scheme: 'weekly-volume', mevSets: 0, mrvSets: 0 },
      { scheme: 'rep-progression', incrementReps: 0, incrementSec: 0 },
    ]
    for (const p of configs) {
      const message = schemeSentence(p, { unit: 'lb', currentLoadKg: 30.21 })
      // The subtitle takes NO arguments, so neither NaN nor the raw 30.21 kg
      // has anywhere to go — the degradation is structural, not cosmetic.
      expect(message).toEqual(schemeSubtitle(p.scheme))
      expect(message.values).toBeUndefined()
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
