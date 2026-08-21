import fc from 'fast-check'
import type {
  ExerciseHistoryInput,
  ProgramSetRowLike,
  SetOverrideLike,
} from '@/lib/progression'
import type { AutoregSession } from '@/lib/autoregulate'
import type { Progression } from '@/lib/program-input'

/**
 * Layer 2 arbitraries (progression-test-harness.prd.md): one arbitrary per
 * domain type, per-scheme generators composed with `fc.oneof` — scheme #8 is
 * one new arm here, never a rewritten test. Bounds are HAND-BUILT to respect
 * `program-input.ts`'s zod schemas as shape truth (no zod-fast-check
 * derivation, per the PRD's NOT-building list). No wall-clock reads:
 * `startedAtMs` is always generated.
 *
 * Loads are generated on a 0.5 kg lattice so evidence classification
 * (at-load / lighter / outperform, ε = load-quantize's LOAD_EPSILON_KG in
 * the engine) is unambiguous by construction — properties never need the
 * epsilon itself.
 */

/** Loads on a 0.5 kg lattice within [min, max] kg. */
export const kgArb = (minKg: number, maxKg: number): fc.Arbitrary<number> =>
  fc.integer({ min: Math.round(minKg * 2), max: Math.round(maxKg * 2) }).map((n) => n / 2)

// --- Per-scheme progression arbitraries (zod bounds: progressionSchema) ----

export const linearProgressionArb: fc.Arbitrary<Extract<Progression, { scheme: 'linear' }>> =
  kgArb(0, 25).map((incrementKg) => ({ scheme: 'linear', incrementKg }))

export const doubleProgressionArb: fc.Arbitrary<
  Extract<Progression, { scheme: 'double-progression' }>
> = fc
  .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 0, max: 8 }), kgArb(0, 10))
  .map(([repMin, span, incrementKg]) => ({
    scheme: 'double-progression',
    repMin,
    repMax: repMin + span, // repMin ≤ repMax (schema superRefine)
    incrementKg,
  }))

export const percent1rmArb: fc.Arbitrary<Extract<Progression, { scheme: 'percent-1rm' }>> = fc
  .tuple(
    kgArb(20, 300),
    fc.array(fc.integer({ min: 0, max: 200 }).map((n) => n / 100), {
      minLength: 1,
      maxLength: 12, // schema allows 52; 12 covers every geometry we generate
    }),
  )
  .map(([trainingMaxKg, weekPercents]) => ({ scheme: 'percent-1rm', trainingMaxKg, weekPercents }))

export const rpeTargetArb: fc.Arbitrary<Extract<Progression, { scheme: 'rpe-target' }>> = fc
  .integer({ min: 0, max: 20 })
  .map((halfSteps) => ({ scheme: 'rpe-target', targetRpe: halfSteps / 2 }))

export const weeklyVolumeArb: fc.Arbitrary<Extract<Progression, { scheme: 'weekly-volume' }>> = fc
  .tuple(fc.integer({ min: 0, max: 8 }), fc.integer({ min: 0, max: 8 }))
  .map(([mevSets, span]) => ({ scheme: 'weekly-volume', mevSets, mrvSets: mevSets + span }))

export const repProgressionArb: fc.Arbitrary<Extract<Progression, { scheme: 'rep-progression' }>> =
  fc
    .tuple(
      fc.integer({ min: 0, max: 5 }),
      fc.integer({ min: 0, max: 60 }),
      fc.option(fc.integer({ min: 1, max: 50 }), { nil: null }),
      fc.option(fc.integer({ min: 1, max: 3600 }), { nil: null }),
    )
    .map(([incrementReps, incrementSec, maxReps, maxSec]) => ({
      scheme: 'rep-progression',
      // Schema superRefine: at least one increment must be > 0.
      incrementReps: incrementReps === 0 && incrementSec === 0 ? 1 : incrementReps,
      incrementSec,
      maxReps,
      maxSec,
    }))

/** Wave rows: fractions of TM in [0, 2] (schema), 1–5 sets per row. */
const waveRowArb = fc.array(fc.integer({ min: 0, max: 200 }).map((n) => n / 100), {
  minLength: 1,
  maxLength: 5,
})

export const amrapCycleArb: fc.Arbitrary<Extract<Progression, { scheme: 'amrap-cycle' }>> = fc
  .tuple(
    kgArb(50, 300),
    kgArb(0, 10),
    fc.integer({ min: 0, max: 4 }),
    fc.array(waveRowArb, { minLength: 1, maxLength: 6 }),
    fc.boolean(),
  )
  .chain(([trainingMaxKg, incrementKg, bankedWaves, wave, withReps]) =>
    (withReps
      ? fc.array(fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 5 }), {
          minLength: wave.length,
          maxLength: wave.length, // schema superRefine: one reps row per wave week
        })
      : fc.constant(undefined)
    ).map((waveReps) => ({
      scheme: 'amrap-cycle' as const,
      // Keep TM ≥ bank·increment so the banked-wave equivalence stays in-bounds.
      trainingMaxKg: Math.max(trainingMaxKg, bankedWaves * incrementKg),
      incrementKg,
      bankedWaves,
      wave,
      ...(waveReps ? { waveReps } : {}),
    })),
  )

/** All 7 schemes, composed per the PRD's extensibility rule: a new scheme is
 *  one new `fc.oneof` arm. */
export const progressionArb: fc.Arbitrary<Progression> = fc.oneof(
  linearProgressionArb,
  doubleProgressionArb,
  percent1rmArb,
  rpeTargetArb,
  weeklyVolumeArb,
  repProgressionArb,
  amrapCycleArb,
)

// --- Template rows, geometry, history, overrides ---------------------------

const setTypeArb = fc.constantFrom<ProgramSetRowLike['setType']>(
  'warmup',
  'working',
  'backoff',
  'amrap',
)

/** One template set row (programSetSchema bounds); reps_weight metric mode —
 *  the mode every scheme's load math runs on. `setNumber` assigned by
 *  `programSetRowsArb`. */
const programSetRowBaseArb: fc.Arbitrary<Omit<ProgramSetRowLike, 'setNumber'>> = fc
  .tuple(
    setTypeArb,
    fc.option(fc.integer({ min: 1, max: 12 }), { nil: null }),
    fc.option(fc.integer({ min: 0, max: 8 }), { nil: null }),
    fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
    fc.option(fc.integer({ min: 12, max: 20 }).map((n) => n / 2), { nil: null }),
    fc.option(kgArb(2.5, 300), { nil: null }),
    fc.option(fc.integer({ min: 0, max: 600 }), { nil: null }),
  )
  .map(([setType, repMin, repSpan, rir, rpe, suggestedLoadKg, restSec]) => ({
    setType,
    metricMode: 'reps_weight' as const,
    repMin,
    repMax: repMin !== null && repSpan !== null ? repMin + repSpan : null,
    rir,
    rpe,
    suggestedLoadKg,
    tempo: null,
    durationSec: null,
    distanceM: null,
    restSec,
    technique: null,
  }))

/** 1–6 template rows, renumbered 1-based (mixed setTypes incl. warmups). */
export const programSetRowsArb: fc.Arbitrary<ProgramSetRowLike[]> = fc
  .array(programSetRowBaseArb, { minLength: 1, maxLength: 6 })
  .map((rows) => rows.map((row, i) => ({ ...row, setNumber: i + 1 })))

export interface WeekGeometry {
  week: number
  mesocycleWeeks: number
  deloadWeek: number | null
}

/** Program week geometry (programInputSchema bounds), week possibly past the
 *  mesocycle to exercise the clamp. */
export const weekGeometryArb: fc.Arbitrary<WeekGeometry> = fc
  .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 14 }), fc.boolean())
  .map(([mesocycleWeeks, week, hasDeload]) => ({
    mesocycleWeeks,
    week,
    deloadWeek: hasDeload ? Math.min(mesocycleWeeks, Math.max(1, week % mesocycleWeeks || 1)) : null,
  }))

export const historyArb: fc.Arbitrary<ExerciseHistoryInput> = fc
  .tuple(
    fc.option(kgArb(20, 300), { nil: null }),
    fc.option(
      fc.array(
        fc.record({
          reps: fc.option(fc.integer({ min: 0, max: 15 }), { nil: null }),
          weightKg: fc.option(kgArb(2.5, 300), { nil: null }),
        }),
        { minLength: 0, maxLength: 5 },
      ),
      { nil: null },
    ),
  )
  .map(([e1rmKg, lastSets]) => ({ e1rmKg, lastSets }))

/** A per-week override (setOverrideSchema bounds): each field null (not
 *  overridden) or a value that wins. */
export const setOverrideArb: fc.Arbitrary<SetOverrideLike> = fc.record({
  repMin: fc.option(fc.integer({ min: 0, max: 15 }), { nil: null }),
  repMax: fc.option(fc.integer({ min: 0, max: 20 }), { nil: null }),
  rir: fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
  rpe: fc.option(fc.integer({ min: 0, max: 20 }).map((n) => n / 2), { nil: null }),
  suggestedLoadKg: fc.option(kgArb(0, 300), { nil: null }),
  tempo: fc.option(fc.constantFrom('3-1-1', '2-0-2'), { nil: null }),
  durationSec: fc.option(fc.integer({ min: 0, max: 600 }), { nil: null }),
  distanceM: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: null }),
  restSec: fc.option(fc.integer({ min: 0, max: 3600 }), { nil: null }),
  technique: fc.constant(null),
})

// --- Autoreg session arbitraries -------------------------------------------

/** Evidence classes the model-based commands and constructive properties
 *  speak in — each maps to one unambiguous engine classification. */
export type SessionClass =
  | 'cleanPass' // at-load, floors met (weight = prescribed exactly)
  | 'stallAtLoad' // at-load, under the floor
  | 'outperform' // every set at 110% of plan, floors met
  | 'lighterWork' // every set at 90% of plan, floors met (H1 evidence)
  | 'deviatedDay' // nothing completed — no evidence of any kind

export interface EvidenceSessionArgs {
  cls: SessionClass
  loadKg: number
  startedAtMs: number
  /** Working sets (default 2). */
  sets?: number
  /** Rep floor (default 5; stall performs floor − 2). */
  repFloor?: number
  /** Prepend a warmup row (never scored). */
  withWarmup?: boolean
}

/** One prior session of a known evidence class. Weights sit far outside the
 *  engine's ε (multiples of 5% of a ≥2.5 kg lattice load), so classification
 *  is certain: at-load = 100%, lighter = 90% (≤ 95%), outperform = 110%
 *  (≥ 105%). */
export function evidenceSession(args: EvidenceSessionArgs): AutoregSession {
  const { cls, loadKg, startedAtMs } = args
  const count = args.sets ?? 2
  const repFloor = args.repFloor ?? 5
  const weight =
    cls === 'outperform' ? loadKg * 1.1 : cls === 'lighterWork' ? loadKg * 0.9 : loadKg
  const reps = cls === 'stallAtLoad' ? Math.max(0, repFloor - 2) : repFloor
  const completed = cls !== 'deviatedDay'
  const offset = args.withWarmup ? 1 : 0
  const prescribed = [
    ...(args.withWarmup
      ? [{ setNumber: 1, repMin: repFloor, loadKg: loadKg / 2, setType: 'warmup' }]
      : []),
    ...Array.from({ length: count }, (_, i) => ({
      setNumber: offset + i + 1,
      repMin: repFloor,
      loadKg,
      setType: 'working',
    })),
  ]
  const actual = prescribed.map((p) => ({
    setNumber: p.setNumber,
    reps: completed ? reps : null,
    weightKg: completed ? (p.setType === 'warmup' ? loadKg / 2 : weight) : null,
    completed,
    setType: p.setType,
  }))
  return { startedAtMs, prescribed, actual }
}

export const sessionClassArb: fc.Arbitrary<SessionClass> = fc.constantFrom(
  'cleanPass',
  'stallAtLoad',
  'outperform',
  'lighterWork',
  'deviatedDay',
)

/** Loads deliberately drawn from a small pool so command sequences collide on
 *  the same load (streaks) and separate by ≥ 1 kg when they differ. */
export const evidenceLoadArb: fc.Arbitrary<number> = fc.constantFrom(60, 80, 100)

/** A window of evidence-class sessions, distinct descending startedAtMs
 *  assigned positionally (index 0 = newest). */
export const evidenceWindowArb = (
  minSessions: number,
  maxSessions: number,
): fc.Arbitrary<AutoregSession[]> =>
  fc
    .array(fc.tuple(sessionClassArb, evidenceLoadArb, fc.boolean()), {
      minLength: minSessions,
      maxLength: maxSessions,
    })
    .map((rows) =>
      rows.map(([cls, loadKg, withWarmup], i) =>
        evidenceSession({
          cls,
          loadKg,
          withWarmup,
          startedAtMs: (rows.length - i) * 86_400_000, // newest first, distinct
        }),
      ),
    )

/** Unconstrained-but-in-bounds session fuzz: random set counts, random
 *  nulls/completion/setTypes on both sides — the H6/transparency stressor.
 *  `startedAtMs` is assigned distinct by `fuzzSessionsArb`. */
const fuzzSetArb = fc.record({
  prescribedLoad: fc.option(kgArb(2.5, 200), { nil: null }),
  repMin: fc.option(fc.integer({ min: 1, max: 12 }), { nil: null }),
  reps: fc.option(fc.integer({ min: 0, max: 15 }), { nil: null }),
  weightKg: fc.option(kgArb(0, 250), { nil: null }),
  completed: fc.boolean(),
  setType: fc.option(fc.constantFrom('working', 'warmup', 'backoff'), { nil: undefined }),
})

const fuzzSessionBaseArb: fc.Arbitrary<Omit<AutoregSession, 'startedAtMs'>> = fc
  .array(fuzzSetArb, { minLength: 1, maxLength: 6 })
  .map((rows) => ({
    prescribed: rows.map((r, i) => ({
      setNumber: i + 1,
      repMin: r.repMin,
      loadKg: r.prescribedLoad,
      setType: r.setType,
    })),
    actual: rows.map((r, i) => ({
      setNumber: i + 1,
      reps: r.reps,
      weightKg: r.weightKg,
      completed: r.completed,
      setType: r.setType,
    })),
  }))

/** 0–6 fuzz sessions with DISTINCT startedAtMs (the H6 sort must be total). */
export const fuzzSessionsArb: fc.Arbitrary<AutoregSession[]> = fc
  .array(fuzzSessionBaseArb, { minLength: 0, maxLength: 6 })
  .map((sessions) => sessions.map((s, i) => ({ ...s, startedAtMs: (i + 1) * 3_600_000 })))

/** A session list plus a permutation of it (same references, shuffled). */
export const sessionsWithPermutationArb: fc.Arbitrary<{
  sessions: AutoregSession[]
  permuted: AutoregSession[]
}> = fc.tuple(fuzzSessionsArb, fc.infiniteStream(fc.nat())).map(([sessions, randoms]) => {
  const permuted = [...sessions]
  const draw = randoms[Symbol.iterator]()
  for (let i = permuted.length - 1; i > 0; i--) {
    const j = (draw.next().value as number) % (i + 1)
    ;[permuted[i], permuted[j]] = [permuted[j], permuted[i]]
  }
  return { sessions, permuted }
})
