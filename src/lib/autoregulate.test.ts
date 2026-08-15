import { describe, it, expect } from 'vitest'
import {
  autoregulate,
  autoregulateRange,
  autoregulateAnchor,
  autoregulateEarlyDeload,
  autoregReason,
  applyAutoregToSets,
  applyDietPhaseToAdjustment,
  backoffKg,
  sessionBeatsTop,
  sessionStall,
  type AutoregRangeRow,
  type AutoregSession,
} from './autoregulate'
import type { DerivedSet } from './progression'

const DAY_MS = 24 * 60 * 60 * 1000
const BASE_MS = Date.UTC(2026, 6, 30)

/** Stamps descending startedAtMs by array position — fixtures written
 *  newest-first stay newest-first under the engine's defensive sort (H6). */
const seq = (...sessions: AutoregSession[]): AutoregSession[] =>
  sessions.map((s, i) => ({ ...s, startedAtMs: BASE_MS - i * DAY_MS }))

/** 3 working sets prescribed at 100 kg × 8-rep floor (setNumbers 1..3). */
const prescribed = () => [
  { setNumber: 1, repMin: 8, loadKg: 100 },
  { setNumber: 2, repMin: 8, loadKg: 100 },
  { setNumber: 3, repMin: 8, loadKg: 100 },
]

const session = (reps: (number | null)[], weightKg = 100): AutoregSession => ({
  startedAtMs: 0,
  prescribed: prescribed(),
  actual: reps.map((r, i) => ({
    setNumber: i + 1,
    reps: r,
    weightKg,
    completed: r !== null,
  })),
})

/** Like `session` but prescribed AND performed at `loadKg` — the H2 fixture. */
const sessionAt = (loadKg: number, reps: number[]): AutoregSession => ({
  startedAtMs: 0,
  prescribed: reps.map((_, i) => ({ setNumber: i + 1, repMin: 8, loadKg })),
  actual: reps.map((r, i) => ({ setNumber: i + 1, reps: r, weightKg: loadKg, completed: true })),
})

/** A session with per-set prescriptions and matching-load actuals. */
const mixedSession = (
  rows: { setNumber: number; repMin: number; loadKg: number; reps: number; setType?: string }[],
): AutoregSession => ({
  startedAtMs: 0,
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
  it('C1: ANY scorable working set under the floor stalls the session (8,8,6 is a failed session)', () => {
    // StrongLifts/Starting Strength: one missed set fails the session — the
    // old half-threshold let the linear increment ride over 8,8,6.
    expect(sessionStall(session([8, 8, 6]), 'all-sets')).toEqual({
      missedSets: 1,
      scorableSets: 3,
      repFloor: 8,
      loadKg: 100,
    })
  })

  it('flags a session missing the floor on two of three sets', () => {
    expect(sessionStall(session([8, 6, 5]), 'all-sets')).toEqual({
      missedSets: 2,
      scorableSets: 3,
      repFloor: 8,
      loadKg: 100,
    })
  })

  it('excludes sets attempted lighter than prescribed (self-regulation feeds follow-down, not a stall)', () => {
    // All sets at 80 kg vs 100 prescribed: zero at-load pairs → no verdict.
    expect(sessionStall(session([5, 5, 5], 80), 'all-sets')).toBeNull()
  })

  it('keeps a lb→kg round-trip attempt scorable (epsilon 0.05)', () => {
    // 5.01 kg prescription displayed as 11 lb and stored back as 4.99 kg —
    // 0.02 kg of unit drift must not exclude an at-load attempt.
    const s: AutoregSession = {
      startedAtMs: 0,
      prescribed: [{ setNumber: 1, repMin: 8, loadKg: 5.01 }],
      actual: [{ setNumber: 1, reps: 5, weightKg: 4.99, completed: true }],
    }
    expect(sessionStall(s, 'all-sets')).toEqual({
      missedSets: 1,
      scorableSets: 1,
      repFloor: 8,
      loadKg: 5.01,
    })
  })

  it('ignores warm-up sets on both sides', () => {
    const s: AutoregSession = {
      startedAtMs: 0,
      prescribed: [{ setNumber: 1, repMin: 5, loadKg: 60, setType: 'warmup' }, ...prescribed()],
      actual: [
        { setNumber: 1, reps: 1, weightKg: 60, completed: true, setType: 'warmup' },
        { setNumber: 2, reps: 8, weightKg: 100, completed: true },
        { setNumber: 3, reps: 8, weightKg: 100, completed: true },
      ],
    }
    // Only prescribed #2/#3 pair with actuals (both hit the floor); the
    // warmup miss (1 rep vs 5) never counts.
    expect(sessionStall(s, 'all-sets')).toBeNull()
  })

  it('pairs by setNumber WITHIN the session: a skipped middle row cannot shift the frame', () => {
    // Arrange — warmup #1, working #2, amrap #3, working #4; the lifter never
    // logged the amrap row. A positional zip would score actual #4 against
    // prescribed #3's frame; setNumber pairing scores each against its own.
    const s: AutoregSession = {
      startedAtMs: 0,
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
    expect(sessionStall(s, 'all-sets')).toBeNull()
  })

  it('ignores extra logged sets with no prescribed counterpart', () => {
    const s = session([8, 8, 8])
    const withExtra: AutoregSession = {
      ...s,
      actual: [...s.actual, { setNumber: 4, reps: 2, weightKg: 100, completed: true }],
    }
    expect(sessionStall(withExtra, 'all-sets')).toBeNull()
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
    expect(sessionStall(s, 'all-sets')).toEqual({
      missedSets: 2,
      scorableSets: 3,
      repFloor: 5,
      loadKg: 100,
    })
  })

  it('returns null (no verdict) for a session with nothing scorable', () => {
    expect(sessionStall({ startedAtMs: 0, prescribed: [], actual: [] }, 'all-sets')).toBeNull()
    expect(
      sessionStall({
        startedAtMs: 0,
        prescribed: [{ setNumber: 1, repMin: null, loadKg: null }],
        actual: [],
      }, 'all-sets'),
    ).toBeNull()
  })

  it('treats snapshot-less history (null prescribed fields) as unscorable — cold-start silence', () => {
    // Pre-migration rows carry no prescribed_* snapshot: nulls on every set.
    const preSnapshot: AutoregSession = {
      startedAtMs: 0,
      prescribed: [1, 2, 3].map((n) => ({ setNumber: n, repMin: null, loadKg: null })),
      actual: [1, 2, 3].map((n) => ({ setNumber: n, reps: 2, weightKg: 100, completed: true })),
    }
    expect(sessionStall(preSnapshot, 'all-sets')).toBeNull()
    expect(autoregulate(2.5, seq(preSnapshot, preSnapshot, preSnapshot), 'all-sets')).toBeNull()
  })

  it('never counts uncompleted or rep-less sets', () => {
    expect(sessionStall(session([null, null, 8]), 'all-sets')).toBeNull()
  })

  it('M3: one surviving set of three cannot speak for the exercise (evidence quorum)', () => {
    // Two sets skipped, the survivor missed: below ceil(3/2) scorable pairs
    // there is NO verdict of any kind — a warm-up retag or skip-heavy day
    // must not let one set stall the lift.
    const s: AutoregSession = {
      startedAtMs: 0,
      prescribed: prescribed(),
      actual: [{ setNumber: 3, reps: 5, weightKg: 100, completed: true }],
    }
    expect(sessionStall(s, 'all-sets')).toBeNull()
    expect(autoregulate(2.5, [s], 'all-sets')).toBeNull()
  })
})

describe("stall policy 'first-set'", () => {
  it("8,8,6 progresses under 'first-set' (top set hit its floor) but stalls under 'all-sets'", () => {
    // Arrange
    const s = session([8, 8, 6])

    // Act + Assert — the same session, two verdicts: the policy decides.
    expect(sessionStall(s, 'first-set')).toBeNull()
    expect(autoregulate(2.5, seq(s), 'first-set')).toBeNull()
    expect(sessionStall(s, 'all-sets')).toMatchObject({ missedSets: 1, scorableSets: 3 })
    expect(autoregulate(2.5, seq(s), 'all-sets')).toMatchObject({ action: 'repeat' })
  })

  it('a first-set miss stalls even when every other set passes, naming the governing set', () => {
    // Arrange — set 1 (heaviest, governing) misses; the volume sets pass.
    const s = mixedSession([
      { setNumber: 1, repMin: 8, loadKg: 100, reps: 6 },
      { setNumber: 2, repMin: 8, loadKg: 90, reps: 8 },
      { setNumber: 3, repMin: 8, loadKg: 90, reps: 8 },
    ])

    // Act
    const stall = sessionStall(s, 'first-set')
    const verdict = autoregulate(2.5, seq(s), 'first-set')

    // Assert — evidence IS the governing set: its load, its floor, 1-of-1.
    expect(stall).toEqual({ missedSets: 1, scorableSets: 1, repFloor: 8, loadKg: 100 })
    expect(verdict).toMatchObject({
      action: 'repeat',
      evidence: { missedSets: 1, scorableSets: 1, repFloor: 8, loadKg: 100 },
    })
  })

  it('an unscorable (skipped) first set is NO verdict — never a fallback to another set', () => {
    // Arrange — set 1 skipped, sets 2–3 miss their floors: under 'all-sets'
    // this is a stall; under 'first-set' the governing set stayed silent.
    const s = session([null, 6, 5])

    // Act + Assert
    expect(sessionStall(s, 'first-set')).toBeNull()
    expect(autoregulate(2.5, seq(s), 'first-set')).toBeNull()
    expect(sessionStall(s, 'all-sets')).toMatchObject({ missedSets: 2 })
  })

  it('a lighter-attempted first set is unscorable — silence, not a stall', () => {
    // Arrange — set 1 done at 80 vs 100 prescribed (feeds follow-down, not
    // a stall); the others at load and passing.
    const s: AutoregSession = {
      startedAtMs: 0,
      prescribed: prescribed(),
      actual: [
        { setNumber: 1, reps: 8, weightKg: 80, completed: true },
        { setNumber: 2, reps: 8, weightKg: 100, completed: true },
        { setNumber: 3, reps: 8, weightKg: 100, completed: true },
      ],
    }

    // Act + Assert
    expect(sessionStall(s, 'first-set')).toBeNull()
  })

  it('a retagged (warmup) first set is unscorable — silence, not a fallback', () => {
    // Arrange — the logged set 1 was retagged to warmup; sets 2–3 pass.
    const s: AutoregSession = {
      startedAtMs: 0,
      prescribed: prescribed(),
      actual: [
        { setNumber: 1, reps: 6, weightKg: 100, completed: true, setType: 'warmup' },
        { setNumber: 2, reps: 8, weightKg: 100, completed: true },
        { setNumber: 3, reps: 8, weightKg: 100, completed: true },
      ],
    }

    // Act + Assert
    expect(sessionStall(s, 'first-set')).toBeNull()
  })

  it("the governing set's scorability IS the quorum: 1-of-3 scorable still stalls", () => {
    // Arrange — sets 2–3 skipped: the half-count quorum (M3) silences
    // 'all-sets', but the governing set testified and missed.
    const s = session([6, null, null])

    // Act + Assert
    expect(sessionStall(s, 'all-sets')).toBeNull()
    expect(sessionStall(s, 'first-set')).toMatchObject({ missedSets: 1, scorableSets: 1 })
    expect(autoregulate(2.5, seq(s), 'first-set')).toMatchObject({ action: 'repeat' })
  })

  it('three first-set stalls at the same top load decrement (streak intact)', () => {
    // Arrange
    const stalled = session([6, 8, 8])

    // Act
    const verdict = autoregulate(2.5, seq(stalled, stalled, stalled), 'first-set')

    // Assert
    expect(verdict).toMatchObject({ action: 'decrement', suggestEarlyDeload: true })
  })

  it('H2: a prescribed-load change still resets the first-set streak', () => {
    // Arrange — latest stall at 102.5 after two stalls at 100: fresh streak.
    const verdict = autoregulate(
      2.5,
      seq(sessionAt(102.5, [6, 8, 8]), sessionAt(100, [6, 8, 8]), sessionAt(100, [6, 8, 8])),
      'first-set',
    )

    // Assert
    expect(verdict).toMatchObject({ action: 'repeat', suggestEarlyDeload: false })
  })

  it('H1: follow-down is unaffected by the policy', () => {
    // Arrange — three comparable all-lighter sessions with floors met.
    const lighter = session([8, 8, 8], 90)

    // Act
    const verdict = autoregulate(2.5, seq(lighter, lighter, lighter), 'first-set')

    // Assert — the anchor-down proposal fires exactly as under 'all-sets'.
    expect(verdict).toMatchObject({
      action: 'anchor',
      anchor: { fromLoadKg: 100, toLoadKg: 90 },
    })
  })

  it("M4: the early-deload flag scores by the policy — 8,8,6 × 3 flags only under 'all-sets'", () => {
    // Arrange
    const s = session([8, 8, 6])
    const window = seq(s, s, s)

    // Act + Assert
    expect(autoregulateEarlyDeload(window, 'all-sets')).toMatchObject({ action: 'flag' })
    expect(autoregulateEarlyDeload(window, 'first-set')).toBeNull()
  })

  it("M4: three straight governing-set misses flag under 'first-set'", () => {
    // Arrange
    const s = session([6, 8, 8])

    // Act + Assert
    expect(autoregulateEarlyDeload(seq(s, s, s), 'first-set')).toMatchObject({
      action: 'flag',
      suggestEarlyDeload: true,
    })
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
    expect(autoregulate(2.5, [], 'all-sets')).toBeNull()
    expect(autoregulate(2.5, [session([8, 8, 8])], 'all-sets')).toBeNull()
  })

  it('repeats the load after a single stall', () => {
    const adjustment = autoregulate(2.5, [session([6, 5, 8])], 'all-sets')
    expect(adjustment).toMatchObject({ action: 'repeat', deltaKg: 0, suggestEarlyDeload: false })
  })

  it('still repeats (no decrement) after only two consecutive stalls', () => {
    const adjustment = autoregulate(2.5, seq(session([6, 5, 8]), session([7, 6, 6])), 'all-sets')
    expect(adjustment).toMatchObject({ action: 'repeat', deltaKg: 0, suggestEarlyDeload: false })
  })

  it('decrements ~10% and suggests the early deload after THREE consecutive stalls', () => {
    const adjustment = autoregulate(
      2.5,
      seq(session([6, 5, 8]), session([7, 6, 6]), session([6, 6, 7])), 'all-sets')
    // 10% of 100 kg = 10 kg, already a multiple of 2.5 — the StrongLifts-
    // style deload after the third failed session, not a micro-step.
    expect(adjustment).toMatchObject({
      action: 'decrement',
      deltaKg: -10,
      suggestEarlyDeload: true,
    })
  })

  it('H2: a prescribed-load change resets the stall streak (no back-off cascade)', () => {
    // Two stalls at 90 (post-backoff) atop an older stall at 100: the third
    // stall in a row is NOT three stalls at one load — the streak restarts
    // when the prescribed top load moved, killing the 10%→10% cascade.
    const adjustment = autoregulate(
      2.5,
      seq(sessionAt(90, [6, 6, 5]), sessionAt(90, [6, 6, 6]), sessionAt(100, [6, 6, 6])), 'all-sets')
    expect(adjustment).toMatchObject({ action: 'repeat', suggestEarlyDeload: false })
  })

  it('a clean session inside the streak keeps a fresh stall at repeat', () => {
    const adjustment = autoregulate(
      2.5,
      seq(session([6, 5, 8]), session([8, 8, 8]), session([6, 6, 6])), 'all-sets')
    expect(adjustment).toMatchObject({ action: 'repeat', suggestEarlyDeload: false })
  })

  it('a no-verdict previous session (deviated day) never escalates', () => {
    const deviated: AutoregSession = { startedAtMs: 0, prescribed: [], actual: [] }
    const adjustment = autoregulate(2.5, seq(session([6, 5, 8]), deviated, session([6, 6, 6])), 'all-sets')
    expect(adjustment).toMatchObject({ action: 'repeat' })
  })

  it('consults only the first three sessions (extras ignored)', () => {
    // A fourth stalled session beyond the window must not resurrect a broken
    // streak.
    const adjustment = autoregulate(
      2.5,
      seq(session([6, 5, 8]), session([7, 6, 6]), session([8, 8, 8]), session([5, 5, 5])), 'all-sets')
    expect(adjustment).toMatchObject({ action: 'repeat' })
  })

  it('H6: a backwards-ordered array is re-sorted — the latest clean session yields null', () => {
    // Oldest-first input (two stalls, then the clean newest session): the
    // engine must sort by startedAtMs instead of trusting array order —
    // trusting it would have called this a repeat off the stale stall.
    const stalls = seq(session([5, 5, 5]), session([5, 5, 6]))
    const clean = { ...session([8, 8, 8]), startedAtMs: BASE_MS + DAY_MS }
    expect(autoregulate(2.5, [...stalls.reverse(), clean], 'all-sets')).toBeNull()
  })

  it('carries the stalled prescribed loads as ε-deduped descending buckets', () => {
    const s = mixedSession([
      { setNumber: 1, repMin: 5, loadKg: 100, reps: 3 },
      { setNumber: 2, repMin: 8, loadKg: 90, reps: 6 },
      { setNumber: 3, repMin: 1, loadKg: 80, reps: 10, setType: 'backoff' },
    ])
    const adjustment = autoregulate(2.5, [s], 'all-sets')
    expect(adjustment?.stalledLoads).toEqual([100, 90, 80])
  })
})

describe('autoregulate — follow-down (H1)', () => {
  /** Prescribed 100, worked at `weightKg` (≤95%) with the floors met. */
  const lighter = (weightKg = 90, reps: number[] = [8, 8, 8]) => session(reps, weightKg)

  it('H1: three comparable all-lighter sessions anchor the plan down to the used loads', () => {
    const adjustment = autoregulate(2.5, seq(lighter(), lighter(), lighter()), 'all-sets')
    expect(adjustment).toMatchObject({
      action: 'anchor',
      deltaKg: -10,
      suggestEarlyDeload: false,
      anchor: { fromLoadKg: 100, toLoadKg: 90 },
      anchorLoads: [{ prescribedLoadKg: 100, anchorKg: 90 }],
    })
  })

  it('one or two lighter sessions propose nothing yet (their own streak class)', () => {
    expect(autoregulate(2.5, seq(lighter()), 'all-sets')).toBeNull()
    expect(autoregulate(2.5, seq(lighter(), lighter()), 'all-sets')).toBeNull()
  })

  it('a lighter session missing its floors does not qualify', () => {
    // Working at 90 but under the 8-rep floor is a struggling session, not
    // self-regulation the plan should adopt.
    expect(autoregulate(2.5, seq(lighter(90, [5, 5, 5]), lighter(), lighter()), 'all-sets')).toBeNull()
  })

  it('an attempt between 95% and plan is ambiguous — never follow-down evidence', () => {
    // 97 kg vs 100 planned: neither at-load nor ≤95% — silence.
    expect(autoregulate(2.5, seq(lighter(97), lighter(97), lighter(97)), 'all-sets')).toBeNull()
  })

  it('a prescribed-load change inside the streak breaks comparability', () => {
    const atNinety: AutoregSession = {
      ...sessionAt(90, [8, 8, 8]),
      actual: [1, 2, 3].map((n) => ({ setNumber: n, reps: 8, weightKg: 80, completed: true })),
    }
    expect(autoregulate(2.5, seq(lighter(), lighter(), atNinety), 'all-sets')).toBeNull()
  })

  it('names the evidence in the reason line', () => {
    const adjustment = autoregulate(2.5, seq(lighter(), lighter(), lighter()), 'all-sets')!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'Worked at ~90 kg vs the planned 100 kg for 3 sessions — matching the plan to reality',
    )
  })

  it('applies the down-anchor to the scheme sets by load bucket', () => {
    const adjustment = autoregulate(2.5, seq(lighter(), lighter(), lighter()), 'all-sets')!
    const scheme: DerivedSet = {
      setNumber: 1,
      setType: 'working',
      metricMode: 'reps_weight',
      repMin: 8,
      repMax: null,
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
    }
    expect(applyAutoregToSets([scheme], adjustment)[0]).toMatchObject({
      loadKg: 90,
      derivedFrom: 'autoreg',
      schemeLoadKg: 102.5,
    })
  })
})

describe('autoregReason', () => {
  it('names the evidence in the display unit', () => {
    const adjustment = autoregulate(2.5, [session([6, 5, 8])], 'all-sets')!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'Missed 8 reps on 2 of 3 sets at 100 kg — repeating the load',
    )
    // 100 kg is 220.5 lb raw — the reason prints the loadable 220 lb (#226).
    expect(autoregReason(adjustment, 'lb')).toContain('220 lb')
  })

  it('quantizes lb loads to the 2.5 lb grid — never 66.6 lb (#226)', () => {
    // Prescribed and performed at 30.21 kg (66.6 lb raw) with missed reps.
    const adjustment = autoregulate(2.5, [sessionAt(30.21, [6, 6, 6])], 'all-sets')!
    const reason = autoregReason(adjustment, 'lb')
    expect(reason).toContain('67.5 lb')
    expect(reason).not.toContain('66.6')
  })

  it('describes the back-off with its magnitude', () => {
    const adjustment = autoregulate(
      2.5,
      seq(session([6, 5, 8]), session([6, 6, 6]), session([5, 6, 6])), 'all-sets')!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'Third straight stall at 100 kg — backing off 10 kg (~10%)',
    )
  })
})

describe('applyDietPhaseToAdjustment (diet-phase gate)', () => {
  const threeStalls = () =>
    autoregulate(2.5, seq(session([6, 5, 8]), session([6, 6, 6]), session([5, 6, 6])), 'all-sets')!

  it('is the IDENTITY for null / maintaining / bulking (byte-identity guarantee)', () => {
    const adjustment = threeStalls()
    expect(applyDietPhaseToAdjustment(adjustment, null)).toBe(adjustment)
    expect(applyDietPhaseToAdjustment(adjustment, 'maintaining')).toBe(adjustment)
    expect(applyDietPhaseToAdjustment(adjustment, 'bulking')).toBe(adjustment)
    expect(applyDietPhaseToAdjustment(null, 'cutting')).toBeNull()
  })

  it('cutting HOLDS the H2 auto-backoff: repeat at the stalled load, backoff carried', () => {
    // Arrange — the third-stall decrement (−10 kg off 100)
    const decrement = threeStalls()
    expect(decrement.action).toBe('decrement')

    // Act
    const held = applyDietPhaseToAdjustment(decrement, 'cutting')!

    // Assert — annotate-never-suppress: the flag stays, the cut is held
    expect(held).toMatchObject({
      action: 'repeat',
      deltaKg: 0,
      suggestEarlyDeload: true,
      phaseContext: 'cutting',
      heldBackoffKg: 10,
    })
    // The applied prescription HOLDS (caps at the stalled 100), never cuts.
    const sets: DerivedSet[] = [
      {
        setNumber: 1,
        setType: 'working',
        metricMode: 'reps_weight',
        repMin: 8,
        repMax: null,
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
      },
    ]
    expect(applyAutoregToSets(sets, held)[0].loadKg).toBe(100)
  })

  it('cutting ANNOTATES the M4 flag without suppressing it (loads untouched either way)', () => {
    const flag = autoregulateEarlyDeload(
      seq(session([6, 5, 8]), session([6, 6, 6]), session([5, 6, 6])),
      'all-sets',
    )!
    const annotated = applyDietPhaseToAdjustment(flag, 'cutting')!
    expect(annotated).toMatchObject({
      action: 'flag',
      deltaKg: 0,
      suggestEarlyDeload: true,
      phaseContext: 'cutting',
    })
    expect(annotated.heldBackoffKg).toBeUndefined()
  })

  it('cutting annotates a plain repeat and passes step/anchor through untouched', () => {
    const repeat = autoregulate(2.5, [session([6, 5, 8])], 'all-sets')!
    expect(applyDietPhaseToAdjustment(repeat, 'cutting')).toMatchObject({
      action: 'repeat',
      phaseContext: 'cutting',
    })
    // A filled range steps regardless of phase — progress is progress.
    const step = autoregulateRange(2.5, [ranged([12, 12, 12])], ROWS)!
    expect(step.action).toBe('step')
    expect(applyDietPhaseToAdjustment(step, 'cutting')).toBe(step)
  })

  it('reason lines: holding-is-the-win framing, never a strength-impairment claim', () => {
    const held = applyDietPhaseToAdjustment(threeStalls(), 'cutting')!
    expect(autoregReason(held, 'kg')).toBe(
      '3 stalls at 100 kg — expected while cutting; holding is the win. Deload only if sessions feel grindy',
    )
    const flag = applyDietPhaseToAdjustment(
      autoregulateEarlyDeload(
        seq(session([6, 5, 8]), session([6, 6, 6]), session([5, 6, 6])),
        'all-sets',
      ),
      'cutting',
    )!
    expect(autoregReason(flag, 'kg')).toBe(
      '3 stalls at 100 kg — expected while cutting; holding is the win. Deload only if sessions feel grindy',
    )
    const repeat = applyDietPhaseToAdjustment(
      autoregulate(2.5, [session([6, 5, 8])], 'all-sets'),
      'cutting',
    )!
    expect(autoregReason(repeat, 'kg')).toBe(
      'Missed 8 reps on 2 of 3 sets at 100 kg — repeating the load (expected while cutting)',
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
    const adjustment = autoregulate(2.5, [session([6, 5, 8])], 'all-sets')!

    // Act
    const result = applyAutoregToSets([derivedSet()], adjustment)

    // Assert
    expect(result[0]).toMatchObject({ loadKg: 100, derivedFrom: 'autoreg', schemeLoadKg: 102.5 })
  })

  it('caps each set against ITS OWN load bucket, never one global cap', () => {
    // Arrange — the top set PASSED at 100; the 90 kg volume sets failed.
    const stalled = mixedSession([
      { setNumber: 1, repMin: 5, loadKg: 100, reps: 5 },
      { setNumber: 2, repMin: 8, loadKg: 90, reps: 5 },
      { setNumber: 3, repMin: 8, loadKg: 90, reps: 6 },
    ])
    const adjustment = autoregulate(2.5, [stalled], 'all-sets')!
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

  it('C2: insert-set shift — the stalled set is still capped after renumbering', () => {
    // Arrange — the top set stalled at 100 (sole working set, setNumber 1).
    // A program edit then INSERTS a new light set ahead of it, so the old
    // top set is renumbered to 2. Positional evidence would let it escape
    // its cap; load-keyed evidence follows the load, not the number.
    const adjustment = autoregulate(2.5, [
      mixedSession([{ setNumber: 1, repMin: 5, loadKg: 100, reps: 3 }]),
    ], 'all-sets')!
    const nextWeek = [
      derivedSet({ setNumber: 1, loadKg: 60 }),
      derivedSet({ setNumber: 2, loadKg: 102.5, sourceIndex: 1 }),
    ]

    // Act
    const result = applyAutoregToSets(nextWeek, adjustment)

    // Assert — the renumbered top set is capped at its stalled 100; the new
    // light set is judged on its own load.
    expect(result[1]).toMatchObject({ loadKg: 100, derivedFrom: 'autoreg', schemeLoadKg: 102.5 })
    expect(result[0]).toEqual(nextWeek[0])
  })

  it('C2: a new set at the old position, below every evidence load, is untouched', () => {
    // Arrange — evidence exists only at 100; the new 60 kg set occupies the
    // stalled set's OLD setNumber. Positional evidence would cap/mislabel
    // it; load-keyed evidence has nothing at/below 60 to say.
    const adjustment = autoregulate(2.5, [
      mixedSession([{ setNumber: 1, repMin: 5, loadKg: 100, reps: 3 }]),
    ], 'all-sets')!
    const newcomer = derivedSet({ setNumber: 1, loadKg: 60 })

    // Act
    const result = applyAutoregToSets([newcomer], adjustment)

    // Assert — byte-identical, no autoreg stamp.
    expect(result).toEqual([newcomer])
  })

  it("C2: a 140 kg top set landing on a 20 kg set's old position is not capped by foreign evidence", () => {
    // Arrange — the stalled session had a 140 top set (missed) and a 20 kg
    // accessory. A reorder swaps their setNumbers for next week. The old
    // positional map capped the 140 set at 20 — executed corruption.
    const stalled = mixedSession([
      { setNumber: 1, repMin: 5, loadKg: 140, reps: 3 },
      { setNumber: 2, repMin: 12, loadKg: 20, reps: 12 },
    ])
    const adjustment = autoregulate(2.5, [stalled], 'all-sets')!
    const nextWeek = [
      // The 20 kg accessory now sits at setNumber 1, the top set at 2.
      derivedSet({ setNumber: 1, loadKg: 22.5 }),
      derivedSet({ setNumber: 2, loadKg: 142.5, sourceIndex: 1 }),
    ]

    // Act
    const result = applyAutoregToSets(nextWeek, adjustment)

    // Assert — each set caps against its OWN load bucket: 22.5 → 20 (its
    // frozen accessory load), 142.5 → 140 (its stalled top), never 20.
    expect(result.map((s) => s.loadKg)).toEqual([20, 140])
  })

  it('scales every per-bucket cap by the back-off fraction on decrement', () => {
    // Arrange — three straight stalls; heaviest evidence 100 → −10 (10%).
    const stall = () =>
      mixedSession([
        { setNumber: 1, repMin: 5, loadKg: 100, reps: 3 },
        { setNumber: 2, repMin: 8, loadKg: 90, reps: 5 },
      ])
    const adjustment = autoregulate(2.5, seq(stall(), stall(), stall()), 'all-sets')!
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
    const adjustment = autoregulate(2.5, [stalled], 'all-sets')!
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

  it('never raises a set already below the target (a held base keeps its own load)', () => {
    // Arrange — the scheme already holds 100 (no advance)
    const adjustment = autoregulate(2.5, [session([6, 5, 8])], 'all-sets')!

    // Act
    const result = applyAutoregToSets([derivedSet({ loadKg: 100 })], adjustment)

    // Assert — repeat leaves 100 at 100, still stamped with the reason
    expect(result[0]).toMatchObject({ loadKg: 100, derivedFrom: 'autoreg' })
  })

  it('leaves warmups, template passthroughs, and load-less sets untouched', () => {
    // Arrange
    const adjustment = autoregulate(2.5, [session([6, 5, 8])], 'all-sets')!
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
    const adjustment = autoregulate(2.5, [session([6, 5, 8])], 'all-sets')!
    const input = derivedSet()

    // Act
    applyAutoregToSets([input], adjustment)

    // Assert
    expect(input.loadKg).toBe(102.5)
    expect(input.derivedFrom).toBe('scheme')
  })
})

/** 3 working sets prescribed 8–12 at `loadKg` with at-load actuals — the
 *  range-mode (double progression) fixture. Range rows ride separately (a
 *  plan parameter, not a snapshot). */
const ranged = (reps: number[], loadKg = 100): AutoregSession => ({
  startedAtMs: 0,
  prescribed: reps.map((_, i) => ({ setNumber: i + 1, repMin: 8, loadKg })),
  actual: reps.map((r, i) => ({
    setNumber: i + 1,
    reps: r,
    weightKg: loadKg,
    completed: true,
  })),
})

/** Uniform-top plan rows — the common all-ranged template. */
const rows = (count = 3, repMax = 12, loadKg = 100): AutoregRangeRow[] =>
  Array.from({ length: count }, () => ({ loadKg, repMax }))

const ROWS = rows()

describe('autoregulateRange', () => {
  it('returns null with no history or nothing scorable', () => {
    expect(autoregulateRange(2.5, [], ROWS)).toBeNull()
    expect(
      autoregulateRange(2.5, [{ startedAtMs: 0, prescribed: [], actual: [] }], ROWS),
    ).toBeNull()
  })

  it('stays silent on snapshot-less history (cold start by design)', () => {
    const preSnapshot: AutoregSession = {
      startedAtMs: 0,
      prescribed: [1, 2, 3].map((n) => ({ setNumber: n, repMin: null, loadKg: null })),
      actual: [1, 2, 3].map((n) => ({ setNumber: n, reps: 12, weightKg: 100, completed: true })),
    }
    expect(autoregulateRange(2.5, [preSnapshot], ROWS)).toBeNull()
  })

  it('proposes a step when every working set fills the range top at the prescribed load', () => {
    const adjustment = autoregulateRange(2.5, [ranged([12, 12, 12])], ROWS)
    expect(adjustment).toMatchObject({
      action: 'step',
      deltaKg: 2.5,
      suggestEarlyDeload: false,
      evidence: { loadKg: 100, repFloor: 12, missedSets: 0, scorableSets: 3 },
    })
  })

  it('one set under the top is NOT a fill — hold, and no stall from a first session', () => {
    const adjustment = autoregulateRange(2.5, [ranged([12, 12, 11])], ROWS)
    expect(adjustment).toMatchObject({
      action: 'repeat',
      deltaKg: 0,
      range: { stalls: 0, prevTotalReps: null },
    })
  })

  it('adding reps below the top holds the load without a stall (progress-by-reps)', () => {
    const adjustment = autoregulateRange(2.5, seq(ranged([10, 10, 10]), ranged([9, 9, 9])), ROWS)
    expect(adjustment).toMatchObject({
      action: 'repeat',
      suggestEarlyDeload: false,
      range: { stalls: 0, totalReps: 30, prevTotalReps: 27 },
    })
  })

  it('a fill wins over a stall (a repeated max-rep session steps again, not holds)', () => {
    const adjustment = autoregulateRange(2.5, seq(ranged([12, 12, 12]), ranged([12, 12, 12])), ROWS)
    expect(adjustment).toMatchObject({ action: 'step', deltaKg: 2.5 })
  })

  it('no total-rep gain at the same load is a stall — one or two only hold', () => {
    const flat = () => ranged([9, 9, 9])
    expect(autoregulateRange(2.5, seq(flat(), flat()), ROWS)).toMatchObject({
      action: 'repeat',
      range: { stalls: 1, totalReps: 27, prevTotalReps: 27 },
    })
    expect(autoregulateRange(2.5, seq(flat(), flat(), flat()), ROWS)).toMatchObject({
      action: 'repeat',
      suggestEarlyDeload: false,
      range: { stalls: 2 },
    })
  })

  it('rep redistribution without a total gain is still a stall', () => {
    // 8+10+9 = 27 vs 9+9+9 = 27 — moving reps between sets earned nothing.
    const adjustment = autoregulateRange(2.5, seq(ranged([8, 10, 9]), ranged([9, 9, 9])), ROWS)
    expect(adjustment).toMatchObject({ action: 'repeat', range: { stalls: 1 } })
  })

  it('three consecutive stalls (four flat sessions) back off ~10% and suggest the deload', () => {
    const flat = () => ranged([9, 9, 9])
    const adjustment = autoregulateRange(2.5, seq(flat(), flat(), flat(), flat()), ROWS)
    expect(adjustment).toMatchObject({
      action: 'decrement',
      deltaKg: -10,
      suggestEarlyDeload: true,
      range: { stalls: 3 },
    })
  })

  it('M1: a flat streak within one rep of the fill target HOLDs instead of decrementing', () => {
    // 12+12+11 = 35 of a 36-rep fill, four sessions running: the model is
    // densifying at the top of the range — nobody cuts 10% off 35/36.
    const nearFill = () => ranged([12, 12, 11])
    const adjustment = autoregulateRange(
      2.5,
      seq(nearFill(), nearFill(), nearFill(), nearFill()),
      ROWS,
    )
    expect(adjustment).toMatchObject({
      action: 'repeat',
      deltaKg: 0,
      suggestEarlyDeload: false,
      range: { stalls: 3 },
    })
  })

  it('a load change between sessions resets the streak (not comparable at different loads)', () => {
    // Latest at 102.5, older flat sessions at 100 — the step already
    // happened, so "no rep gain" against the lighter frame is meaningless.
    const adjustment = autoregulateRange(
      2.5,
      seq(ranged([8, 8, 8], 102.5), ranged([9, 9, 9]), ranged([9, 9, 9]), ranged([9, 9, 9])),
      ROWS,
    )
    expect(adjustment).toMatchObject({ action: 'repeat', range: { stalls: 0 } })
  })

  it('warm-ups and unpaired amrap rows never score a fill or a total', () => {
    const s: AutoregSession = {
      startedAtMs: 0,
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
    expect(autoregulateRange(2.5, [s], rows(2))).toMatchObject({ action: 'step' })
  })

  it('an evidence load above every plan row is ungoverned — the fill is unconfirmable (hold)', () => {
    // The plan shrank to lighter rows since the session: a 100 kg pair has
    // no row at/above it to name a top, so no step can be earned from it.
    const shrunk: AutoregRangeRow[] = [
      { loadKg: 90, repMax: 12 },
      { loadKg: 90, repMax: null },
    ]
    const adjustment = autoregulateRange(2.5, [ranged([12, 12, 12])], shrunk)
    expect(adjustment).toMatchObject({ action: 'repeat' })
  })

  it('H3: mixed template rows keep range protection — ranged rows fill, fixed rows floor-score', () => {
    // Plan: a fixed 5-rep top set (105 after the scheme increment) plus two
    // ranged 8–12 back-off rows (85). The old whole-exercise fallback
    // disabled range rules for this shape entirely.
    const mixed: AutoregRangeRow[] = [
      { loadKg: 105, repMax: null },
      { loadKg: 85, repMax: 12 },
      { loadKg: 85, repMax: 12 },
    ]
    const filled = mixedSession([
      { setNumber: 1, repMin: 5, loadKg: 100, reps: 5 },
      { setNumber: 2, repMin: 8, loadKg: 80, reps: 12 },
      { setNumber: 3, repMin: 8, loadKg: 80, reps: 12 },
    ])
    expect(autoregulateRange(2.5, [filled], mixed)).toMatchObject({ action: 'step' })

    // The fixed top set missing ITS floor blocks the step (floor scoring),
    // without collapsing the ranged rows to fixed rules.
    const topMissed = mixedSession([
      { setNumber: 1, repMin: 5, loadKg: 100, reps: 3 },
      { setNumber: 2, repMin: 8, loadKg: 80, reps: 12 },
      { setNumber: 3, repMin: 8, loadKg: 80, reps: 12 },
    ])
    expect(autoregulateRange(2.5, [topMissed], mixed)).toMatchObject({
      action: 'repeat',
      evidence: { missedSets: 1 },
    })
  })

  it('H3v2: heterogeneous tops in ONE load bucket can never step (verification re-break)', () => {
    // Two ranged rows at the same load with different tops (12 and 5): which
    // historical set owned which top is unknowable order-free, and the
    // optimistic best-reps→highest-top match would score 6 reps against the
    // top-5 row and 12 against the top-12 row — laundering a 50% miss on the
    // true top-12 set into a fill and a LOAD INCREASE. Misses stay optimistic
    // (no certain miss → no stall), but the fill is unconfirmable: hold.
    const mixedTops: AutoregRangeRow[] = [
      { loadKg: 100, repMax: 12 },
      { loadKg: 100, repMax: 5 },
    ]
    const laundered = mixedSession([
      { setNumber: 1, repMin: 5, loadKg: 100, reps: 6 },
      { setNumber: 2, repMin: 5, loadKg: 100, reps: 12 },
    ])

    const adjustment = autoregulateRange(2.5, [laundered], mixedTops)

    expect(adjustment?.action).not.toBe('step')
    expect(adjustment).toMatchObject({ action: 'repeat', evidence: { missedSets: 0 } })
  })

  it('sets attempted lighter than prescribed are excluded from the fill (follow-down evidence)', () => {
    const s: AutoregSession = {
      startedAtMs: 0,
      prescribed: [1, 2, 3].map((n) => ({ setNumber: n, repMin: 8, loadKg: 100 })),
      actual: [
        { setNumber: 1, reps: 12, weightKg: 100, completed: true },
        { setNumber: 2, reps: 12, weightKg: 100, completed: true },
        // Dropped to 80 kg and maxed reps — never counted toward the fill.
        { setNumber: 3, reps: 12, weightKg: 80, completed: true },
      ],
    }
    const adjustment = autoregulateRange(2.5, [s], ROWS)
    expect(adjustment).toMatchObject({ action: 'step', evidence: { scorableSets: 2 } })
  })

  it('a null snapshot repMin is still scorable in range mode (the top is the target)', () => {
    const s: AutoregSession = {
      startedAtMs: 0,
      prescribed: [1, 2, 3].map((n) => ({ setNumber: n, repMin: null, loadKg: 100 })),
      actual: [1, 2, 3].map((n) => ({ setNumber: n, reps: 12, weightKg: 100, completed: true })),
    }
    expect(autoregulateRange(2.5, [s], ROWS)).toMatchObject({ action: 'step' })
  })

  it('consults only four sessions — a stall streak beyond the window cannot deepen', () => {
    const flat = () => ranged([9, 9, 9])
    // Five flat sessions: still 3 stalls (window 4), verdict identical.
    const adjustment = autoregulateRange(2.5, seq(flat(), flat(), flat(), flat(), flat()), ROWS)
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
    const adjustment = autoregulateRange(2.5, [ranged([12, 12, 12])], ROWS)!

    // Act
    const result = applyAutoregToSets([derivedSet()], adjustment)

    // Assert — the ONE case autoreg may raise: prescribed-at-fill + step.
    expect(result[0]).toMatchObject({ loadKg: 102.5, derivedFrom: 'autoreg', schemeLoadKg: 100 })
  })

  it('pulls a linear scheme that ran ahead back to one honest step', () => {
    const adjustment = autoregulateRange(2.5, [ranged([12, 12, 12])], ROWS)!
    const result = applyAutoregToSets([derivedSet({ loadKg: 107.5 })], adjustment)
    expect(result[0]).toMatchObject({ loadKg: 102.5, schemeLoadKg: 107.5 })
  })

  it('steps each set from ITS OWN prescribed-at-fill bucket, warmups untouched', () => {
    const s: AutoregSession = {
      startedAtMs: 0,
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
    const plan: AutoregRangeRow[] = [
      { loadKg: 102.5, repMax: 12 },
      { loadKg: 92.5, repMax: 12 },
    ]
    const adjustment = autoregulateRange(2.5, [s], plan)!
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
    const adjustment = autoregulateRange(2.5, [ranged([9, 9, 9])], ROWS)!

    // Act
    const result = applyAutoregToSets([derivedSet({ loadKg: 102.5 })], adjustment)

    // Assert
    expect(result[0]).toMatchObject({ loadKg: 100, derivedFrom: 'autoreg', schemeLoadKg: 102.5 })
  })
})

describe('autoregReason — range mode', () => {
  it('names the step and its target load', () => {
    const adjustment = autoregulateRange(2.5, [ranged([12, 12, 12])], ROWS)!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'Range filled at 100 kg last session — stepping to 102.5 kg',
    )
  })

  it('explains a first-evidence hold without claiming a stall', () => {
    const adjustment = autoregulateRange(2.5, [ranged([9, 9, 9])], ROWS)!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'Range not filled at 100 kg — adding reps before the load steps',
    )
  })

  it('shows the flat totals on a rep stall', () => {
    const adjustment = autoregulateRange(2.5, seq(ranged([9, 9, 9]), ranged([9, 9, 9])), ROWS)!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'No new reps at 100 kg (27 vs 27) — holding the load',
    )
  })

  it('describes the three-session back-off with its magnitude', () => {
    const flat = () => ranged([9, 9, 9])
    const adjustment = autoregulateRange(2.5, seq(flat(), flat(), flat(), flat()), ROWS)!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'No new reps at 100 kg for 3 straight sessions — backing off 10 kg (~10%)',
    )
  })
})

/** One null-load prescribed working set (repMin proves the snapshot exists)
 *  with a single actual — the anchor rule's minimal fixture. */
const nullLoadSession = (
  actual: { reps: number | null; weightKg: number | null; completed?: boolean; setType?: string },
  repMin: number | null = 8,
): AutoregSession => ({
  startedAtMs: 0,
  prescribed: [{ setNumber: 1, repMin, loadKg: null }],
  actual: [{ setNumber: 1, completed: true, ...actual }],
})

describe('autoregulate — outperform anchoring', () => {
  it('M2: one outperformed session proposes nothing — up-anchors need two in a row', () => {
    // The single good day that used to anchor immediately: no methodology
    // chases one good day.
    expect(autoregulate(2.5, [session([8, 8, 8], 120)], 'all-sets')).toBeNull()
    expect(autoregulate(2.5, seq(session([8, 8, 8], 120), session([8, 8, 8])), 'all-sets')).toBeNull()
  })

  it('anchors at the performed load after TWO consecutive qualifying sessions', () => {
    // Prescribed 100×8, performed ≥5% over on every set, two sessions
    // running — the program follows the lifter up.
    const adjustment = autoregulate(2.5, seq(session([8, 8, 8], 120), session([8, 8, 8], 110)), 'all-sets')
    expect(adjustment).toMatchObject({
      action: 'anchor',
      deltaKg: 20,
      suggestEarlyDeload: false,
      anchor: { fromLoadKg: 100, toLoadKg: 120 },
      anchorLoads: [{ prescribedLoadKg: 100, anchorKg: 120 }],
      evidence: { missedSets: 0, scorableSets: 3, repFloor: 8, loadKg: 100 },
    })
  })

  it('exactly 5% over anchors; 4.9% does not (epsilon-tolerant boundary)', () => {
    expect(autoregulate(2.5, seq(session([8, 8, 8], 105), session([8, 8, 8], 105)), 'all-sets')).toMatchObject(
      { action: 'anchor' },
    )
    expect(autoregulate(2.5, seq(session([8, 8, 8], 104.9), session([8, 8, 8], 105)), 'all-sets')).toBeNull()
  })

  it('C1: outperforming load while missing a floor is a stall, not an outperform', () => {
    // One set under the floor blocks the anchor AND fails the session.
    expect(autoregulate(2.5, [session([8, 8, 7], 120)], 'all-sets')).toMatchObject({
      action: 'repeat',
      evidence: { missedSets: 1 },
    })
    expect(autoregulate(2.5, [session([6, 6, 8], 120)], 'all-sets')).toMatchObject({ action: 'repeat' })
  })

  it('one set at plan blocks the whole exercise (all-or-nothing testimony)', () => {
    const s: AutoregSession = {
      startedAtMs: 0,
      prescribed: prescribed(),
      actual: [
        { setNumber: 1, reps: 8, weightKg: 120, completed: true },
        { setNumber: 2, reps: 8, weightKg: 120, completed: true },
        { setNumber: 3, reps: 8, weightKg: 100, completed: true },
      ],
    }
    expect(autoregulate(2.5, seq(s, session([8, 8, 8], 120)), 'all-sets')).toBeNull()
  })

  it('anchors each load bucket at its performed load, evidence naming the heaviest prescription', () => {
    const outperformed = (): AutoregSession => ({
      startedAtMs: 0,
      prescribed: [
        { setNumber: 1, repMin: 5, loadKg: 100 },
        { setNumber: 2, repMin: 8, loadKg: 90 },
      ],
      actual: [
        { setNumber: 1, reps: 5, weightKg: 110, completed: true },
        { setNumber: 2, reps: 8, weightKg: 100, completed: true },
      ],
    })
    expect(autoregulate(2.5, seq(outperformed(), outperformed()), 'all-sets')).toMatchObject({
      action: 'anchor',
      deltaKg: 10,
      anchor: { fromLoadKg: 100, toLoadKg: 110 },
      anchorLoads: [
        { prescribedLoadKg: 100, anchorKg: 110 },
        { prescribedLoadKg: 90, anchorKg: 100 },
      ],
    })
  })

  it('a pair with no snapshot floor is ambiguous — no anchor (silence over corruption)', () => {
    const s = (): AutoregSession => ({
      startedAtMs: 0,
      prescribed: [
        { setNumber: 1, repMin: 8, loadKg: 100 },
        { setNumber: 2, repMin: null, loadKg: 100 },
      ],
      actual: [1, 2].map((n) => ({ setNumber: n, reps: 8, weightKg: 120, completed: true })),
    })
    expect(autoregulate(2.5, seq(s(), s()), 'all-sets')).toBeNull()
  })

  it('warm-up and amrap rows never testify to an outperform', () => {
    const s = (): AutoregSession => ({
      startedAtMs: 0,
      prescribed: [
        { setNumber: 1, repMin: 5, loadKg: 60, setType: 'warmup' },
        { setNumber: 2, repMin: 8, loadKg: 100 },
        { setNumber: 3, repMin: 1, loadKg: 90, setType: 'amrap' },
      ],
      actual: [
        // A heavy warm-up and a heavy amrap around an at-plan working set.
        { setNumber: 1, reps: 5, weightKg: 120, completed: true, setType: 'warmup' },
        { setNumber: 2, reps: 8, weightKg: 100, completed: true },
        { setNumber: 3, reps: 10, weightKg: 120, completed: true, setType: 'amrap' },
      ],
    })
    expect(autoregulate(2.5, seq(s(), s()), 'all-sets')).toBeNull()
  })

  it('stays silent on empty history', () => {
    expect(autoregulate(2.5, [], 'all-sets')).toBeNull()
    expect(autoregulateAnchor([])).toBeNull()
  })
})

describe('null-load prescription anchoring', () => {
  it('autoregulateAnchor anchors a load-less prescription at the completed working load', () => {
    const adjustment = autoregulateAnchor([nullLoadSession({ reps: 10, weightKg: 60 })])
    expect(adjustment).toMatchObject({
      action: 'anchor',
      deltaKg: 0,
      suggestEarlyDeload: false,
      anchor: { fromLoadKg: null, toLoadKg: 60 },
      anchorLoads: [{ prescribedLoadKg: null, anchorKg: 60 }],
    })
  })

  it('a missing snapshot (null repMin AND null load) is cold-start silence, not an anchor', () => {
    expect(autoregulateAnchor([nullLoadSession({ reps: 10, weightKg: 60 }, null)])).toBeNull()
  })

  it('incomplete, rep-less, weight-less, or zero-weight sets never anchor', () => {
    expect(
      autoregulateAnchor([nullLoadSession({ reps: 10, weightKg: 60, completed: false })]),
    ).toBeNull()
    expect(autoregulateAnchor([nullLoadSession({ reps: null, weightKg: 60 })])).toBeNull()
    expect(autoregulateAnchor([nullLoadSession({ reps: 10, weightKg: null })])).toBeNull()
    expect(autoregulateAnchor([nullLoadSession({ reps: 10, weightKg: 0 })])).toBeNull()
  })

  it('warm-up rows never anchor', () => {
    expect(
      autoregulateAnchor([nullLoadSession({ reps: 5, weightKg: 60, setType: 'warmup' })]),
    ).toBeNull()
  })

  it('collapses multiple load-less sets to ONE conservative null bucket (minimum performed)', () => {
    // With no prescribed load to key on, per-set identity would be
    // positional — the minimum demonstrated load is the only order-free
    // anchor (C2).
    const s: AutoregSession = {
      startedAtMs: 0,
      prescribed: [1, 2].map((n) => ({ setNumber: n, repMin: 8, loadKg: null })),
      actual: [
        { setNumber: 1, reps: 10, weightKg: 80, completed: true },
        { setNumber: 2, reps: 10, weightKg: 60, completed: true },
      ],
    }
    expect(autoregulateAnchor([s])).toMatchObject({
      anchorLoads: [{ prescribedLoadKg: null, anchorKg: 60 }],
    })
  })

  it('mixed evidence: an at-plan loaded day still anchors ONLY its load-less set', () => {
    const s: AutoregSession = {
      startedAtMs: 0,
      prescribed: [
        { setNumber: 1, repMin: 8, loadKg: 100 },
        { setNumber: 2, repMin: 8, loadKg: null },
      ],
      actual: [
        { setNumber: 1, reps: 8, weightKg: 100, completed: true },
        { setNumber: 2, reps: 10, weightKg: 60, completed: true },
      ],
    }
    const adjustment = autoregulate(2.5, [s], 'all-sets')
    expect(adjustment).toMatchObject({
      action: 'anchor',
      anchor: { fromLoadKg: null, toLoadKg: 60 },
      anchorLoads: [{ prescribedLoadKg: null, anchorKg: 60 }],
    })
  })

  it('mixed evidence: a stall verdict still carries the load-less set anchor', () => {
    const s: AutoregSession = {
      startedAtMs: 0,
      prescribed: [
        { setNumber: 1, repMin: 8, loadKg: 100 },
        { setNumber: 2, repMin: 8, loadKg: null },
      ],
      actual: [
        { setNumber: 1, reps: 5, weightKg: 100, completed: true },
        { setNumber: 2, reps: 10, weightKg: 60, completed: true },
      ],
    }
    const adjustment = autoregulate(2.5, [s], 'all-sets')
    expect(adjustment).toMatchObject({
      action: 'repeat',
      anchorLoads: [{ prescribedLoadKg: null, anchorKg: 60 }],
    })
    expect(adjustment?.anchor).toBeUndefined()
  })

  it('range mode anchors load-less sets when nothing else is scorable', () => {
    const adjustment = autoregulateRange(2.5, [nullLoadSession({ reps: 10, weightKg: 60 })], ROWS)
    expect(adjustment).toMatchObject({
      action: 'anchor',
      anchorLoads: [{ prescribedLoadKg: null, anchorKg: 60 }],
    })
  })
})

describe('autoregulateRange — outperform anchoring and fill composition', () => {
  /** 3 sets prescribed 8–12 at `prescribedKg`, performed `reps` at `performedKg`. */
  const rangedAt = (reps: number[], prescribedKg: number, performedKg: number): AutoregSession => ({
    startedAtMs: 0,
    prescribed: reps.map((_, i) => ({ setNumber: i + 1, repMin: 8, loadKg: prescribedKg })),
    actual: reps.map((r, i) => ({
      setNumber: i + 1,
      reps: r,
      weightKg: performedKg,
      completed: true,
    })),
  })

  it('M2: a single outperformed session within the range holds instead of anchoring', () => {
    const adjustment = autoregulateRange(2.5, [rangedAt([9, 9, 9], 100, 110)], ROWS)
    expect(adjustment).toMatchObject({ action: 'repeat' })
    expect(adjustment?.anchorLoads).toBeUndefined()
  })

  it('outperforming within the range on two consecutive sessions anchors at the performed load', () => {
    const adjustment = autoregulateRange(
      2.5,
      seq(rangedAt([9, 9, 9], 100, 110), rangedAt([9, 9, 9], 100, 110)),
      ROWS,
    )
    expect(adjustment).toMatchObject({
      action: 'anchor',
      anchor: { fromLoadKg: 100, toLoadKg: 110 },
      anchorLoads: [{ prescribedLoadKg: 100, anchorKg: 110 }],
    })
  })

  it('outperforming while under the range floor is NOT an outperform (stall rules apply)', () => {
    const adjustment = autoregulateRange(
      2.5,
      seq(rangedAt([7, 9, 9], 100, 110), rangedAt([9, 9, 9], 100, 110)),
      ROWS,
    )
    expect(adjustment).toMatchObject({ action: 'repeat' })
    expect(adjustment?.anchorLoads).toBeUndefined()
  })

  it('a CONFIRMED outperformed FILL steps from the PERFORMED load (composition, not competition)', () => {
    const adjustment = autoregulateRange(
      2.5,
      seq(rangedAt([12, 12, 12], 100, 110), rangedAt([9, 9, 9], 100, 110)),
      ROWS,
    )
    expect(adjustment).toMatchObject({
      action: 'step',
      deltaKg: 2.5,
      anchor: { fromLoadKg: 100, toLoadKg: 110 },
      anchorLoads: [{ prescribedLoadKg: 100, anchorKg: 110 }],
    })
  })

  it('a fill under the outperform margin steps from the prescribed load as before', () => {
    const adjustment = autoregulateRange(2.5, [rangedAt([12, 12, 12], 100, 104.9)], ROWS)!
    expect(adjustment).toMatchObject({ action: 'step', deltaKg: 2.5 })
    expect(adjustment.anchor).toBeUndefined()
    expect(adjustment.anchorLoads).toBeUndefined()
  })
})

describe('applyAutoregToSets — anchor', () => {
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

  it('prescribes exactly the performed load, keeping the scheme value for the escape', () => {
    const adjustment = autoregulate(2.5, seq(session([8, 8, 8], 120), session([8, 8, 8], 110)), 'all-sets')!
    const result = applyAutoregToSets(
      [derivedSet(), derivedSet({ setNumber: 2, sourceIndex: 1 })],
      adjustment,
    )
    // "Use plan as written" reverts to 102.5 via schemeLoadKg.
    expect(result[0]).toMatchObject({ loadKg: 120, derivedFrom: 'autoreg', schemeLoadKg: 102.5 })
    expect(result[1]).toMatchObject({ loadKg: 120, schemeLoadKg: 102.5 })
  })

  it('stamps the performed load onto a LOAD-LESS scheme set (the rpe-target weight ghost)', () => {
    const adjustment = autoregulateAnchor([nullLoadSession({ reps: 10, weightKg: 60 })])!
    const result = applyAutoregToSets([derivedSet({ loadKg: null })], adjustment)
    // Escape revert: schemeLoadKg preserves the plan's "no load".
    expect(result[0]).toMatchObject({ loadKg: 60, derivedFrom: 'autoreg', schemeLoadKg: null })
  })

  it('leaves loaded sets, warm-ups, and non-scheme passthroughs untouched on a null-bucket anchor', () => {
    const adjustment = autoregulateAnchor([nullLoadSession({ reps: 10, weightKg: 60 })])!
    const loaded = derivedSet({ setNumber: 2, sourceIndex: 1 })
    const warmup = derivedSet({ setType: 'warmup', loadKg: 60 })
    const template = derivedSet({ derivedFrom: 'template', loadKg: null })
    expect(applyAutoregToSets([loaded, warmup, template], adjustment)).toEqual([
      loaded,
      warmup,
      template,
    ])
  })

  it('a confirmed outperformed fill lands each set at performed + step', () => {
    const filled: AutoregSession = {
      startedAtMs: 0,
      prescribed: [1, 2, 3].map((n) => ({ setNumber: n, repMin: 8, loadKg: 100 })),
      actual: [1, 2, 3].map((n) => ({ setNumber: n, reps: 12, weightKg: 110, completed: true })),
    }
    const previous: AutoregSession = {
      startedAtMs: 0,
      prescribed: [1, 2, 3].map((n) => ({ setNumber: n, repMin: 8, loadKg: 100 })),
      actual: [1, 2, 3].map((n) => ({ setNumber: n, reps: 9, weightKg: 110, completed: true })),
    }
    const adjustment = autoregulateRange(2.5, seq(filled, previous), ROWS)!
    const result = applyAutoregToSets(
      [1, 2, 3].map((n) => derivedSet({ setNumber: n, loadKg: 100, sourceIndex: n - 1 })),
      adjustment,
    )
    expect(result.map((s) => s.loadKg)).toEqual([112.5, 112.5, 112.5])
    expect(result.every((s) => s.derivedFrom === 'autoreg')).toBe(true)
  })

  it('a stall verdict with a load-less rider caps the loaded set AND anchors the load-less one', () => {
    const s: AutoregSession = {
      startedAtMs: 0,
      prescribed: [
        { setNumber: 1, repMin: 8, loadKg: 100 },
        { setNumber: 2, repMin: 8, loadKg: null },
      ],
      actual: [
        { setNumber: 1, reps: 5, weightKg: 100, completed: true },
        { setNumber: 2, reps: 10, weightKg: 60, completed: true },
      ],
    }
    const adjustment = autoregulate(2.5, [s], 'all-sets')!
    const result = applyAutoregToSets(
      [derivedSet(), derivedSet({ setNumber: 2, loadKg: null, sourceIndex: 1 })],
      adjustment,
    )
    expect(result[0]).toMatchObject({ loadKg: 100, schemeLoadKg: 102.5 })
    expect(result[1]).toMatchObject({ loadKg: 60, schemeLoadKg: null })
  })

  it('does not mutate the input sets', () => {
    const adjustment = autoregulate(2.5, seq(session([8, 8, 8], 120), session([8, 8, 8], 110)), 'all-sets')!
    const input = derivedSet()
    applyAutoregToSets([input], adjustment)
    expect(input).toMatchObject({ loadKg: 102.5, derivedFrom: 'scheme' })
  })
})

describe('autoregulateEarlyDeload (M4)', () => {
  const stall = () => session([5, 5, 5])

  it('M4: three consecutive stalled sessions flag the early deload without touching loads', () => {
    const adjustment = autoregulateEarlyDeload(seq(stall(), stall(), stall()), 'all-sets')
    expect(adjustment).toMatchObject({
      action: 'flag',
      deltaKg: 0,
      suggestEarlyDeload: true,
      stalledLoads: [],
    })
  })

  it('stays silent below three stalls or when the latest session passed', () => {
    expect(autoregulateEarlyDeload(seq(stall(), stall()), 'all-sets')).toBeNull()
    expect(autoregulateEarlyDeload(seq(session([8, 8, 8]), stall(), stall()), 'all-sets')).toBeNull()
    expect(autoregulateEarlyDeload([], 'all-sets')).toBeNull()
  })

  it('a flag verdict never adjusts a prescription (the scheme owns its loads)', () => {
    const adjustment = autoregulateEarlyDeload(seq(stall(), stall(), stall()), 'all-sets')!
    const scheme: DerivedSet = {
      setNumber: 1,
      setType: 'working',
      metricMode: 'reps_weight',
      repMin: 5,
      repMax: null,
      rir: null,
      rpe: null,
      loadKg: 95,
      tempo: null,
      durationSec: null,
      distanceM: null,
      restSec: null,
      technique: null,
      derivedFrom: 'scheme',
      sourceIndex: 0,
    }
    expect(applyAutoregToSets([scheme], adjustment)).toEqual([scheme])
  })

  it('speaks the failed-cycle reason (training max likely set too high)', () => {
    const adjustment = autoregulateEarlyDeload(seq(stall(), stall(), stall()), 'all-sets')!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'Third straight stall at 100 kg — training max likely set too high',
    )
  })
})

describe('autoregReason — anchor', () => {
  it('names the outperform in the display unit', () => {
    const adjustment = autoregulate(2.5, seq(session([8, 8, 8], 120), session([8, 8, 8], 110)), 'all-sets')!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'Did 120 kg vs 100 kg planned — anchoring at 120 kg',
    )
  })

  it('names a null-prescription anchor from the last session', () => {
    const adjustment = autoregulateAnchor([nullLoadSession({ reps: 10, weightKg: 60 })])!
    expect(autoregReason(adjustment, 'kg')).toBe('Last session: 60 kg — anchoring')
  })

  it('speaks the composed step from the performed load', () => {
    const filled: AutoregSession = {
      startedAtMs: 0,
      prescribed: [1, 2, 3].map((n) => ({ setNumber: n, repMin: 8, loadKg: 100 })),
      actual: [1, 2, 3].map((n) => ({ setNumber: n, reps: 12, weightKg: 110, completed: true })),
    }
    const previous: AutoregSession = {
      startedAtMs: 0,
      prescribed: [1, 2, 3].map((n) => ({ setNumber: n, repMin: 8, loadKg: 100 })),
      actual: [1, 2, 3].map((n) => ({ setNumber: n, reps: 9, weightKg: 110, completed: true })),
    }
    const adjustment = autoregulateRange(2.5, seq(filled, previous), ROWS)!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'Range filled at 110 kg last session — stepping to 112.5 kg',
    )
  })
})

describe('sessionBeatsTop (volume-progression signal)', () => {
  it('true when every scorable working pair finishes at or above the top', () => {
    expect(sessionBeatsTop(session([12, 12, 13]), 12)).toBe(true)
  })

  it('false when any scorable pair sits under the top', () => {
    expect(sessionBeatsTop(session([12, 12, 11]), 12)).toBe(false)
  })

  it('null when nothing is scorable (silence, never a verdict from nothing)', () => {
    expect(sessionBeatsTop(session([null, null, null]), 12)).toBe(null)
  })

  it('null when the M3 quorum fails (one surviving set cannot speak for three)', () => {
    expect(sessionBeatsTop(session([12, null, null]), 12)).toBe(null)
  })

  it('lighter-than-prescribed attempts do not count as beats', () => {
    // Performed at 80 vs 100 prescribed: not at-load, so nothing is scorable.
    expect(sessionBeatsTop(session([15, 15, 15], 80), 12)).toBe(null)
  })
})

describe('legacy-snapshot bucket matching (#226 transitional epsilon)', () => {
  it('keeps a stall streak alive across the quantization deploy boundary', () => {
    // Legacy sessions prescribed 16.87 kg raw; the newest at its quantized
    // re-derivation 17.01 kg (both 37.5 lb) — 0.14 kg apart, past the raw
    // 0.05 kg epsilon, but the SAME 2.5 lb increment.
    const sessions = seq(
      sessionAt(17.01, [6, 6, 6]),
      sessionAt(16.87, [6, 6, 6]),
      sessionAt(16.87, [6, 6, 6]),
    )
    // Without a unit the raw epsilon governs: the streak breaks → repeat.
    expect(autoregulate(2.5, sessions, 'all-sets')!.action).toBe('repeat')
    // With the active unit the loads share an increment: third stall → decrement.
    expect(autoregulate(2.5, sessions, 'all-sets', 'lb')!.action).toBe('decrement')
  })

  it('applies a verdict to a set whose quantized load shares the evidence increment', () => {
    // Legacy evidence at 17.1 kg (37.5 lb raw-rounded DOWN by quantization).
    const adjustment = autoregulate(2.5, [sessionAt(17.1, [6, 6, 6])], 'all-sets', 'lb')!
    const scheme: DerivedSet = {
      setNumber: 1,
      setType: 'working',
      metricMode: 'reps_weight',
      repMin: 8,
      repMax: null,
      rir: null,
      rpe: null,
      loadKg: 17.01, // today's quantized derivation of the same 37.5 lb
      tempo: null,
      durationSec: null,
      distanceM: null,
      restSec: null,
      technique: null,
      derivedFrom: 'scheme',
      sourceIndex: 0,
    }
    // Raw epsilon alone misses the bucket (17.01 < 17.1 − 0.05): untouched.
    expect(applyAutoregToSets([scheme], adjustment)[0].derivedFrom).toBe('scheme')
    // Same 37.5 lb increment in the active unit: the verdict lands.
    expect(applyAutoregToSets([scheme], adjustment, 'lb')[0]).toMatchObject({
      loadKg: 17.01,
      derivedFrom: 'autoreg',
    })
  })
})
