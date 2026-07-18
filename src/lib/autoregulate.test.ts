import { describe, it, expect } from 'vitest'
import {
  autoregulate,
  autoregReason,
  applyAutoregToSets,
  sessionStall,
  type AutoregSession,
} from './autoregulate'
import type { DerivedSet } from './progression'

/** 3 working sets prescribed at 100 kg × 8-rep floor. */
const prescribed = () => [
  { repMin: 8, loadKg: 100 },
  { repMin: 8, loadKg: 100 },
  { repMin: 8, loadKg: 100 },
]

const session = (reps: (number | null)[], weightKg = 100): AutoregSession => ({
  prescribed: prescribed(),
  actual: reps.map((r) => ({ reps: r, weightKg, completed: r !== null })),
})

describe('sessionStall', () => {
  it('flags a session missing the floor on at least half its sets', () => {
    expect(sessionStall(session([8, 6, 5]))).toEqual({
      missedSets: 2,
      scorableSets: 3,
      repFloor: 8,
      loadKg: 100,
    })
  })

  it('does not flag a single missed set among three', () => {
    expect(sessionStall(session([8, 8, 6]))).toBeNull()
  })

  it('excludes sets attempted lighter than prescribed (self-regulation is not a stall)', () => {
    // All sets at 80 kg vs 100 prescribed: zero scorable → no verdict.
    expect(sessionStall(session([5, 5, 5], 80))).toBeNull()
  })

  it('ignores warm-up sets on both sides', () => {
    const s: AutoregSession = {
      prescribed: [{ repMin: 5, loadKg: 60, setType: 'warmup' }, ...prescribed()],
      actual: [
        { reps: 1, weightKg: 60, completed: true, setType: 'warmup' },
        { reps: 8, weightKg: 100, completed: true },
        { reps: 8, weightKg: 100, completed: true },
        { reps: 8, weightKg: 100, completed: true },
      ],
    }
    expect(sessionStall(s)).toBeNull()
  })

  it('returns null (no verdict) for a session with nothing scorable', () => {
    expect(sessionStall({ prescribed: [], actual: [] })).toBeNull()
    expect(
      sessionStall({ prescribed: [{ repMin: null, loadKg: null }], actual: [] }),
    ).toBeNull()
  })

  it('never counts uncompleted or rep-less sets', () => {
    expect(sessionStall(session([null, null, 8]))).toBeNull()
  })
})

describe('autoregulate', () => {
  it('returns null with no history or no stall', () => {
    expect(autoregulate(2.5, [])).toBeNull()
    expect(autoregulate(2.5, [session([8, 8, 8])])).toBeNull()
  })

  it('repeats the load after a single stall', () => {
    const adjustment = autoregulate(2.5, [session([6, 5, 8])])
    expect(adjustment).toMatchObject({ action: 'repeat', deltaKg: 0, suggestEarlyDeload: false })
  })

  it('decrements ~10% (snapped to increments) after two consecutive stalls', () => {
    const adjustment = autoregulate(2.5, [session([6, 5, 8]), session([7, 6, 6])])
    // 10% of 100 kg = 10 kg, already a multiple of 2.5 — the StrongLifts-
    // style deload, not a one-increment micro-step.
    expect(adjustment).toMatchObject({
      action: 'decrement',
      deltaKg: -10,
      suggestEarlyDeload: true,
    })
  })

  it('backs off at least one increment on light lifts', () => {
    const light: AutoregSession = {
      prescribed: [{ repMin: 12, loadKg: 10 }],
      actual: [{ reps: 8, weightKg: 10, completed: true }],
    }
    const adjustment = autoregulate(2.5, [light, light])
    expect(adjustment?.deltaKg).toBe(-2.5)
  })

  it('a clean previous session keeps a fresh stall at repeat, not decrement', () => {
    const adjustment = autoregulate(2.5, [session([6, 5, 8]), session([8, 8, 8])])
    expect(adjustment).toMatchObject({ action: 'repeat', suggestEarlyDeload: false })
  })

  it('a no-verdict previous session (deviated day) never escalates', () => {
    const deviated: AutoregSession = { prescribed: [], actual: [] }
    const adjustment = autoregulate(2.5, [session([6, 5, 8]), deviated])
    expect(adjustment).toMatchObject({ action: 'repeat' })
  })
})

describe('autoregReason', () => {
  it('names the evidence in the display unit', () => {
    const adjustment = autoregulate(2.5, [session([6, 5, 8])])!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'Missed 8 reps on 2 of 3 sets at 100 kg — repeating the load',
    )
    expect(autoregReason(adjustment, 'lb')).toContain('220.5 lb')
  })

  it('describes the back-off with its magnitude', () => {
    const adjustment = autoregulate(2.5, [session([6, 5, 8]), session([6, 6, 6])])!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'Second straight stall at 100 kg — backing off 10 kg (~10%)',
    )
  })
})

describe('applyAutoregToSets', () => {
  /** A scheme-derived working set at the given load. */
  const derivedSet = (overrides: Partial<DerivedSet> = {}): DerivedSet => ({
    setNumber: 1,
    setType: 'working',
    metricMode: 'reps_weight',
    repMin: 8,
    repMax: 12,
    rir: null,
    rpe: null,
    loadKg: 102.5,
    tempo: null,
    durationSec: null,
    distanceM: null,
    restSec: null,
    technique: null,
    derivedFrom: 'scheme',
    sourceIndex: 0,
    ...overrides,
  })

  it('caps working scheme sets at the stalled load on repeat (keeps the pre-autoreg value)', () => {
    // Arrange — linear would prescribe 102.5; the lifter stalled at 100
    const adjustment = autoregulate(2.5, [session([6, 5, 8])])!

    // Act
    const result = applyAutoregToSets([derivedSet()], adjustment)

    // Assert
    expect(result[0]).toMatchObject({ loadKg: 100, derivedFrom: 'autoreg', schemeLoadKg: 102.5 })
  })

  it('backs the target off the stalled load after two stalls', () => {
    // Arrange — second straight stall at 100 → target 90
    const adjustment = autoregulate(2.5, [session([6, 5, 8]), session([6, 6, 6])])!

    // Act
    const result = applyAutoregToSets([derivedSet()], adjustment)

    // Assert
    expect(result[0]).toMatchObject({ loadKg: 90, derivedFrom: 'autoreg' })
  })

  it('never raises a set already below the target (double-progression holds its base)', () => {
    // Arrange — the scheme already holds 100 (no top-of-range advance)
    const adjustment = autoregulate(2.5, [session([6, 5, 8])])!

    // Act
    const result = applyAutoregToSets([derivedSet({ loadKg: 100 })], adjustment)

    // Assert — repeat leaves 100 at 100, still stamped with the reason
    expect(result[0]).toMatchObject({ loadKg: 100, derivedFrom: 'autoreg' })
  })

  it('leaves warmups, template passthroughs, and load-less sets untouched', () => {
    // Arrange
    const adjustment = autoregulate(2.5, [session([6, 5, 8])])!
    const warmup = derivedSet({ setType: 'warmup', derivedFrom: 'template', loadKg: 60 })
    const template = derivedSet({ derivedFrom: 'template' })
    const loadless = derivedSet({ loadKg: null })

    // Act
    const result = applyAutoregToSets([warmup, template, loadless], adjustment)

    // Assert — byte-identical rows, no autoreg stamps
    expect(result).toEqual([warmup, template, loadless])
  })

  it('does not mutate the input sets', () => {
    // Arrange
    const adjustment = autoregulate(2.5, [session([6, 5, 8])])!
    const input = derivedSet()

    // Act
    applyAutoregToSets([input], adjustment)

    // Assert
    expect(input.loadKg).toBe(102.5)
    expect(input.derivedFrom).toBe('scheme')
  })
})
