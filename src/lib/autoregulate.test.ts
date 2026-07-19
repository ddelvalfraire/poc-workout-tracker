import { describe, it, expect } from 'vitest'
import {
  autoregulate,
  autoregulateRange,
  autoregReason,
  applyAutoregToSets,
  backoffKg,
  sessionStall,
  type AutoregSession,
} from './autoregulate'
import type { DerivedSet } from './progression'

/** 3 working sets prescribed at 100 kg × 8-rep floor (setNumbers 1..3). */
const prescribed = () => [
  { setNumber: 1, repMin: 8, loadKg: 100 },
  { setNumber: 2, repMin: 8, loadKg: 100 },
  { setNumber: 3, repMin: 8, loadKg: 100 },
]

const session = (reps: (number | null)[], weightKg = 100): AutoregSession => ({
  prescribed: prescribed(),
  actual: reps.map((r, i) => ({
    setNumber: i + 1,
    reps: r,
    weightKg,
    completed: r !== null,
  })),
})

/** A session with per-set prescriptions and matching-load actuals. */
const mixedSession = (
  rows: { setNumber: number; repMin: number; loadKg: number; reps: number; setType?: string }[],
): AutoregSession => ({
  prescribed: rows.map(({ setNumber, repMin, loadKg, setType }) => ({
    setNumber,
    repMin,
    loadKg,
    setType,
  })),
  actual: rows.map(({ setNumber, loadKg, reps, setType }) => ({
    setNumber,
    reps,
    weightKg: loadKg,
    completed: true,
    setType,
  })),
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

  it('keeps a lb→kg round-trip attempt scorable (epsilon 0.05)', () => {
    // 5.01 kg prescription displayed as 11 lb and stored back as 4.99 kg —
    // 0.02 kg of unit drift must not exclude an at-load attempt.
    const s: AutoregSession = {
      prescribed: [{ setNumber: 1, repMin: 8, loadKg: 5.01 }],
      actual: [{ setNumber: 1, reps: 5, weightKg: 4.99, completed: true }],
    }
    expect(sessionStall(s)).toEqual({
      missedSets: 1,
      scorableSets: 1,
      repFloor: 8,
      loadKg: 5.01,
    })
  })

  it('ignores warm-up sets on both sides', () => {
    const s: AutoregSession = {
      prescribed: [{ setNumber: 1, repMin: 5, loadKg: 60, setType: 'warmup' }, ...prescribed()],
      actual: [
        { setNumber: 1, reps: 1, weightKg: 60, completed: true, setType: 'warmup' },
        { setNumber: 2, reps: 8, weightKg: 100, completed: true },
        { setNumber: 3, reps: 8, weightKg: 100, completed: true },
      ],
    }
    // Only prescribed #2/#3 pair with actuals (both hit the floor) — the
    // warmup miss (1 rep vs 5) never counts.
    expect(sessionStall(s)).toBeNull()
  })

  it('pairs by setNumber, not position: a skipped middle row cannot shift the frame', () => {
    // Arrange — warmup #1, working #2, amrap #3, working #4; the lifter never
    // logged the amrap row. A positional zip would score actual #4 against
    // prescribed #3's frame; setNumber pairing scores each against its own.
    const s: AutoregSession = {
      prescribed: [
        { setNumber: 1, repMin: 5, loadKg: 60, setType: 'warmup' },
        { setNumber: 2, repMin: 8, loadKg: 100 },
        { setNumber: 3, repMin: 1, loadKg: 90, setType: 'amrap' },
        { setNumber: 4, repMin: 8, loadKg: 100 },
      ],
      actual: [
        { setNumber: 1, reps: 5, weightKg: 60, completed: true, setType: 'warmup' },
        { setNumber: 2, reps: 9, weightKg: 100, completed: true },
        { setNumber: 4, reps: 8, weightKg: 100, completed: true },
      ],
    }

    // Assert — both working pairs hit their floors: no stall.
    expect(sessionStall(s)).toBeNull()
  })

  it('ignores extra logged sets with no prescribed counterpart', () => {
    const s = session([8, 8, 8])
    const withExtra: AutoregSession = {
      ...s,
      actual: [...s.actual, { setNumber: 4, reps: 2, weightKg: 100, completed: true }],
    }
    expect(sessionStall(withExtra)).toBeNull()
  })

  it('names the HEAVIEST missed set in the evidence, not the last-iterated one', () => {
    // Arrange — top set 100 missed, then a lighter 90 volume set missed.
    const s = mixedSession([
      { setNumber: 1, repMin: 5, loadKg: 100, reps: 3 },
      { setNumber: 2, repMin: 8, loadKg: 90, reps: 6 },
      { setNumber: 3, repMin: 8, loadKg: 90, reps: 8 },
    ])

    // Assert — evidence speaks about the 100 kg set (floor 5), whatever the
    // iteration order.
    expect(sessionStall(s)).toEqual({
      missedSets: 2,
      scorableSets: 3,
      repFloor: 5,
      loadKg: 100,
    })
  })

  it('returns null (no verdict) for a session with nothing scorable', () => {
    expect(sessionStall({ prescribed: [], actual: [] })).toBeNull()
    expect(
      sessionStall({
        prescribed: [{ setNumber: 1, repMin: null, loadKg: null }],
        actual: [],
      }),
    ).toBeNull()
  })

  it('treats snapshot-less history (null prescribed fields) as unscorable — cold-start silence', () => {
    // Pre-migration rows carry no prescribed_* snapshot: nulls on every set.
    const preSnapshot: AutoregSession = {
      prescribed: [1, 2, 3].map((n) => ({ setNumber: n, repMin: null, loadKg: null })),
      actual: [1, 2, 3].map((n) => ({ setNumber: n, reps: 2, weightKg: 100, completed: true })),
    }
    expect(sessionStall(preSnapshot)).toBeNull()
    expect(autoregulate(2.5, [preSnapshot, preSnapshot, preSnapshot])).toBeNull()
  })

  it('never counts uncompleted or rep-less sets', () => {
    expect(sessionStall(session([null, null, 8]))).toBeNull()
  })
})

describe('backoffKg', () => {
  it('snaps ~10% to loadable increments', () => {
    expect(backoffKg(100, 2.5)).toBe(10)
  })

  it('backs off at least one increment on light lifts, but never more than 25%', () => {
    // One 25 kg "increment" off a 10 kg lift would invert the prescription:
    // the 25% cap beats the one-increment floor.
    expect(backoffKg(10, 25)).toBe(2.5)
    expect(backoffKg(10, 2.5)).toBe(2.5)
  })

  it('returns 0 on non-finite or non-positive inputs', () => {
    expect(backoffKg(Number.NaN, 2.5)).toBe(0)
    expect(backoffKg(100, Number.POSITIVE_INFINITY)).toBe(0)
    expect(backoffKg(100, 0)).toBe(0)
    expect(backoffKg(0, 2.5)).toBe(0)
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

  it('still repeats (no decrement) after only two consecutive stalls', () => {
    const adjustment = autoregulate(2.5, [session([6, 5, 8]), session([7, 6, 6])])
    expect(adjustment).toMatchObject({ action: 'repeat', deltaKg: 0, suggestEarlyDeload: false })
  })

  it('decrements ~10% and suggests the early deload after THREE consecutive stalls', () => {
    const adjustment = autoregulate(2.5, [
      session([6, 5, 8]),
      session([7, 6, 6]),
      session([6, 6, 7]),
    ])
    // 10% of 100 kg = 10 kg, already a multiple of 2.5 — the StrongLifts-
    // style deload after the third failed session, not a micro-step.
    expect(adjustment).toMatchObject({
      action: 'decrement',
      deltaKg: -10,
      suggestEarlyDeload: true,
    })
  })

  it('a clean session inside the streak keeps a fresh stall at repeat', () => {
    const adjustment = autoregulate(2.5, [
      session([6, 5, 8]),
      session([8, 8, 8]),
      session([6, 6, 6]),
    ])
    expect(adjustment).toMatchObject({ action: 'repeat', suggestEarlyDeload: false })
  })

  it('a no-verdict previous session (deviated day) never escalates', () => {
    const deviated: AutoregSession = { prescribed: [], actual: [] }
    const adjustment = autoregulate(2.5, [session([6, 5, 8]), deviated, session([6, 6, 6])])
    expect(adjustment).toMatchObject({ action: 'repeat' })
  })

  it('consults only the first three sessions (extras ignored)', () => {
    // A fourth stalled session beyond the window must not resurrect a broken
    // streak.
    const adjustment = autoregulate(2.5, [
      session([6, 5, 8]),
      session([7, 6, 6]),
      session([8, 8, 8]),
      session([5, 5, 5]),
    ])
    expect(adjustment).toMatchObject({ action: 'repeat' })
  })

  it('carries every non-warmup prescribed load of the stalled session, keyed by setNumber', () => {
    const s = mixedSession([
      { setNumber: 1, repMin: 5, loadKg: 100, reps: 3 },
      { setNumber: 2, repMin: 8, loadKg: 90, reps: 6 },
      { setNumber: 3, repMin: 1, loadKg: 80, reps: 10, setType: 'backoff' },
    ])
    const adjustment = autoregulate(2.5, [s])
    expect(adjustment?.stalledLoadBySetNumber).toEqual({ 1: 100, 2: 90, 3: 80 })
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
    const adjustment = autoregulate(2.5, [
      session([6, 5, 8]),
      session([6, 6, 6]),
      session([5, 6, 6]),
    ])!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'Third straight stall at 100 kg — backing off 10 kg (~10%)',
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

  it('caps each set against ITS OWN prescribed-at-stall load, never one global cap', () => {
    // Arrange — the top set PASSED at 100; the 90 kg volume sets failed.
    const stalled = mixedSession([
      { setNumber: 1, repMin: 5, loadKg: 100, reps: 5 },
      { setNumber: 2, repMin: 8, loadKg: 90, reps: 5 },
      { setNumber: 3, repMin: 8, loadKg: 90, reps: 6 },
    ])
    const adjustment = autoregulate(2.5, [stalled])!
    const nextWeek = [
      derivedSet({ setNumber: 1, loadKg: 102.5 }),
      derivedSet({ setNumber: 2, loadKg: 92.5, sourceIndex: 1 }),
      derivedSet({ setNumber: 3, loadKg: 92.5, sourceIndex: 2 }),
    ]

    // Act
    const result = applyAutoregToSets(nextWeek, adjustment)

    // Assert — the passing 100 kg set holds 100 (NOT slashed to the 90 kg
    // evidence load); the failed volume sets repeat their own 90.
    expect(result.map((s) => s.loadKg)).toEqual([100, 90, 90])
  })

  it('scales every per-set cap by the back-off fraction on decrement', () => {
    // Arrange — three straight stalls; heaviest evidence 100 → −10 (10%).
    const stall = () =>
      mixedSession([
        { setNumber: 1, repMin: 5, loadKg: 100, reps: 3 },
        { setNumber: 2, repMin: 8, loadKg: 90, reps: 5 },
      ])
    const adjustment = autoregulate(2.5, [stall(), stall(), stall()])!
    const nextWeek = [
      derivedSet({ setNumber: 1, loadKg: 102.5 }),
      derivedSet({ setNumber: 2, loadKg: 92.5, sourceIndex: 1 }),
    ]

    // Act
    const result = applyAutoregToSets(nextWeek, adjustment)

    // Assert — each cap scales by 0.9: 100→90, 90→81.
    expect(adjustment.deltaKg).toBe(-10)
    expect(result.map((s) => s.loadKg)).toEqual([90, 81])
  })

  it('freezes backoff/amrap scheme sets at their own stalled loads (ratchet kill)', () => {
    // Arrange — working top set stalled at 100; a backoff set was prescribed
    // at 80. Next week the scheme would climb both.
    const stalled = mixedSession([
      { setNumber: 1, repMin: 5, loadKg: 100, reps: 3 },
      { setNumber: 2, repMin: 1, loadKg: 80, reps: 8, setType: 'backoff' },
    ])
    const adjustment = autoregulate(2.5, [stalled])!
    const nextWeek = [
      derivedSet({ setNumber: 1, loadKg: 102.5 }),
      derivedSet({ setNumber: 2, setType: 'backoff', loadKg: 82.5, sourceIndex: 1 }),
    ]

    // Act
    const result = applyAutoregToSets(nextWeek, adjustment)

    // Assert — the backoff set cannot climb past its frozen 80.
    expect(result.map((s) => s.loadKg)).toEqual([100, 80])
    expect(result[1].derivedFrom).toBe('autoreg')
  })

  it('leaves sets with no stalled-session counterpart untouched', () => {
    // Arrange — the stalled session prescribed sets 1..3; next week has an
    // extra 4th scheme set with no counterpart.
    const adjustment = autoregulate(2.5, [session([6, 5, 8])])!
    const extra = derivedSet({ setNumber: 4, loadKg: 102.5, sourceIndex: 3 })

    // Act
    const result = applyAutoregToSets([extra], adjustment)

    // Assert — byte-identical, no autoreg stamp
    expect(result).toEqual([extra])
  })

  it('never raises a set already below the target (a held base keeps its own load)', () => {
    // Arrange — the scheme already holds 100 (no advance)
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

/** 3 working sets prescribed 8–12 at `loadKg` with at-load actuals — the
 *  range-mode (double progression) fixture. Range tops ride separately (a
 *  plan parameter, not a snapshot). */
const ranged = (reps: number[], loadKg = 100): AutoregSession => ({
  prescribed: reps.map((_, i) => ({ setNumber: i + 1, repMin: 8, loadKg })),
  actual: reps.map((r, i) => ({
    setNumber: i + 1,
    reps: r,
    weightKg: loadKg,
    completed: true,
  })),
})

const TOPS = { 1: 12, 2: 12, 3: 12 }

describe('autoregulateRange', () => {
  it('returns null with no history or nothing scorable', () => {
    expect(autoregulateRange(2.5, [], TOPS)).toBeNull()
    expect(autoregulateRange(2.5, [{ prescribed: [], actual: [] }], TOPS)).toBeNull()
  })

  it('stays silent on snapshot-less history (cold start by design)', () => {
    const preSnapshot: AutoregSession = {
      prescribed: [1, 2, 3].map((n) => ({ setNumber: n, repMin: null, loadKg: null })),
      actual: [1, 2, 3].map((n) => ({ setNumber: n, reps: 12, weightKg: 100, completed: true })),
    }
    expect(autoregulateRange(2.5, [preSnapshot], TOPS)).toBeNull()
  })

  it('proposes a step when every working set fills the range top at the prescribed load', () => {
    const adjustment = autoregulateRange(2.5, [ranged([12, 12, 12])], TOPS)
    expect(adjustment).toMatchObject({
      action: 'step',
      deltaKg: 2.5,
      suggestEarlyDeload: false,
      evidence: { loadKg: 100, repFloor: 12, missedSets: 0, scorableSets: 3 },
    })
  })

  it('one set under the top is NOT a fill — hold, and no stall from a first session', () => {
    const adjustment = autoregulateRange(2.5, [ranged([12, 12, 11])], TOPS)
    expect(adjustment).toMatchObject({
      action: 'repeat',
      deltaKg: 0,
      range: { stalls: 0, prevTotalReps: null },
    })
  })

  it('adding reps below the top holds the load without a stall (progress-by-reps)', () => {
    const adjustment = autoregulateRange(2.5, [ranged([10, 10, 10]), ranged([9, 9, 9])], TOPS)
    expect(adjustment).toMatchObject({
      action: 'repeat',
      suggestEarlyDeload: false,
      range: { stalls: 0, totalReps: 30, prevTotalReps: 27 },
    })
  })

  it('a fill wins over a stall (a repeated max-rep session steps again, not holds)', () => {
    const adjustment = autoregulateRange(2.5, [ranged([12, 12, 12]), ranged([12, 12, 12])], TOPS)
    expect(adjustment).toMatchObject({ action: 'step', deltaKg: 2.5 })
  })

  it('no total-rep gain at the same load is a stall — one or two only hold', () => {
    const flat = () => ranged([9, 9, 9])
    expect(autoregulateRange(2.5, [flat(), flat()], TOPS)).toMatchObject({
      action: 'repeat',
      range: { stalls: 1, totalReps: 27, prevTotalReps: 27 },
    })
    expect(autoregulateRange(2.5, [flat(), flat(), flat()], TOPS)).toMatchObject({
      action: 'repeat',
      suggestEarlyDeload: false,
      range: { stalls: 2 },
    })
  })

  it('rep redistribution without a total gain is still a stall', () => {
    // 8+10+9 = 27 vs 9+9+9 = 27 — moving reps between sets earned nothing.
    const adjustment = autoregulateRange(2.5, [ranged([8, 10, 9]), ranged([9, 9, 9])], TOPS)
    expect(adjustment).toMatchObject({ action: 'repeat', range: { stalls: 1 } })
  })

  it('three consecutive stalls (four flat sessions) back off ~10% and suggest the deload', () => {
    const flat = () => ranged([9, 9, 9])
    const adjustment = autoregulateRange(2.5, [flat(), flat(), flat(), flat()], TOPS)
    expect(adjustment).toMatchObject({
      action: 'decrement',
      deltaKg: -10,
      suggestEarlyDeload: true,
      range: { stalls: 3 },
    })
  })

  it('a load change between sessions resets the streak (not comparable at different loads)', () => {
    // Latest at 102.5, older flat sessions at 100 — the step already
    // happened, so "no rep gain" against the lighter frame is meaningless.
    const adjustment = autoregulateRange(
      2.5,
      [ranged([8, 8, 8], 102.5), ranged([9, 9, 9]), ranged([9, 9, 9]), ranged([9, 9, 9])],
      TOPS,
    )
    expect(adjustment).toMatchObject({ action: 'repeat', range: { stalls: 0 } })
  })

  it('warm-ups and unpaired amrap rows never score a fill or a total', () => {
    const s: AutoregSession = {
      prescribed: [
        { setNumber: 1, repMin: 5, loadKg: 60, setType: 'warmup' },
        { setNumber: 2, repMin: 8, loadKg: 100 },
        { setNumber: 3, repMin: 8, loadKg: 100 },
      ],
      actual: [
        { setNumber: 1, reps: 3, weightKg: 60, completed: true, setType: 'warmup' },
        { setNumber: 2, reps: 12, weightKg: 100, completed: true },
        { setNumber: 3, reps: 12, weightKg: 100, completed: true },
      ],
    }
    expect(autoregulateRange(2.5, [s], { 2: 12, 3: 12 })).toMatchObject({ action: 'step' })
  })

  it('a scorable set with no current range top makes the fill unconfirmable (hold)', () => {
    // Today's plan only knows tops for sets 1–2; set 3 hit 12 but can't
    // testify to a top the plan no longer names.
    const adjustment = autoregulateRange(2.5, [ranged([12, 12, 12])], { 1: 12, 2: 12 })
    expect(adjustment).toMatchObject({ action: 'repeat' })
  })

  it('sets attempted lighter than prescribed are excluded (self-regulation, not evidence)', () => {
    const s: AutoregSession = {
      prescribed: [1, 2, 3].map((n) => ({ setNumber: n, repMin: 8, loadKg: 100 })),
      actual: [
        { setNumber: 1, reps: 12, weightKg: 100, completed: true },
        { setNumber: 2, reps: 12, weightKg: 100, completed: true },
        // Dropped to 80 kg and maxed reps — never counted toward the fill.
        { setNumber: 3, reps: 12, weightKg: 80, completed: true },
      ],
    }
    const adjustment = autoregulateRange(2.5, [s], TOPS)
    expect(adjustment).toMatchObject({ action: 'step', evidence: { scorableSets: 2 } })
  })

  it('a null snapshot repMin is still scorable in range mode (the top is the target)', () => {
    const s: AutoregSession = {
      prescribed: [1, 2, 3].map((n) => ({ setNumber: n, repMin: null, loadKg: 100 })),
      actual: [1, 2, 3].map((n) => ({ setNumber: n, reps: 12, weightKg: 100, completed: true })),
    }
    expect(autoregulateRange(2.5, [s], TOPS)).toMatchObject({ action: 'step' })
  })

  it('consults only four sessions — a stall streak beyond the window cannot deepen', () => {
    const flat = () => ranged([9, 9, 9])
    // Five flat sessions: still 3 stalls (window 4), verdict identical.
    const adjustment = autoregulateRange(2.5, [flat(), flat(), flat(), flat(), flat()], TOPS)
    expect(adjustment).toMatchObject({ action: 'decrement', range: { stalls: 3 } })
  })
})

describe('applyAutoregToSets — range step', () => {
  const derivedSet = (overrides: Partial<DerivedSet> = {}): DerivedSet => ({
    setNumber: 1,
    setType: 'working',
    metricMode: 'reps_weight',
    repMin: 8,
    repMax: 12,
    rir: null,
    rpe: null,
    loadKg: 100,
    tempo: null,
    durationSec: null,
    distanceM: null,
    restSec: null,
    technique: null,
    derivedFrom: 'scheme',
    sourceIndex: 0,
    ...overrides,
  })

  it('raises a still-held double-progression base to the earned next load', () => {
    // Arrange — the range filled at 100; the DP scheme still derives 100.
    const adjustment = autoregulateRange(2.5, [ranged([12, 12, 12])], TOPS)!

    // Act
    const result = applyAutoregToSets([derivedSet()], adjustment)

    // Assert — the ONE case autoreg may raise: prescribed-at-fill + step.
    expect(result[0]).toMatchObject({ loadKg: 102.5, derivedFrom: 'autoreg', schemeLoadKg: 100 })
  })

  it('pulls a linear scheme that ran ahead back to one honest step', () => {
    const adjustment = autoregulateRange(2.5, [ranged([12, 12, 12])], TOPS)!
    const result = applyAutoregToSets([derivedSet({ loadKg: 107.5 })], adjustment)
    expect(result[0]).toMatchObject({ loadKg: 102.5, schemeLoadKg: 107.5 })
  })

  it('steps each set from ITS OWN prescribed-at-fill load, warmups untouched', () => {
    const s: AutoregSession = {
      prescribed: [
        { setNumber: 1, repMin: 5, loadKg: 60, setType: 'warmup' },
        { setNumber: 2, repMin: 8, loadKg: 100 },
        { setNumber: 3, repMin: 8, loadKg: 90 },
      ],
      actual: [
        { setNumber: 2, reps: 12, weightKg: 100, completed: true },
        { setNumber: 3, reps: 12, weightKg: 90, completed: true },
      ],
    }
    const adjustment = autoregulateRange(2.5, [s], { 2: 12, 3: 12 })!
    const warmup = derivedSet({ setNumber: 1, setType: 'warmup', loadKg: 60 })
    const result = applyAutoregToSets(
      [warmup, derivedSet({ setNumber: 2 }), derivedSet({ setNumber: 3, loadKg: 90 })],
      adjustment,
    )
    expect(result.map((set) => set.loadKg)).toEqual([60, 102.5, 92.5])
    expect(result[0]).toEqual(warmup)
  })

  it('hold (repeat) still caps at the last prescribed load and never raises', () => {
    // Arrange — below the top: the model says add reps at 100, so a linear
    // scheme's 102.5 is pulled back to the held load.
    const adjustment = autoregulateRange(2.5, [ranged([9, 9, 9])], TOPS)!

    // Act
    const result = applyAutoregToSets([derivedSet({ loadKg: 102.5 })], adjustment)

    // Assert
    expect(result[0]).toMatchObject({ loadKg: 100, derivedFrom: 'autoreg', schemeLoadKg: 102.5 })
  })
})

describe('autoregReason — range mode', () => {
  it('names the step and its target load', () => {
    const adjustment = autoregulateRange(2.5, [ranged([12, 12, 12])], TOPS)!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'Range filled at 100 kg last session — stepping to 102.5 kg',
    )
  })

  it('explains a first-evidence hold without claiming a stall', () => {
    const adjustment = autoregulateRange(2.5, [ranged([9, 9, 9])], TOPS)!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'Range not filled at 100 kg — adding reps before the load steps',
    )
  })

  it('shows the flat totals on a rep stall', () => {
    const adjustment = autoregulateRange(2.5, [ranged([9, 9, 9]), ranged([9, 9, 9])], TOPS)!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'No new reps at 100 kg (27 vs 27) — holding the load',
    )
  })

  it('describes the three-session back-off with its magnitude', () => {
    const flat = () => ranged([9, 9, 9])
    const adjustment = autoregulateRange(2.5, [flat(), flat(), flat(), flat()], TOPS)!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'No new reps at 100 kg for 3 straight sessions — backing off 10 kg (~10%)',
    )
  })
})
