/**
 * ADVERSARIAL VERIFICATION — progression trust (#226 / #227 / #228).
 *
 * Each test encodes a claim EXACTLY as the spec states it (issue bodies,
 * issue comments, logger-ux-overhaul.direction.md § Progression-engine
 * trust, and the modules' own documented contracts). A red test here is a
 * PROVEN discrepancy between spec and behavior — sources were never touched.
 */
import { describe, it, expect } from 'vitest'
import {
  LOAD_INCREMENT_KG,
  LOAD_INCREMENT_LB,
  loadsMatch,
  quantizeAdjustedLoadKg,
  quantizeDisplayLoad,
  quantizeLoadKg,
  quantizeSetLoads,
} from '../load-quantize'
import { displayToKg, kgToDisplay, type WeightUnit } from '../units'
import { defaultOvershootPolicy, resolveOvershootPolicy } from '../overshoot-policy'
import {
  autoregulate,
  autoregulateRange,
  autoregReason,
  applyAutoregToSets,
  sessionOvershoot,
  stampAppliedLoad,
  type AutoregRangeRow,
  type AutoregSession,
} from '../autoregulate'
import { estimate1RM } from '../one-rep-max'
import { schemeSentence, schemeSubtitle, repFillHoldReason } from '../scheme-copy'
import type { Progression } from '../program-input'
import type { DerivedSet } from '../progression'

const DAY_MS = 24 * 60 * 60 * 1000
const BASE_MS = Date.UTC(2026, 7, 1)

/** Newest-first sequence stamping, mirroring the main suite's helper. */
const seq = (...sessions: AutoregSession[]): AutoregSession[] =>
  sessions.map((s, i) => ({ ...s, startedAtMs: BASE_MS - i * DAY_MS }))

const derivedSet = (overrides: Partial<DerivedSet> = {}): DerivedSet => ({
  setNumber: 1,
  setType: 'working',
  metricMode: 'reps_weight',
  repMin: 8,
  repMax: null,
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

// ─────────────────────────────────────────────────────────────────────────────
// #226 — load quantization
// ─────────────────────────────────────────────────────────────────────────────

describe('#226 quantization: idempotence under derive→display double application', () => {
  const sweep: number[] = []
  for (let kg = 0.01; kg < 320; kg += 0.7301) sweep.push(Math.round(kg * 100) / 100)

  it.each(['kg', 'lb'] as const)(
    'quantizeLoadKg is idempotent on the %s grid (derive-then-derive never drifts)',
    (unit) => {
      for (const kg of sweep) {
        const once = quantizeLoadKg(kg, unit)
        expect(quantizeLoadKg(once, unit)).toBe(once)
      }
    },
  )

  it.each(['kg', 'lb'] as const)(
    'quantizeDisplayLoad of any positive load lands EXACTLY on the %s increment grid',
    (unit) => {
      const inc = unit === 'kg' ? LOAD_INCREMENT_KG : LOAD_INCREMENT_LB
      for (const kg of sweep) {
        const display = quantizeDisplayLoad(kg, unit)
        expect(Math.round(display / inc) * inc).toBeCloseTo(display, 9)
      }
    },
  )

  it('display of an already-quantized kg value equals the quantized display (no double-rounding skew)', () => {
    for (const kg of sweep) {
      for (const unit of ['kg', 'lb'] as const) {
        const derived = quantizeLoadKg(kg, unit) // round-at-derivation
        expect(quantizeDisplayLoad(derived, unit)).toBe(quantizeDisplayLoad(kg, unit))
        expect(kgToDisplay(derived, unit)).toBe(quantizeDisplayLoad(kg, unit))
      }
    }
  })
})

describe('#226 quantization: one-increment minimum vs zero/negative', () => {
  it('a strictly-positive load never quantizes to 0 (minimum one increment)', () => {
    expect(quantizeLoadKg(0.01, 'kg')).toBe(LOAD_INCREMENT_KG)
    expect(quantizeLoadKg(0.01, 'lb')).toBe(displayToKg(LOAD_INCREMENT_LB, 'lb'))
    expect(quantizeLoadKg(0.5, 'kg')).toBe(LOAD_INCREMENT_KG)
  })

  it('zero, negative, and non-finite input clamp to 0 (never a phantom increment)', () => {
    for (const unit of ['kg', 'lb'] as const) {
      expect(quantizeLoadKg(0, unit)).toBe(0)
      expect(quantizeLoadKg(-5, unit)).toBe(0)
      expect(quantizeLoadKg(Number.NaN, unit)).toBe(0)
      expect(quantizeLoadKg(Number.POSITIVE_INFINITY, unit)).toBe(0)
    }
  })
})

describe('#226 quantizeAdjustedLoadKg: decrement-chain monotonicity', () => {
  /** One engine-shaped decrement: ~10% off, quantized against the baseline. */
  const decrementOnce = (baselineKg: number, unit: WeightUnit): number =>
    quantizeAdjustedLoadKg(baselineKg * 0.9, baselineKg, unit)

  it.each(['kg', 'lb'] as const)(
    'a %s decrement chain strictly decreases until the one-increment floor, then holds (never 0/negative)',
    (unit) => {
      const floor = unit === 'kg' ? LOAD_INCREMENT_KG : displayToKg(LOAD_INCREMENT_LB, 'lb')
      let load = quantizeLoadKg(100, unit)
      for (let i = 0; i < 200; i++) {
        const next = decrementOnce(load, unit)
        expect(next).toBeGreaterThan(0)
        if (load > floor) {
          expect(next).toBeLessThan(load)
        } else {
          expect(next).toBe(floor) // at the floor the chain must hold, not invert
        }
        load = next
      }
      expect(load).toBe(floor)
    },
  )

  it('pathological 0.5 kg start: the chain clamps to one increment and never vanishes', () => {
    let load = quantizeLoadKg(0.5, 'kg') // 1.25
    for (let i = 0; i < 10; i++) {
      load = decrementOnce(load, 'kg')
      expect(load).toBe(LOAD_INCREMENT_KG)
    }
  })

  it('unit switches mid-chain never INCREASE the load beyond half an increment of re-gridding', () => {
    // Alternating kg/lb grids re-snap each step; a decrement chain must still
    // trend down — a switch may re-grid (±half increment) but never undo a cut.
    let load = quantizeLoadKg(100, 'kg')
    const units: WeightUnit[] = ['kg', 'lb']
    for (let i = 0; i < 60; i++) {
      const unit = units[i % 2]
      const next = decrementOnce(quantizeLoadKg(load, unit), unit)
      expect(next).toBeLessThanOrEqual(load + LOAD_INCREMENT_KG / 2 + 1e-9)
      if (load > 2 * LOAD_INCREMENT_KG) expect(next).toBeLessThan(load)
      load = next
    }
    expect(load).toBeLessThanOrEqual(displayToKg(LOAD_INCREMENT_LB, 'lb') + LOAD_INCREMENT_KG)
  })
})

describe('#226 loadsMatch: the legacy-snapshot bridge', () => {
  it('bridges a pre-quantization snapshot (37.2 lb ≈ 16.87 kg) onto its quantized re-derivation (17.01 kg)', () => {
    expect(loadsMatch(16.87, 17.01, 0.05, 'lb')).toBe(true)
  })

  it('an applied one-increment decrement NEVER falsely matches its baseline (stall streak must reset)', () => {
    for (const unit of ['kg', 'lb'] as const) {
      const floor = unit === 'kg' ? LOAD_INCREMENT_KG : displayToKg(LOAD_INCREMENT_LB, 'lb')
      let baseline = quantizeLoadKg(100, unit)
      while (baseline > floor) {
        const next = quantizeAdjustedLoadKg(baseline * 0.9, baseline, unit)
        expect(loadsMatch(next, baseline, 0.05, unit)).toBe(false)
        baseline = next
      }
    }
  })

  it('DOCUMENTED RISK PROBE: two prescriptions a full 1 kg apart match when they share an lb display increment', () => {
    // 16.5 kg and 17.5 kg both display as 37.5 lb — the bridge identifies
    // them. |Δ| = 1 kg ≫ ε = 0.05. Post-#226, derived prescriptions are
    // grid-snapped so such pairs shouldn't arise from the engine itself —
    // but ANY code path comparing un-quantized values through loadsMatch
    // (legacy snapshots vs manual edits) inherits this false-positive width.
    expect(loadsMatch(16.5, 17.5, 0.05, 'lb')).toBe(true)
  })

  it('quantizeSetLoads never mutates its input (stored facts stay exact)', () => {
    const set = derivedSet({ loadKg: 16.87, schemeLoadKg: 16.87 })
    const frozen = JSON.stringify(set)
    const out = quantizeSetLoads(set, 'lb')
    expect(JSON.stringify(set)).toBe(frozen)
    expect(out).not.toBe(set)
    expect(out.loadKg).toBe(17.01)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #227 — overshoot policy
// ─────────────────────────────────────────────────────────────────────────────

/** One-working-set session: prescribed repMin×loadKg, performed reps×weightKg. */
const singleSetSession = (
  repMin: number,
  loadKg: number,
  reps: number,
  weightKg: number,
): AutoregSession => ({
  startedAtMs: 0,
  prescribed: [{ setNumber: 1, repMin, loadKg }],
  actual: [{ setNumber: 1, reps, weightKg, completed: true }],
})

describe('#227 Epley credit floor (e1rm-equivalent): credited reps can never imply a HIGHER e1RM than performed', () => {
  it('sweep: estimate1RM(creditedReps, prescribedLoad) ≤ estimate1RM(performedReps, performedWeight)', () => {
    const rows: AutoregRangeRow[] = [{ loadKg: 100, repMax: 30 }]
    let checked = 0
    for (let repMin = 1; repMin <= 12; repMin++) {
      for (const weight of [70, 80, 85, 90, 95, 98, 99.9]) {
        for (let reps = 1; reps <= 30; reps++) {
          const performed = estimate1RM(reps, weight)!
          const target = estimate1RM(repMin, 100)!
          if (performed < target) continue // engine grants no credit — out of scope
          const verdict = autoregulateRange(
            2.5,
            seq(singleSetSession(repMin, 100, reps, weight)),
            rows,
            undefined,
            'e1rm-equivalent',
          )
          if (!verdict?.range) continue // nothing credited/scorable
          const credited = verdict.range.totalReps
          const implied = estimate1RM(credited, 100)
          if (implied === null) continue
          expect(implied).toBeLessThanOrEqual(performed + 1e-9)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(100) // the sweep genuinely exercised credits
  })

  it("'any-metric' rep-credit path: a lighter 15-rep set is credited at an e1RM the lifter never demonstrated", () => {
    // Spec ('any-metric'): "reps ≥ target reps (any load)" counts. The credit
    // rewrites the set to its raw reps AT THE PRESCRIBED LOAD — here 15 reps
    // credited at 100 kg (implied e1RM 150) from a performance of 15 × 80 kg
    // (e1RM 120, BELOW the 140 target). Permissive by the policy's own
    // definition — this probe documents the magnitude of the over-credit
    // that downstream rules (range totals) then score as at-load evidence.
    const rows: AutoregRangeRow[] = [{ loadKg: 100, repMax: 30 }]
    const verdict = autoregulateRange(
      2.5,
      seq(singleSetSession(12, 100, 15, 80)),
      rows,
      undefined,
      'any-metric',
    )
    expect(verdict?.range?.totalReps).toBe(15)
    const implied = estimate1RM(15, 100)! // 150
    const performed = estimate1RM(15, 80)! // 120
    expect(implied).toBeGreaterThan(performed) // over-credit is real, and per-spec
  })
})

describe('#227 policy resolution precedence with garbage column text', () => {
  it('degrades garbage at each layer to the next (silence over corruption)', () => {
    expect(resolveOvershootPolicy('banana', '🤖', 'linear')).toBe('strict-load')
    expect(resolveOvershootPolicy('banana', null, 'rpe-target')).toBe('e1rm-equivalent')
    expect(resolveOvershootPolicy('e1rm-equivalent', 'garbage', 'linear')).toBe('e1rm-equivalent')
    expect(resolveOvershootPolicy(42, {}, null)).toBe('strict-load')
    expect(resolveOvershootPolicy('', '', 'double-progression')).toBe('strict-load')
    expect(resolveOvershootPolicy('Strict-Load', 'STRICT-LOAD', 'linear')).toBe('strict-load') // case-sensitive union
    expect(resolveOvershootPolicy(null, undefined, 'weekly-volume')).toBe('strict-load')
  })

  it('a valid exercise override beats a valid program policy', () => {
    expect(resolveOvershootPolicy('any-metric', 'strict-load', 'rpe-target')).toBe('strict-load')
  })

  it('per-scheme defaults match the researched split', () => {
    for (const scheme of [
      'linear',
      'double-progression',
      'rep-progression',
      'percent-1rm',
      'amrap-cycle',
      'weekly-volume',
    ] as const) {
      expect(defaultOvershootPolicy(scheme)).toBe('strict-load')
    }
    expect(defaultOvershootPolicy('rpe-target')).toBe('e1rm-equivalent')
    expect(defaultOvershootPolicy(null)).toBe('strict-load')
  })
})

describe('#227 strict-load is byte-identical to the pre-policy engine', () => {
  const overshootSession = (): AutoregSession => ({
    startedAtMs: 0,
    prescribed: [
      { setNumber: 1, repMin: 12, loadKg: 16.87 },
      { setNumber: 2, repMin: 12, loadKg: 16.87 },
    ],
    actual: [
      { setNumber: 1, reps: 15, weightKg: 15.88, completed: true },
      { setNumber: 2, reps: 15, weightKg: 15.88, completed: true },
    ],
  })
  const stallSession = (): AutoregSession => ({
    startedAtMs: 0,
    prescribed: [
      { setNumber: 1, repMin: 8, loadKg: 100 },
      { setNumber: 2, repMin: 8, loadKg: 100 },
    ],
    actual: [
      { setNumber: 1, reps: 8, weightKg: 100, completed: true },
      { setNumber: 2, reps: 6, weightKg: 100, completed: true },
    ],
  })

  it('range mode: explicit strict-load verdict deep-equals the default-call verdict', () => {
    const rows: AutoregRangeRow[] = [
      { loadKg: 16.87, repMax: 15 },
      { loadKg: 16.87, repMax: 15 },
    ]
    const a = autoregulateRange(2.5, seq(overshootSession()), rows)
    const b = autoregulateRange(2.5, seq(overshootSession()), rows, undefined, 'strict-load')
    expect(b).toEqual(a)
  })

  it('fixed mode: explicit strict-load verdict deep-equals the default-call verdict (stall fixture)', () => {
    const a = autoregulate(2.5, seq(stallSession(), stallSession()), 'all-sets')
    const b = autoregulate(2.5, seq(stallSession(), stallSession()), 'all-sets', undefined, 'strict-load')
    expect(b).toEqual(a)
  })
})

describe("#227 'never auto-accelerates' under any-metric with absurd overshoot (50 reps)", () => {
  const rows: AutoregRangeRow[] = [
    { loadKg: 100, repMax: 12 },
    { loadKg: 100, repMax: 12 },
  ]
  const absurd = (): AutoregSession => ({
    startedAtMs: 0,
    prescribed: [
      { setNumber: 1, repMin: 8, loadKg: 100 },
      { setNumber: 2, repMin: 8, loadKg: 100 },
    ],
    actual: [
      { setNumber: 1, reps: 50, weightKg: 100, completed: true },
      { setNumber: 2, reps: 50, weightKg: 100, completed: true },
    ],
  })
  const exactFill = (): AutoregSession => ({
    ...absurd(),
    actual: absurd().actual.map((s) => ({ ...s, reps: 12 })),
  })

  it('a 50-rep at-load blowout earns exactly ONE step — the same delta as an exact fill', () => {
    const blowout = autoregulateRange(2.5, seq(absurd()), rows, undefined, 'any-metric')
    const fill = autoregulateRange(2.5, seq(exactFill()), rows, undefined, 'any-metric')
    expect(blowout?.action).toBe('step')
    expect(blowout?.deltaKg).toBe(2.5)
    expect(blowout?.deltaKg).toBe(fill?.deltaKg)
    expect(blowout?.anchor).toBeUndefined() // no follow-the-lifter-up composition
  })

  it('a LIGHTER 50-rep credited set cannot propose an up-anchor or extra step', () => {
    const lighter: AutoregSession = {
      ...absurd(),
      actual: absurd().actual.map((s) => ({ ...s, weightKg: 90 })),
    }
    const verdict = autoregulateRange(2.5, seq(lighter), rows, undefined, 'any-metric')
    expect(verdict?.action).toBe('step')
    expect(verdict?.deltaKg).toBe(2.5)
    expect(verdict?.anchor).toBeUndefined()
    expect(verdict?.anchorLoads).toBeUndefined()
  })

  it('fixed mode: an at-load 50-rep session produces NO verdict (scheme owns the progression)', () => {
    const fixed = autoregulate(2.5, seq(absurd()), 'all-sets', undefined, 'any-metric')
    expect(fixed).toBeNull()
  })
})

describe('#227 "Beat the target" coexisting with a decrement verdict', () => {
  /** 3 prescribed sets at 100; sets 1–2 flat at load (stall fodder), set 3
   *  performed LIGHTER — in the latest session it beats the target e1RM. */
  const stallWithSet3 = (set3: { reps: number; weightKg: number }): AutoregSession => ({
    startedAtMs: 0,
    prescribed: [
      { setNumber: 1, repMin: 8, loadKg: 100 },
      { setNumber: 2, repMin: 8, loadKg: 100 },
      { setNumber: 3, repMin: 8, loadKg: 100 },
    ],
    actual: [
      { setNumber: 1, reps: 8, weightKg: 100, completed: true },
      { setNumber: 2, reps: 8, weightKg: 100, completed: true },
      { setNumber: 3, ...set3, completed: true },
    ],
  })
  const rows: AutoregRangeRow[] = [
    { loadKg: 100, repMax: 12 },
    { loadKg: 100, repMax: 12 },
    { loadKg: 100, repMax: 12 },
  ]

  it('SPEC: "overshoot still renders as recognition …, never as goal-not-met" — even when the verdict is a decrement', () => {
    // 4 sessions, flat at-load totals → 3 stalls → decrement. The LATEST
    // session's set 3 (15 × 90 kg, e1RM 135) beats its snapshot target e1RM
    // (8 × 100 → 126.7). Direction doc: "Even under strict policy, overshoot
    // renders as recognition (rep PR / e1RM up), never as 'goal not met'".
    // The engine attaches recognition to HOLDS only — what does a decrement
    // render?
    const latest = stallWithSet3({ reps: 15, weightKg: 90 })
    const older = () => stallWithSet3({ reps: 8, weightKg: 90 })
    const sessions = seq(latest, older(), older(), older())

    expect(sessionOvershoot(sessions[0])).not.toBeNull() // the session DID overshoot

    const verdict = autoregulateRange(2.5, sessions, rows)
    expect(verdict?.action).toBe('decrement')

    const reason = autoregReason(verdict!, 'kg')
    // The spec bars a pure-failure rendering over an e1RM-beating session:
    // either the verdict carries the overshoot annotation or the reason
    // leads with the beat.
    const carriesRecognition = verdict?.overshoot !== undefined || /Beat the target/.test(reason)
    expect(carriesRecognition, `rendered: "${reason}"`).toBe(true)
  })

  it('control: the same overshoot on a REPEAT verdict does render recognition', () => {
    const latest = stallWithSet3({ reps: 15, weightKg: 90 })
    const verdict = autoregulateRange(2.5, seq(latest), rows)
    expect(verdict?.action).toBe('repeat')
    expect(autoregReason(verdict!, 'kg')).toMatch(/^Beat the target/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #228 — reasons / scheme copy / appliedLoadKg
// ─────────────────────────────────────────────────────────────────────────────

describe('#228 appliedLoadKg stamping: multi-load decrement', () => {
  /** Top set 100 kg (floor MET every time) + back-off set 80 kg (floor missed
   *  every time): the stall evidence names 80, the H2 streak rides the
   *  unchanged 100 top, and the decrement scales BOTH buckets. */
  const multiLoadStall = (): AutoregSession => ({
    startedAtMs: 0,
    prescribed: [
      { setNumber: 1, repMin: 5, loadKg: 100 },
      { setNumber: 2, repMin: 10, loadKg: 80 },
    ],
    actual: [
      { setNumber: 1, reps: 5, weightKg: 100, completed: true },
      { setNumber: 2, reps: 8, weightKg: 80, completed: true },
    ],
  })

  it('SPEC: a reason "states what to do and why" — "Drop to X — stalled at L" must not name an X ABOVE L', () => {
    const sessions = seq(multiLoadStall(), multiLoadStall(), multiLoadStall())
    const verdict = autoregulate(2.5, sessions, 'all-sets', 'kg')
    expect(verdict?.action).toBe('decrement')
    expect(verdict?.evidence.loadKg).toBe(80) // heaviest MISSED set

    // Reproduce the derive layer exactly (db/programs.ts quantizeAdjustedSet
    // + the stampAppliedLoad call): apply → per-set anti-fixed-point
    // quantization → stamp the EVIDENCE bucket's adjusted landing load.
    const scheme = [
      derivedSet({ setNumber: 1, repMin: 5, loadKg: 100 }),
      derivedSet({ setNumber: 2, repMin: 10, loadKg: 80, sourceIndex: 1 }),
    ]
    const adjusted = applyAutoregToSets(scheme, verdict!, 'kg').map((s) =>
      s.derivedFrom === 'autoreg' && s.loadKg != null && s.schemeLoadKg != null
        ? { ...s, loadKg: quantizeAdjustedLoadKg(s.loadKg, s.schemeLoadKg, 'kg') }
        : quantizeSetLoads(s, 'kg'),
    )
    const stamped = stampAppliedLoad(verdict!, adjusted, 'kg')

    const reason = autoregReason(stamped, 'kg')
    const match = /^Drop to ([\d.]+) kg — stalled at ([\d.]+) kg/.exec(reason)
    expect(match, `rendered: "${reason}"`).not.toBeNull()
    const dropTo = Number(match![1])
    const stalledAt = Number(match![2])
    // "Drop to 91.25 kg — stalled at 80 kg" is not a drop.
    expect(dropTo, `rendered: "${reason}"`).toBeLessThan(stalledAt)
  })
})

describe('#228 reasons: the one-increment floor vs "Drop to"', () => {
  it('SPEC: imperative what-to-do — a decrement pinned at the floor must not claim a drop to the SAME load', () => {
    // Stall a 1.25 kg prescription three times: backoffKg caps at 25%
    // (0.3125 kg), the anti-fixed-point quantizer floors at one increment —
    // the applied load stays 1.25. The reason then reads
    // "Drop to 1.25 kg — stalled at 1.25 kg …" — an instruction to change
    // nothing, phrased as a change.
    const floorStall = (): AutoregSession => ({
      startedAtMs: 0,
      prescribed: [
        { setNumber: 1, repMin: 8, loadKg: 1.25 },
        { setNumber: 2, repMin: 8, loadKg: 1.25 },
      ],
      actual: [
        { setNumber: 1, reps: 5, weightKg: 1.25, completed: true },
        { setNumber: 2, reps: 5, weightKg: 1.25, completed: true },
      ],
    })
    const verdict = autoregulate(
      1.25,
      seq(floorStall(), floorStall(), floorStall()),
      'all-sets',
      'kg',
    )
    expect(verdict?.action).toBe('decrement')

    // Fixed behavior: the floor made the cut a no-op, so the reason speaks
    // HOLD voice ("Stay at …, already at the smallest load") — never
    // "Drop to X — stalled at X", a change-voiced instruction to change
    // nothing.
    const reason = autoregReason(verdict!, 'kg')
    expect(reason, `rendered: "${reason}"`).toMatch(/^Stay at 1\.25 kg — stalled/)
    expect(reason).toContain('already at the smallest load')
    expect(reason).not.toMatch(/^Drop to/)
  })
})

describe('#228 missing-data degradation: schemeSentence falls back to subtitles, never "undefined"', () => {
  const cases: [string, Progression][] = [
    ['linear, zero increment', { scheme: 'linear', incrementKg: 0 } as Progression],
    [
      'double-progression, zero repMax',
      { scheme: 'double-progression', repMin: 8, repMax: 0, incrementKg: 2.5 } as Progression,
    ],
    [
      'percent-1rm, zero TM',
      { scheme: 'percent-1rm', trainingMaxKg: 0, weekPercents: [0.7] } as Progression,
    ],
    [
      'percent-1rm, all-zero percents',
      { scheme: 'percent-1rm', trainingMaxKg: 100, weekPercents: [0] } as Progression,
    ],
    ['rpe-target, zero RPE', { scheme: 'rpe-target', targetRpe: 0 } as Progression],
    ['weekly-volume, mrv < mev', { scheme: 'weekly-volume', mevSets: 12, mrvSets: 8 } as Progression],
    [
      'rep-progression, no increments',
      { scheme: 'rep-progression', incrementReps: 0, incrementSec: 0 } as Progression,
    ],
    [
      'amrap-cycle, zero increment',
      { scheme: 'amrap-cycle', trainingMaxKg: 100, incrementKg: 0 } as Progression,
    ],
    [
      'linear, NaN increment (corrupt column)',
      { scheme: 'linear', incrementKg: Number.NaN } as Progression,
    ],
  ]

  it.each(cases)('%s → the scheme subtitle descriptor, argument-free', (_name, progression) => {
    const message = schemeSentence(progression, { unit: 'lb' })
    expect(message).toEqual(schemeSubtitle(progression.scheme))
    // The subtitle takes NO arguments, so there is nowhere for an undefined,
    // a NaN or a null to ride into the rendered sentence.
    expect(message.values).toBeUndefined()
  })

  it('repFillHoldReason with unknown top (0) stays imperative without inventing a count', () => {
    const line = repFillHoldReason('65 lb', 0)
    expect(line).toBe('Stay at 65 lb — add reps on every set, then the weight goes up')
    expect(repFillHoldReason('65 lb', 12)).toContain('hit 12 reps')
  })
})

describe("#228 unit fidelity: \"the exercise's ACTUAL numbers\" in a lb account", () => {
  it('SPEC: a kg-configured micro-increment (0.5 kg ≈ 1.1 lb) must not be printed as a different number', () => {
    // scheme-copy quantizes the INCREMENT itself through the load quantizer,
    // whose one-increment floor turns +0.5 kg into "+2.5 lb" — 2.27× the
    // configured step. The direction doc's bar is "conditional sentences with
    // the lifter's ACTUAL numbers".
    const message = schemeSentence(
      { scheme: 'linear', incrementKg: 0.5 } as Progression,
      { unit: 'lb' },
    )
    const configuredLb = kgToDisplay(0.5, 'lb') // 1.1 lb
    expect(message, `configured +${configuredLb} lb`).toEqual({
      key: 'sentence.linear',
      values: { increment: configuredLb, unit: 'lb' },
    })
  })

  it('reason strings in a lb account always print on-grid lb (never 66.6 lb)', () => {
    const verdict = {
      action: 'repeat' as const,
      deltaKg: 0,
      suggestEarlyDeload: false,
      stalledLoads: [16.87],
      evidence: { missedSets: 1, scorableSets: 2, repFloor: 12, loadKg: 16.87 },
    }
    const reason = autoregReason(verdict, 'lb')
    expect(reason).toContain('37.5 lb')
    expect(reason).not.toContain('37.2')
    const loads = [...reason.matchAll(/([\d.]+) lb/g)].map((m) => Number(m[1]))
    for (const lb of loads) {
      expect(Math.round(lb / LOAD_INCREMENT_LB) * LOAD_INCREMENT_LB).toBeCloseTo(lb, 9)
    }
  })

  it('a kg program rendered for an lb viewer prints on-grid lb in every reason clause', () => {
    const stall = (): AutoregSession => ({
      startedAtMs: 0,
      prescribed: [
        { setNumber: 1, repMin: 8, loadKg: 100 },
        { setNumber: 2, repMin: 8, loadKg: 100 },
      ],
      actual: [
        { setNumber: 1, reps: 6, weightKg: 100, completed: true },
        { setNumber: 2, reps: 6, weightKg: 100, completed: true },
      ],
    })
    const verdict = autoregulate(2.5, seq(stall(), stall(), stall()), 'all-sets', 'lb')
    expect(verdict?.action).toBe('decrement')
    const reason = autoregReason(verdict!, 'lb')
    const loads = [...reason.matchAll(/([\d.]+) lb/g)].map((m) => Number(m[1]))
    expect(loads.length).toBeGreaterThanOrEqual(2)
    for (const lb of loads) {
      expect(Math.round(lb / LOAD_INCREMENT_LB) * LOAD_INCREMENT_LB).toBeCloseTo(lb, 9)
    }
  })
})
