import { describe, expect } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import { applyOverride, deriveWeekSets, DELOAD_LOAD_FACTOR } from '@/lib/progression'
import {
  applyAutoregToSets,
  autoregulate,
  autoregulateAnchor,
  autoregulateEarlyDeload,
  autoregulateRange,
  AUTOREG_SESSION_WINDOW,
  type AutoregStallPolicy,
} from '@/lib/autoregulate'
import { detectPlanSyncCandidates, type PlanSyncWorkoutExercise } from '@/lib/plan-sync'
import {
  bankedWaveEquivalenceHolds,
  c2CapsAreLoadKeyedNotPositional,
  c2LighterSetBelowEvidenceUntouched,
  deloadShapeHolds,
  h2StreakResetsOnLoadChange,
  h3MixedTopBucketNeverSteps,
  h6OrderInsensitive,
  loadsFiniteNonNegative,
  m2NoUpAnchorFromSingleSession,
  m3QuorumGatesVerdict,
  overridePrecedenceHolds,
  planSyncAgreesWithEngine,
  reasonNonEmptyOnAdjustment,
  waveArithmeticNoDrift,
} from './invariants'
import {
  amrapCycleArb,
  evidenceLoadArb,
  evidenceSession,
  evidenceWindowArb,
  fuzzSessionsArb,
  historyArb,
  kgArb,
  linearProgressionArb,
  programSetRowsArb,
  progressionArb,
  sessionsWithPermutationArb,
  setOverrideArb,
  weeklyVolumeArb,
  weekGeometryArb,
} from './arbitraries'

/**
 * Layer 2 stateless properties (progression-test-harness.prd.md): every
 * assertion cites a Layer 1 registry invariant by name. Seeded and
 * deterministic; the blocking run uses a small numRuns budget (CI ≤ ~30 s
 * added), HARNESS_DEEP=1 unlocks the nightly sweep.
 */
const DEEP = process.env.HARNESS_DEEP === '1'
fc.configureGlobal({ seed: 20260809, numRuns: DEEP ? 10_000 : 500 })

const policyArb = fc.constantFrom<AutoregStallPolicy>('all-sets', 'first-set')

describe('deriveWeekSets / applyOverride properties', () => {
  // Invariant: overridePrecedenceHolds (precedence — override > deload >
  // scheme > template), asserted across the FULL derive chain.
  test.prop([programSetRowsArb, progressionArb, weekGeometryArb, historyArb, setOverrideArb])(
    'override precedence holds over every scheme and the deload',
    (sets, progression, geometry, history, override) => {
      const derived = deriveWeekSets({ sets, progression, history, ...geometry })
      for (const set of derived) {
        expect(overridePrecedenceHolds(set, override)).toBe(true)
        expect(overridePrecedenceHolds(set, null)).toBe(true)
      }
    },
  )

  // Invariant: loadsFiniteNonNegative (clampLoad law) over all 7 schemes.
  test.prop([programSetRowsArb, progressionArb, weekGeometryArb, historyArb])(
    'derived loads are always null or finite and non-negative',
    (sets, progression, geometry, history) => {
      const derived = deriveWeekSets({ sets, progression, history, ...geometry })
      expect(loadsFiniteNonNegative(derived)).toBe(true)
    },
  )

  // Invariant: deloadShapeHolds (DELOAD_SET_FACTOR ceil-min-1 + stamp).
  test.prop([programSetRowsArb, progressionArb, weekGeometryArb, historyArb])(
    'the deload week halves working sets (ceil, min 1) and stamps deload',
    (sets, progression, geometry, history) => {
      fc.pre(geometry.deloadWeek !== null)
      const derived = deriveWeekSets({
        sets,
        progression,
        history,
        ...geometry,
        week: geometry.deloadWeek as number,
      })
      expect(deloadShapeHolds(sets, derived)).toBe(true)
    },
  )

  // Differential: linear closed form (base + inc·(deloadWeek−1)) × 0.85 on
  // the deload week — pins the deload factor to DELOAD_LOAD_FACTOR exactly.
  test.prop([programSetRowsArb, linearProgressionArb, weekGeometryArb, historyArb])(
    'linear deload loads equal the closed form times DELOAD_LOAD_FACTOR',
    (sets, progression, geometry, history) => {
      fc.pre(geometry.deloadWeek !== null)
      const week = geometry.deloadWeek as number
      const derived = deriveWeekSets({ sets, progression, history, ...geometry, week })
      for (const s of derived) {
        if (s.setType === 'warmup') continue
        const base = sets[s.sourceIndex].suggestedLoadKg
        const expected =
          base === null
            ? null
            : Math.max(0, (base + progression.incrementKg * (week - 1)) * DELOAD_LOAD_FACTOR)
        if (expected === null) expect(s.loadKg).toBeNull()
        else expect(s.loadKg).toBeCloseTo(expected, 9)
      }
    },
  )

  // Invariant: waveArithmeticNoDrift (amrapCompletedWaves vs the naive loop).
  test.prop([
    fc.integer({ min: -2, max: 60 }),
    fc.integer({ min: 1, max: 52 }),
    fc.option(fc.integer({ min: 1, max: 52 }), { nil: null }),
    fc.integer({ min: 1, max: 12 }),
  ])('amrap completed-wave closed form matches the naive week loop', (week, meso, deload, waveLen) => {
    expect(waveArithmeticNoDrift(week, meso, deload, waveLen)).toBe(true)
  })

  // Invariant: bankedWaveEquivalenceHolds (banked bumps never double-count).
  test.prop([programSetRowsArb, amrapCycleArb, weekGeometryArb, historyArb])(
    'banked waves derive the same loads as an unbanked lower training max',
    (sets, progression, geometry, history) => {
      expect(bankedWaveEquivalenceHolds({ sets, progression, history, ...geometry })).toBe(true)
    },
  )

  // Differential: weekly-volume working-set count vs the naive mev→mrv ramp.
  test.prop([programSetRowsArb, weeklyVolumeArb, weekGeometryArb, historyArb])(
    'weekly-volume working-set count matches the naive ramp',
    (sets, progression, geometry, history) => {
      const { week: rawWeek, mesocycleWeeks, deloadWeek } = geometry
      const week = Math.min(Math.max(1, rawWeek), Math.max(1, mesocycleWeeks))
      fc.pre(week !== deloadWeek)
      fc.pre(sets.some((s) => s.setType === 'working')) // resize is a no-op otherwise
      const weeks: number[] = []
      for (let w = 1; w <= Math.max(1, mesocycleWeeks); w++) if (w !== deloadWeek) weeks.push(w)
      const idx = Math.max(0, weeks.indexOf(week))
      const naive =
        weeks.length <= 1
          ? progression.mevSets
          : Math.round(
              progression.mevSets +
                ((progression.mrvSets - progression.mevSets) * idx) / (weeks.length - 1),
            )
      const derived = deriveWeekSets({ sets, progression, history, ...geometry })
      const working = derived.filter((s) => s.setType === 'working').length
      expect(working).toBe(naive)
    },
  )

  // Invariant: overridePrecedenceHolds, load leg only — the full chain ends
  // at the override's exact value regardless of scheme and deload.
  test.prop([programSetRowsArb, progressionArb, weekGeometryArb, historyArb, kgArb(0, 300)])(
    'a load override lands exactly, over any scheme and the deload',
    (sets, progression, geometry, history, loadKg) => {
      const derived = deriveWeekSets({ sets, progression, history, ...geometry })
      for (const set of derived) {
        const merged = applyOverride(set, {
          repMin: null,
          repMax: null,
          rir: null,
          rpe: null,
          suggestedLoadKg: loadKg,
          tempo: null,
          durationSec: null,
          distanceM: null,
          restSec: null,
          technique: null,
        })
        expect(merged.loadKg).toBe(loadKg)
        expect(merged.derivedFrom).toBe('override')
      }
    },
  )
})

describe('autoregulate properties', () => {
  // Invariant: h6OrderInsensitive — every entry point, fuzzed sessions.
  test.prop([sessionsWithPermutationArb, kgArb(0, 10), policyArb])(
    'H6: all four entry points are insensitive to session array order',
    ({ sessions, permuted }, incrementKg, policy) => {
      expect(
        h6OrderInsensitive((ss) => autoregulate(incrementKg, ss, policy), sessions, permuted),
      ).toBe(true)
      expect(
        h6OrderInsensitive(
          (ss) => autoregulateRange(incrementKg, ss, [{ loadKg: 100, repMax: 10 }]),
          sessions,
          permuted,
        ),
      ).toBe(true)
      expect(
        h6OrderInsensitive((ss) => autoregulateEarlyDeload(ss, policy), sessions, permuted),
      ).toBe(true)
      expect(h6OrderInsensitive((ss) => autoregulateAnchor(ss), sessions, permuted)).toBe(true)
    },
  )

  // Invariant: m3QuorumGatesVerdict — K scorable of N snapshot working sets,
  // all loaded, 'all-sets' policy: under quorum there is NO verdict.
  test.prop([
    fc.integer({ min: 1, max: 6 }),
    fc.integer({ min: 0, max: 6 }),
    evidenceLoadArb,
    fc.boolean(),
  ])('M3: no verdict of any kind without the evidence quorum', (n, kRaw, loadKg, stallReps) => {
    const k = Math.min(kRaw, n)
    const reps = stallReps ? 3 : 5 // both stall and pass evidence under-quorum
    const session = {
      startedAtMs: 86_400_000,
      prescribed: Array.from({ length: n }, (_, i) => ({
        setNumber: i + 1,
        repMin: 5,
        loadKg,
        setType: 'working',
      })),
      actual: Array.from({ length: n }, (_, i) => ({
        setNumber: i + 1,
        reps: i < k ? reps : null,
        weightKg: i < k ? loadKg : null,
        completed: i < k,
        setType: 'working',
      })),
    }
    const adjustment = autoregulate(2.5, [session], 'all-sets')
    expect(m3QuorumGatesVerdict(adjustment, k, n)).toBe(true)
  })

  // Invariant: h2StreakResetsOnLoadChange — three straight single-set stalls
  // whose LATEST prescribed load differs (≥ 20 kg here) never decrement.
  test.prop([evidenceLoadArb, evidenceLoadArb, fc.integer({ min: 3, max: 5 })])(
    'H2: a prescribed-load change resets the stall streak',
    (latestLoad, olderLoad, count) => {
      fc.pre(latestLoad !== olderLoad)
      const sessions = Array.from({ length: count }, (_, i) =>
        evidenceSession({
          cls: 'stallAtLoad',
          loadKg: i === 0 ? latestLoad : olderLoad,
          sets: 1,
          startedAtMs: (count - i) * 86_400_000,
        }),
      )
      expect(h2StreakResetsOnLoadChange(autoregulate(2.5, sessions, 'all-sets'))).toBe(true)
    },
  )

  // Positive control for H2's boundary: SAME load, three straight stalls —
  // the streak must escalate to a decrement (StrongLifts' third-fail rule).
  test.prop([evidenceLoadArb, fc.integer({ min: 3, max: AUTOREG_SESSION_WINDOW + 2 })])(
    'three stalls at the same prescribed load decrement',
    (loadKg, count) => {
      const sessions = Array.from({ length: count }, (_, i) =>
        evidenceSession({
          cls: 'stallAtLoad',
          loadKg,
          sets: 1,
          startedAtMs: (count - i) * 86_400_000,
        }),
      )
      const adjustment = autoregulate(2.5, sessions, 'all-sets')
      expect(adjustment?.action).toBe('decrement')
      expect(adjustment?.suggestEarlyDeload).toBe(true)
      expect(adjustment && adjustment.deltaKg <= 0).toBe(true)
    },
  )

  // Invariant: m2NoUpAnchorFromSingleSession — one outperform session whose
  // predecessor did NOT outperform must never raise a prescribed load.
  test.prop([
    evidenceLoadArb,
    fc.constantFrom<'cleanPass' | 'stallAtLoad' | 'lighterWork' | 'deviatedDay'>(
      'cleanPass',
      'stallAtLoad',
      'lighterWork',
      'deviatedDay',
    ),
    policyArb,
  ])('M2: an up-anchor needs two consecutive outperform sessions', (loadKg, previousCls, policy) => {
    const sessions = [
      evidenceSession({ cls: 'outperform', loadKg, startedAtMs: 3 * 86_400_000 }),
      evidenceSession({ cls: previousCls, loadKg, startedAtMs: 2 * 86_400_000 }),
      evidenceSession({ cls: 'cleanPass', loadKg, startedAtMs: 1 * 86_400_000 }),
    ]
    expect(m2NoUpAnchorFromSingleSession(autoregulate(2.5, sessions, policy))).toBe(true)
  })

  // Invariant: h3MixedTopBucketNeverSteps — one load bucket, heterogeneous
  // tops, reps beyond every top: the fill is unconfirmable, never a step.
  test.prop([
    evidenceLoadArb,
    fc.integer({ min: 6, max: 10 }),
    fc.integer({ min: 1, max: 5 }),
    kgArb(0, 10),
  ])('H3v2: a mixed-top bucket never steps', (loadKg, topA, topSpan, stepKg) => {
    const topB = topA + topSpan // ≠ topA — heterogeneous within the bucket
    const session = evidenceSession({
      cls: 'cleanPass',
      loadKg,
      sets: 2,
      repFloor: topB, // reps meet BOTH tops — an optimistic match would "fill"
      startedAtMs: 86_400_000,
    })
    const verdict = autoregulateRange(stepKg, [session], [
      { loadKg, repMax: topA },
      { loadKg, repMax: topB },
    ])
    expect(h3MixedTopBucketNeverSteps(verdict)).toBe(true)
  })

  // Invariants: c2CapsAreLoadKeyedNotPositional + loadsFiniteNonNegative
  // (post-autoreg) + c2LighterSetBelowEvidenceUntouched — renumbering never
  // changes an applied load; nothing goes negative or non-finite; sets below
  // every evidence load pass through untouched.
  test.prop([
    programSetRowsArb,
    progressionArb,
    weekGeometryArb,
    historyArb,
    evidenceWindowArb(1, 4),
    kgArb(0, 10),
    policyArb,
  ])(
    'C2: applied caps are load-keyed, never positional; loads stay sane',
    (sets, progression, geometry, history, sessions, incrementKg, policy) => {
      const adjustment = autoregulate(incrementKg, sessions, policy)
      fc.pre(adjustment !== null)
      const verdict = adjustment as NonNullable<typeof adjustment>
      const derived = deriveWeekSets({ sets, progression, history, ...geometry })
      const applied = applyAutoregToSets(derived, verdict)
      const renumbered = derived.map((s) => ({ ...s, setNumber: s.setNumber + 7 }))
      const appliedRenumbered = applyAutoregToSets(renumbered, verdict)
      expect(c2CapsAreLoadKeyedNotPositional(applied, appliedRenumbered)).toBe(true)
      expect(loadsFiniteNonNegative(applied)).toBe(true)
      for (let i = 0; i < derived.length; i++) {
        expect(c2LighterSetBelowEvidenceUntouched(derived[i], applied[i], verdict)).toBe(true)
      }
    },
  )

  // Invariant: reasonNonEmptyOnAdjustment — the transparency contract over
  // fully fuzzed sessions, all four entry points.
  test.prop([fuzzSessionsArb, kgArb(0, 10), policyArb])(
    'every verdict from any entry point renders a clean reason line',
    (sessions, incrementKg, policy) => {
      expect(reasonNonEmptyOnAdjustment(autoregulate(incrementKg, sessions, policy))).toBe(true)
      expect(
        reasonNonEmptyOnAdjustment(
          autoregulateRange(incrementKg, sessions, [{ loadKg: 100, repMax: 10 }]),
        ),
      ).toBe(true)
      expect(reasonNonEmptyOnAdjustment(autoregulateEarlyDeload(sessions, policy))).toBe(true)
      expect(reasonNonEmptyOnAdjustment(autoregulateAnchor(sessions))).toBe(true)
    },
  )
})

describe('review-gap positive controls (Layer 1-2 review)', () => {
  // M4 positive control — the negative properties above prove flags never
  // adjust; this proves the flag actually FIRES: three genuine consecutive
  // stalls (any policy — the evidence class misses EVERY floor, so the
  // governing set misses too) must produce action 'flag' with zero delta,
  // and applyAutoregToSets must pass every derived set through untouched.
  test.prop([evidenceLoadArb, policyArb, programSetRowsArb, progressionArb, weekGeometryArb, historyArb])(
    'M4: three genuine stalls flag — and a flag adjusts nothing',
    (loadKg, policy, sets, progression, geometry, history) => {
      const sessions = [3, 2, 1].map((i) =>
        evidenceSession({ cls: 'stallAtLoad', loadKg, startedAtMs: i * 86_400_000 }),
      )
      const verdict = autoregulateEarlyDeload(sessions, policy)
      expect(verdict?.action).toBe('flag')
      expect(verdict?.suggestEarlyDeload).toBe(true)
      expect(verdict?.deltaKg).toBe(0)
      const derived = deriveWeekSets({ sets, progression, history, ...geometry })
      const applied = applyAutoregToSets(derived, verdict as NonNullable<typeof verdict>)
      expect(applied).toEqual(derived)
    },
  )

  // RANGE positive control — a genuine fill (uniform-top rows, every rep at
  // the top) must STEP by exactly stepKg. The H3v2 property above only
  // proves mixed tops never step; this pins the step actually firing.
  test.prop([
    evidenceLoadArb,
    fc.integer({ min: 1, max: 4 }),
    fc.integer({ min: 6, max: 12 }),
    kgArb(0.5, 10),
  ])('RANGE: a genuine uniform-top fill steps by exactly stepKg', (loadKg, count, top, stepKg) => {
    const session = evidenceSession({
      cls: 'cleanPass',
      loadKg,
      sets: count,
      repFloor: top, // cleanPass performs exactly repFloor — every top met
      startedAtMs: 86_400_000,
    })
    const rows = Array.from({ length: count }, () => ({ loadKg, repMax: top }))
    const verdict = autoregulateRange(stepKg, [session], rows)
    expect(verdict?.action).toBe('step')
    expect(verdict?.deltaKg).toBe(stepKg)
  })

  /** A range-mode session with per-set reps at one prescribed load — the
   *  M1/C1 shapes need reps that differ per set, which evidenceSession's
   *  uniform classes can't express. */
  const perSetRepsSession = (
    reps: readonly number[],
    repMin: number,
    loadKg: number,
    startedAtMs: number,
  ) => ({
    startedAtMs,
    prescribed: reps.map((_, i) => ({
      setNumber: i + 1,
      repMin,
      loadKg,
      setType: 'working',
    })),
    actual: reps.map((r, i) => ({
      setNumber: i + 1,
      reps: r,
      weightKg: loadKg,
      completed: true,
      setType: 'working',
    })),
  })

  // M1 positive control — a flat streak parked within ONE rep of the fill
  // target (12,12,11 vs 3×12: 35 of 36) across the full range window HOLDs
  // (repeat) instead of decrementing: the model is densifying, not failing.
  test.prop([evidenceLoadArb, kgArb(0.5, 10)])(
    'M1: a near-fill flat streak holds instead of decrementing',
    (loadKg, stepKg) => {
      const sessions = [4, 3, 2, 1].map((i) =>
        perSetRepsSession([12, 12, 11], 6, loadKg, i * 86_400_000),
      )
      const rows = Array.from({ length: 3 }, () => ({ loadKg, repMax: 12 }))
      const verdict = autoregulateRange(stepKg, sessions, rows)
      expect(verdict?.action).toBe('repeat')
      expect(verdict?.deltaKg).toBe(0)
      expect(verdict?.suggestEarlyDeload).toBe(false)
      expect(verdict?.range?.stalls).toBeGreaterThanOrEqual(3)
    },
  )

  // C1 distinguishing scenario — the docblock's 8,8,6 shape (first set hits
  // its floor, a later set misses): a failed session under 'all-sets' (the
  // StrongLifts/Starting Strength definition), a pass under 'first-set'
  // (the top-set-driven convention).
  test.prop([evidenceLoadArb])(
    "C1: 8,8,6 stalls under 'all-sets' and passes under 'first-set'",
    (loadKg) => {
      const session = perSetRepsSession([8, 8, 6], 8, loadKg, 86_400_000)
      const allSets = autoregulate(2.5, [session], 'all-sets')
      expect(allSets?.action).toBe('repeat')
      expect(allSets?.evidence).toMatchObject({ missedSets: 1, scorableSets: 3 })
      expect(autoregulate(2.5, [session], 'first-set')).toBeNull()
    },
  )
})

describe('plan-sync properties', () => {
  const workoutArb: fc.Arbitrary<PlanSyncWorkoutExercise> = fc
    .tuple(
      evidenceLoadArb,
      fc.constantFrom<'cleanPass' | 'outperform' | 'stallAtLoad'>(
        'cleanPass',
        'outperform',
        'stallAtLoad',
      ),
      fc.integer({ min: 1, max: 4 }),
      // How many TRAILING rows form an intensity-technique group. Non-zero
      // cases are the ones that matter: such rows must testify on neither
      // side, so the generator has to be able to produce them or the
      // exclusion is never exercised by this invariant at all.
      fc.integer({ min: 0, max: 2 }),
    )
    .map(([loadKg, cls, count, techniqueTail]) => {
      const session = evidenceSession({ cls, loadKg, sets: count, startedAtMs: 86_400_000 })
      const firstStage = session.prescribed.length - techniqueTail
      return {
        wgerExerciseId: 1,
        source: 'wger',
        loggingType: 'weight_reps',
        skipped: false,
        sets: session.prescribed.map((p, i) => {
          const isStage = i >= firstStage
          if (!isStage) {
            return {
              setNumber: p.setNumber,
              reps: session.actual[i].reps,
              weight: session.actual[i].weightKg,
              completed: session.actual[i].completed,
              setType: p.setType ?? 'working',
              prescribedLoadKg: p.loadKg,
              prescribedRepMin: p.repMin,
              techniqueKind: null,
            }
          }
          // A drop stage as one actually looks: a distinctly LOWER prescribed
          // load, beaten on the day. That is what makes the exclusion
          // observable — such a row opens an anchor bucket of its own, at a
          // load a plan set may well sit on, so a scorer that forgets to drop
          // it proposes a drop's performance as a plan load.
          const stageLoad = p.loadKg === null ? null : Math.round(p.loadKg * 0.6 * 100) / 100
          return {
            setNumber: p.setNumber,
            reps: p.repMin,
            weight: stageLoad === null ? null : stageLoad * 1.5,
            completed: true,
            setType: p.setType ?? 'working',
            prescribedLoadKg: stageLoad,
            prescribedRepMin: p.repMin,
            techniqueKind: 'drop-set',
          }
        }),
      }
    })

  // Invariant: planSyncAgreesWithEngine (shared-evidence contract, C2 + M2).
  test.prop([
    workoutArb,
    fc.array(fc.option(evidenceLoadArb, { nil: null }), { minLength: 1, maxLength: 4 }),
    fc.boolean(),
  ])('plan-sync proposals are exactly the engine anchors, load-keyed', (workout, planLoads, confirmed) => {
    const plan = {
      position: 0,
      wgerExerciseId: 1,
      source: 'wger',
      name: 'Squat',
      sets: planLoads.map((suggestedLoadKg, i) => ({
        setNumber: i + 1,
        setType: 'working',
        metricMode: 'reps_weight',
        repMin: 5,
        suggestedLoadKg,
      })),
    }
    // M2 confirmation = the previous session of the day also outperformed its
    // own snapshots; reuse the workout itself as that previous session (it
    // qualifies iff it outperformed — the same rule detectPlanSyncCandidates
    // applies via sessionAnchorLoads).
    const candidates = detectPlanSyncCandidates([workout], [plan], confirmed ? [workout] : [])
    // Technique rows testify on neither side, so they cannot make (or break)
    // the M2 confirmation either — the same population the scorer sees.
    const scorable = workout.sets.filter((s) => s.techniqueKind == null)
    const workoutOutperformed =
      scorable.length > 0 &&
      scorable.every(
        (s) => s.weight !== null && s.prescribedLoadKg !== null && s.weight > s.prescribedLoadKg,
      )
    const upConfirmed = confirmed && workoutOutperformed
    expect(planSyncAgreesWithEngine(workout, plan, upConfirmed, candidates[0])).toBe(true)
    // And every proposed load is a weight the lifter actually moved.
    const performed = new Set(scorable.map((s) => s.weight))
    for (const candidate of candidates) {
      for (const change of candidate.changes) {
        expect(performed.has(change.proposedLoadKg)).toBe(true)
      }
    }
  })
})
