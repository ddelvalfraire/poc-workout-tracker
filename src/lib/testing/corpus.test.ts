import { describe, expect, it } from 'vitest'
import {
  amrapCompletedWaves,
  DELOAD_LOAD_FACTOR,
  deriveWeekSets,
  type ExerciseHistoryInput,
  type ProgramSetRowLike,
} from '@/lib/progression'
import {
  applyAutoregToSets,
  autoregReason,
  autoregulate,
  autoregulateEarlyDeload,
  type AutoregSession,
} from '@/lib/autoregulate'
import type { Progression } from '@/lib/program-input'

/**
 * Layer 3 of the progression test harness (progression-test-harness.prd.md):
 * the CITED GOLDEN CORPUS. Published program canon is the oracle — every
 * expected value below cites its source; where our scheme mechanics
 * legitimately diverge from the source program, the assertion pins what OUR
 * engine produces and a DIVERGENCE comment names the gap (never a forced
 * false match). Assertions are inline (no snapshot files); corpus additions
 * require a citation (PRD rule 4).
 *
 * Sources (verified 2026-08-09):
 *  [W1] Jim Wendler's 5/3/1 (orig. T-Nation 2009 / "5/3/1" book), cycle
 *       tables as republished: https://barbend.com/5-3-1-program/ and
 *       https://www.norma-athletics.at/guides/wendler-531/ — week 1
 *       65/75/85% ×5/5/5+, week 2 70/80/90% ×3/3/3+, week 3 75/85/95%
 *       ×5/3/1+, deload 40/50/60% ×5; all % of the Training Max (~90% 1RM);
 *       +2.5 kg upper / +5 kg lower TM per cycle.
 *  [G1] Cody Lefever's GZCLP (r/gzcl; official Boostcamp release):
 *       https://www.boostcamp.app/coaches/cody-lefever/gzcl-program-gzclp
 *       and https://saynotobroscience.com/gzclp-infographic/ — T1 ladder
 *       5×3+ → 6×2+ → 10×1+ → reset off a new 5RM; T2 ladder 3×10 → 3×8 →
 *       3×6 at the same weight → reset off a new 10RM; +2.5 kg upper /
 *       +5 kg lower per successful T1 session.
 *  [S1] StrongLifts 5×5: https://stronglifts.com/stronglifts-5x5/failure/
 *       and https://support.stronglifts.com/article/71-progression —
 *       +5 lb (2.5 kg) per session; after THREE consecutive failed sessions
 *       at a weight, deload 10%.
 *  [H1] Follow-down is ENGINE canon (autoregulate.ts H1 docblock, RTS /
 *       Juggernaut precedent: load selection is itself the autoregulation
 *       signal) — no external numeric table exists, so the oracle is the
 *       docblock's own rule: anchor to what was actually lifted.
 *
 * Gauntlet finding classes already pinned elsewhere (checked before adding
 * regression cases here, per the Layer 3 spec — NOT duplicated):
 *  - H3 re-break (mixed-top bucket): autoregulate.test.ts "H3v2:
 *    heterogeneous tops in ONE load bucket can never step".
 *  - C2 positional drift: autoregulate.test.ts "C2: insert-set shift…",
 *    "C2: a new set at the old position…", "C2: a 140 kg top set…".
 *  - Ghost-workout week advancement: db/instantiate-program.test.ts (ghost
 *    workouts with completedAt but zero completed sets never advance the
 *    week axis — the 2026-07-19 cooked-block incident).
 *
 * No wall-clock reads: session timestamps are epoch-ms literals.
 */

const DAY_MS = 86_400_000
const NO_HISTORY: ExerciseHistoryInput = { e1rmKg: null, lastSets: null }

/** A working template row; the corpus programs override what they need. */
function row(setNumber: number, partial: Partial<ProgramSetRowLike> = {}): ProgramSetRowLike {
  return {
    setNumber,
    setType: 'working',
    metricMode: 'reps_weight',
    repMin: 5,
    repMax: null,
    rir: null,
    rpe: null,
    suggestedLoadKg: null,
    tempo: null,
    durationSec: null,
    distanceM: null,
    restSec: null,
    technique: null,
    ...partial,
  }
}

/** One logged session at a single prescribed load with per-set reps —
 *  prescribed and actual sides from the same snapshot, like the db rows. */
function loggedSession(args: {
  reps: readonly (number | null)[]
  repMin: number
  loadKg: number
  /** Performed load (default = prescribed — an at-load attempt). */
  weightKg?: number
  startedAtMs: number
}): AutoregSession {
  const weightKg = args.weightKg ?? args.loadKg
  return {
    startedAtMs: args.startedAtMs,
    prescribed: args.reps.map((_, i) => ({
      setNumber: i + 1,
      repMin: args.repMin,
      loadKg: args.loadKg,
      setType: 'working',
    })),
    actual: args.reps.map((r, i) => ({
      setNumber: i + 1,
      reps: r,
      weightKg: r === null ? null : weightKg,
      completed: r !== null,
      setType: 'working',
    })),
  }
}

describe('corpus: Wendler 5/3/1 — amrap-cycle vs the published cycle tables [W1]', () => {
  // Bench press (upper body): TM 100 kg, +2.5 kg per cycle [W1].
  const wave531 = [
    [0.65, 0.75, 0.85], // week 1: 5/5/5+ [W1]
    [0.7, 0.8, 0.9], // week 2: 3/3/3+ [W1]
    [0.75, 0.85, 0.95], // week 3: 5/3/1+ [W1]
  ]
  const waveReps531 = [
    [5, 5, 5],
    [3, 3, 3],
    [5, 3, 1],
  ]
  const bench: Progression = {
    scheme: 'amrap-cycle',
    trainingMaxKg: 100,
    incrementKg: 2.5,
    wave: wave531,
    waveReps: waveReps531,
  }
  const sets = [row(1), row(2), row(3)]
  // Two 4-week cycles in one block; week 4 is the deload [W1].
  const geometry = { mesocycleWeeks: 8, deloadWeek: 4 }

  const derive = (week: number, progression: Progression = bench) =>
    deriveWeekSets({ sets, progression, week, history: NO_HISTORY, ...geometry })

  it.each([
    // [week, loads as % of TM 100, reps] — Wendler's own table [W1].
    [1, [65, 75, 85], [5, 5, 5]],
    [2, [70, 80, 90], [3, 3, 3]],
    [3, [75, 85, 95], [5, 3, 1]],
  ])('week %i derives the published wave row', (week, loads, reps) => {
    const derived = derive(week)
    expect(derived).toHaveLength(3)
    derived.forEach((s, i) => {
      expect(s.loadKg).toBeCloseTo(loads[i], 9) // TM 100 × wave % [W1]
      expect(s.repMin).toBe(reps[i]) // waveReps row [W1]
      expect(s.derivedFrom).toBe('scheme')
    })
  })

  it("week 4 on a LEGACY config deloads by the engine's scale-shape rule [W1]", () => {
    // LEGACY PIN (pre-deload-policy configs, migration-stamped
    // tmBumpTiming 'before-deload', no deloadRow): Wendler's deload week is
    // its own row — 40/50/60% ×5 at full set count, off the OLD TM [W1] —
    // but a legacy config has no per-scheme deload row: the deload week
    // re-derives the wave (week 4's steps land back on wave row 1), applies
    // DELOAD_LOAD_FACTOR 0.85, halves the working-set count (ceil → 2 of
    // 3), AND — 'before-deload' — already derives off the bumped TM 102.5.
    // This pins what every EXISTING amrap-cycle program keeps deriving;
    // the canon path is the deloadRow + 'after-deload' entry below.
    const derived = derive(4)
    expect(derived).toHaveLength(2)
    expect(derived[0].loadKg).toBeCloseTo(102.5 * 0.65 * DELOAD_LOAD_FACTOR, 9) // 56.63125, not 40
    expect(derived[1].loadKg).toBeCloseTo(102.5 * 0.75 * DELOAD_LOAD_FACTOR, 9) // 65.34375, not 50
    derived.forEach((s) => expect(s.derivedFrom).toBe('deload'))
  })

  it('week 4 with deloadRow + after-deload derives the PUBLISHED 40/50/60 ×5 off the old TM [W1]', () => {
    // Wendler canon, now expressible: the deload week is its own row —
    // 40/50/60% of the TM ×5 — and the cycle bump lands only with the NEXT
    // cycle's first week, so the deload derives off the UNBUMPED TM 100
    // [W1]. New configs get tmBumpTiming 'after-deload' by default; the
    // deloadRow is the program author's opt-in.
    const canon: Progression = {
      ...bench,
      tmBumpTiming: 'after-deload',
      deloadRow: { percents: [0.4, 0.5, 0.6], reps: 5 },
    }
    const derived = derive(4, canon)
    expect(derived).toHaveLength(3)
    expect(derived.map((s) => s.loadKg)).toEqual([40, 50, 60]) // TM 100 × 40/50/60% [W1]
    expect(derived.map((s) => s.repMin)).toEqual([5, 5, 5]) // ×5 [W1]
    derived.forEach((s) => expect(s.derivedFrom).toBe('deload'))
    // The withheld bump still lands where Wendler says: cycle 2 week 1 off
    // the NEW TM 102.5 [W1].
    const week5 = derive(5, canon)
    expect(week5[0].loadKg).toBeCloseTo(102.5 * 0.65, 9)
  })

  it('a migration-stamped legacy program derives byte-identically to its pre-stamp self', () => {
    // Migration 0036 stamps tmBumpTiming 'before-deload' onto every stored
    // amrap-cycle config. The stamp must be a pure freeze: for every week
    // of the block, stamped and unstamped configs derive the same bytes.
    const stamped: Progression = { ...bench, tmBumpTiming: 'before-deload' }
    for (let week = 1; week <= geometry.mesocycleWeeks; week++) {
      expect(derive(week, stamped)).toEqual(derive(week))
    }
  })

  it('cycle 2 bumps the TM by +2.5 kg (upper) at the wave boundary [W1]', () => {
    // Week 5 = cycle 2 week 1: one completed wave → TM 102.5, and the
    // published week-1 row off the NEW TM [W1]: 102.5 × 65/75/85%.
    expect(amrapCompletedWaves(5, geometry.mesocycleWeeks, geometry.deloadWeek, 3)).toBe(1)
    const derived = derive(5)
    expect(derived[0].loadKg).toBeCloseTo(102.5 * 0.65, 9) // 66.625
    expect(derived[1].loadKg).toBeCloseTo(102.5 * 0.75, 9) // 76.875
    expect(derived[2].loadKg).toBeCloseTo(102.5 * 0.85, 9) // 87.125
    expect(derived.map((s) => s.repMin)).toEqual([5, 5, 5]) // back to the 5s week [W1]
  })

  it('a BANKED cycle bump derives identical loads (persisted TM = virtual TM)', () => {
    // The instantiation-persisted bump (bankedWaves 1 folded into TM 102.5)
    // must equal the derive-time virtual bump — the banked-wave law applied
    // to the canon trajectory.
    const banked = derive(5, { ...bench, trainingMaxKg: 102.5, bankedWaves: 1 })
    const virtual = derive(5)
    banked.forEach((s, i) => expect(s.loadKg).toBeCloseTo(virtual[i].loadKg as number, 9))
  })

  it('a lower-body lift bumps +5 kg per cycle [W1]', () => {
    // Squat: TM 140, +5 kg per cycle [W1] → cycle 2 week 1 = 145 × wave.
    const squat: Progression = { ...bench, trainingMaxKg: 140, incrementKg: 5 }
    const derived = derive(5, squat)
    expect(derived[0].loadKg).toBeCloseTo(145 * 0.65, 9) // 94.25
    expect(derived[2].loadKg).toBeCloseTo(145 * 0.85, 9) // 123.25
  })

  it("three straight missed weeks flag 'training max likely set too high' (M4) [W1]", () => {
    // Wendler's failed-cycle rule: missing prescribed reps means the TM is
    // set too high — fix the TM, don't grind [W1]. The engine's M4 flag is
    // exactly that: advisory only, the wave's loads proceed untouched.
    // Weeks 1–3 at their (different) wave loads — M4 is session-based, no
    // H2 load scoping, because these schemes change loads every week.
    const weeks = [
      { loadKg: 95, repMin: 1 }, // week 3 top set, missed (latest)
      { loadKg: 90, repMin: 3 }, // week 2 top set, missed
      { loadKg: 85, repMin: 5 }, // week 1 top set, missed
    ]
    const sessions = weeks.map((w, i) =>
      loggedSession({
        reps: [w.repMin - 1],
        repMin: w.repMin,
        loadKg: w.loadKg,
        startedAtMs: (weeks.length - i) * DAY_MS,
      }),
    )
    const verdict = autoregulateEarlyDeload(sessions, 'all-sets')
    expect(verdict).toMatchObject({ action: 'flag', deltaKg: 0, suggestEarlyDeload: true })
    expect(autoregReason(verdict as NonNullable<typeof verdict>, 'kg')).toBe(
      'Third straight stall at 95 kg — training max likely set too high',
    )
    // A flag never touches the prescription — the wave stays the scheme's.
    const derived = derive(4)
    expect(applyAutoregToSets(derived, verdict as NonNullable<typeof verdict>)).toEqual(derived)
  })
})

describe('corpus: StrongLifts 5×5 — linear +2.5 kg, 10% deload on the third fail [S1]', () => {
  // Squat 5×5 @ 100 kg, +2.5 kg per session [S1]. DIVERGENCE (axis only):
  // StrongLifts progresses per SESSION (3×/week); our engine progresses per
  // non-deload WEEK — the per-step arithmetic is identical.
  const linear: Progression = { scheme: 'linear', incrementKg: 2.5 }
  const sets = [1, 2, 3, 4, 5].map((n) => row(n, { suggestedLoadKg: 100 }))
  const derive = (week: number) =>
    deriveWeekSets({
      sets,
      progression: linear,
      week,
      mesocycleWeeks: 12,
      deloadWeek: null,
      history: NO_HISTORY,
    })

  it('adds exactly 2.5 kg per step from 100 kg [S1]', () => {
    expect(derive(1).map((s) => s.loadKg)).toEqual([100, 100, 100, 100, 100])
    expect(derive(2).map((s) => s.loadKg)).toEqual(Array(5).fill(102.5)) // +2.5 [S1]
    expect(derive(3).map((s) => s.loadKg)).toEqual(Array(5).fill(105))
    expect(derive(12).map((s) => s.loadKg)).toEqual(Array(5).fill(127.5)) // 100 + 2.5×11
  })

  it('three straight failed sessions at 102.5 kg deload ~10% [S1]', () => {
    // Three sessions failing 5×5 at 102.5 (4,3 reps on the last sets — a
    // failed session under the all-sets policy, C1) → StrongLifts' rule:
    // "fail three sessions in a row → decrease 10% next time" [S1].
    const sessions = [3, 2, 1].map((i) =>
      loggedSession({
        reps: [5, 5, 5, 4, 3],
        repMin: 5,
        loadKg: 102.5,
        startedAtMs: i * DAY_MS,
      }),
    )
    const verdict = autoregulate(2.5, sessions, 'all-sets')
    // DIVERGENCE (rounding only): exact 10% of 102.5 is 10.25; the engine
    // snaps the back-off to loadable 2.5 kg increments → 10 kg. StrongLifts
    // itself loads real plates, so the snapped value is the practical canon.
    expect(verdict).toMatchObject({ action: 'decrement', deltaKg: -10, suggestEarlyDeload: true })
    expect(autoregReason(verdict as NonNullable<typeof verdict>, 'kg')).toBe(
      'Third straight stall at 102.5 kg — backing off 10 kg (~10%)',
    )
    // Applied to the next derive (week 3 would prescribe 105): every set is
    // capped to the stalled load minus the back-off — 92.5 kg [S1].
    const applied = applyAutoregToSets(derive(3), verdict as NonNullable<typeof verdict>)
    applied.forEach((s) => {
      expect(s.loadKg).toBeCloseTo(92.5, 9)
      expect(s.derivedFrom).toBe('autoreg')
      expect(s.schemeLoadKg).toBe(105) // "use plan as written" keeps the scheme load
    })
  })
})

describe('corpus: GZCLP — session-linear tiers; ladders are a named divergence [G1]', () => {
  it('T1 squat adds +5 kg per successful session [G1]', () => {
    // T1 squat 5×3 @ 100 kg, +5 kg (lower body) per successful session [G1].
    const sets = [1, 2, 3, 4, 5].map((n) => row(n, { repMin: 3, suggestedLoadKg: 100 }))
    const derive = (week: number) =>
      deriveWeekSets({
        sets,
        progression: { scheme: 'linear', incrementKg: 5 },
        week,
        mesocycleWeeks: 9,
        deloadWeek: null,
        history: NO_HISTORY,
      })
    expect(derive(1).map((s) => s.loadKg)).toEqual(Array(5).fill(100))
    expect(derive(2).map((s) => s.loadKg)).toEqual(Array(5).fill(105)) // +5 [G1]
    expect(derive(3).map((s) => s.loadKg)).toEqual(Array(5).fill(110))
  })

  it('T1 failure responds with the engine stall path, NOT the 6×2+/10×1+ ladder [G1]', () => {
    // DIVERGENCE: on a failed 5×3+, GZCLP keeps the weight and re-shapes to
    // 6×2+, then 10×1+, then resets off a new 5RM [G1]. Our engine has no
    // set-shape ladder: it repeats the load twice, then backs off ~10%
    // (comparable in spirit to GZCLP's reset, snapped to increments).
    const stall = (i: number) =>
      loggedSession({ reps: [3, 3, 2, 2, 1], repMin: 3, loadKg: 110, startedAtMs: i * DAY_MS })
    expect(autoregulate(5, [stall(1)], 'all-sets')).toMatchObject({ action: 'repeat' })
    expect(autoregulate(5, [stall(2), stall(1)], 'all-sets')).toMatchObject({ action: 'repeat' })
    // Third fail: back off round(11 / 5) × 5 = 10 kg (~10% of 110).
    expect(autoregulate(5, [stall(3), stall(2), stall(1)], 'all-sets')).toMatchObject({
      action: 'decrement',
      deltaKg: -10,
      suggestEarlyDeload: true,
    })
  })

  it('T2 bench holds until 3×10 completes, then adds — double progression [G1]', () => {
    // T2 bench modeled as double-progression over the 8–10 range: the load
    // advances only after every set hits the top — GZCLP's "add weight each
    // SUCCESSFUL session" gate [G1]. DIVERGENCE: on failure GZCLP holds the
    // weight but re-shapes to 3×8 (then 3×6); our engine holds both the
    // weight and the 3×10 shape.
    const sets = [1, 2, 3].map((n) => row(n, { repMin: 8, repMax: 10, suggestedLoadKg: 60 }))
    const progression: Progression = {
      scheme: 'double-progression',
      repMin: 8,
      repMax: 10,
      incrementKg: 2.5,
    }
    const derive = (history: ExerciseHistoryInput) =>
      deriveWeekSets({
        sets,
        progression,
        week: 2,
        mesocycleWeeks: 9,
        deloadWeek: null,
        history,
      })
    const completed = {
      e1rmKg: null,
      lastSets: [10, 10, 10].map((reps) => ({ reps, weightKg: 60 })),
    }
    const failed = { e1rmKg: null, lastSets: [10, 10, 8].map((reps) => ({ reps, weightKg: 60 })) }
    expect(derive(completed).map((s) => s.loadKg)).toEqual(Array(3).fill(62.5)) // +2.5 upper [G1]
    expect(derive(failed).map((s) => s.loadKg)).toEqual(Array(3).fill(60)) // hold, don't ladder
  })
})

describe('corpus: follow-down (H1) — the plan is matched to reality [H1]', () => {
  it('three sessions worked at 90 kg vs a 100 kg plan anchor the block down to 90', () => {
    // Engine canon (H1, RTS/Juggernaut precedent): three consecutive
    // comparable sessions entirely at ≤ 95% of plan with the floors met
    // anchor the prescription to what was actually lifted.
    const sessions = [3, 2, 1].map((i) =>
      loggedSession({
        reps: [5, 5, 5],
        repMin: 5,
        loadKg: 100,
        weightKg: 90, // worked lighter, floors met
        startedAtMs: i * DAY_MS,
      }),
    )
    const verdict = autoregulate(2.5, sessions, 'all-sets')
    expect(verdict).toMatchObject({
      action: 'anchor',
      deltaKg: -10,
      anchor: { fromLoadKg: 100, toLoadKg: 90 },
    })
    expect(autoregReason(verdict as NonNullable<typeof verdict>, 'kg')).toBe(
      'Worked at ~90 kg vs the planned 100 kg for 3 sessions — matching the plan to reality',
    )
    // The next derive (linear would prescribe 107.5 by week 4) lands at
    // EXACTLY the demonstrated 90 — anchors prescribe the bucket load.
    const sets = [1, 2, 3].map((n) => row(n, { suggestedLoadKg: 100 }))
    const derived = deriveWeekSets({
      sets,
      progression: { scheme: 'linear', incrementKg: 2.5 },
      week: 4,
      mesocycleWeeks: 6,
      deloadWeek: null,
      history: NO_HISTORY,
    })
    const applied = applyAutoregToSets(derived, verdict as NonNullable<typeof verdict>)
    applied.forEach((s) => {
      expect(s.loadKg).toBe(90)
      expect(s.derivedFrom).toBe('autoreg')
      expect(s.schemeLoadKg).toBe(107.5)
    })
  })
})

describe("corpus: top-set program under the 'first-set' stall policy (C1)", () => {
  // A top-set-driven program (heaviest set FIRST, reverse-pyramid shape):
  // the C1 docblock's 'first-set' convention — only the governing top set
  // decides the session, back-off sets never stall the lift. Engine-canon
  // policy semantics; no external numeric table applies.
  const sets = [
    row(1, { suggestedLoadKg: 100 }), // the governing top set
    row(2, { suggestedLoadKg: 90 }),
    row(3, { suggestedLoadKg: 80 }),
  ]
  const derive = (week: number) =>
    deriveWeekSets({
      sets,
      progression: { scheme: 'linear', incrementKg: 2.5 },
      week,
      mesocycleWeeks: 6,
      deloadWeek: null,
      history: NO_HISTORY,
    })
  /** Top set hits its floor; the lightest back-off misses (5,5,3 shape). */
  const topSetHits = (i: number): AutoregSession => ({
    startedAtMs: i * DAY_MS,
    prescribed: [
      { setNumber: 1, repMin: 5, loadKg: 100, setType: 'working' },
      { setNumber: 2, repMin: 5, loadKg: 90, setType: 'working' },
      { setNumber: 3, repMin: 5, loadKg: 80, setType: 'working' },
    ],
    actual: [
      { setNumber: 1, reps: 5, weightKg: 100, completed: true, setType: 'working' },
      { setNumber: 2, reps: 5, weightKg: 90, completed: true, setType: 'working' },
      { setNumber: 3, reps: 3, weightKg: 80, completed: true, setType: 'working' },
    ],
  })

  it("a back-off miss never stalls under 'first-set' — the program keeps progressing", () => {
    const sessions = [3, 2, 1].map(topSetHits)
    // 'first-set': the governing 100 kg set hit its floor — no verdict at
    // all, three weeks running; the linear scheme proceeds to +2.5 per set.
    expect(autoregulate(2.5, sessions, 'first-set')).toBeNull()
    expect(derive(2).map((s) => s.loadKg)).toEqual([102.5, 92.5, 82.5])
    // The SAME history under 'all-sets' is three failed sessions at an
    // unchanged top load (H2) — a third-fail decrement. The policy is the
    // whole difference between "progress" and "back off" on this shape.
    expect(autoregulate(2.5, sessions, 'all-sets')).toMatchObject({
      action: 'decrement',
      suggestEarlyDeload: true,
    })
  })
})
