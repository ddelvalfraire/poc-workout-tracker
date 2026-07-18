import { describe, it, expect } from 'vitest'
import {
  autoregulate,
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
