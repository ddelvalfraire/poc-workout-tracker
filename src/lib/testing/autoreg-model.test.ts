import { describe, expect } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import {
  autoregulate,
  AUTOREG_SESSION_WINDOW,
  type AutoregAdjustment,
  type AutoregSession,
  type AutoregStallPolicy,
} from '@/lib/autoregulate'
import { reasonNonEmptyOnAdjustment } from './invariants'
import { evidenceLoadArb, evidenceSession, sessionClassArb, type SessionClass } from './arbitraries'

/**
 * Layer 2 model-based suite (progression-test-harness.prd.md): fc.commands
 * over the FIXED-mode window. Commands append one evidence-class session
 * (cleanPass / stallAtLoad / outperform / lighterWork / deviatedDay; a load
 * change is a command at a different generated load) to the real history; the
 * MODEL tracks only what the docblocks promise — the H2 load-scoped stall
 * streak, the M2 outperform confirmation, the H1 comparable-lighter streak —
 * and after every command the engine's verdict class must match the model's.
 *
 * The model deliberately re-implements NOTHING numeric: it predicts verdict
 * CLASSES (none / repeat / decrement / anchor-up / anchor-down), the exact
 * multi-session interaction surface the 2026-08-08 adversarial review showed
 * example tests miss.
 */
const DEEP = process.env.HARNESS_DEEP === '1'
fc.configureGlobal({ seed: 20260809, numRuns: DEEP ? 2000 : 250 })

const INCREMENT_KG = 2.5
const DAY_MS = 86_400_000

type VerdictClass = 'none' | 'repeat' | 'decrement' | 'anchor-up' | 'anchor-down'

interface AutoregModel {
  /** H2: consecutive stalls AT the same prescribed top load. */
  stallStreak: number
  stallTop: number | null
  /** M2: did the previous session outperform (quorum met)? */
  prevOutperform: boolean
  /** H1: consecutive all-lighter sessions at the same prescribed load. */
  lighterStreak: number
  lighterLoad: number | null
}

interface AutoregReal {
  sessions: AutoregSession[]
  clock: number
  /** The walk's stall policy. The evidence classes are POLICY-UNIFORM by
   *  construction — 'stallAtLoad' misses EVERY floor (so the governing set
   *  misses too) and every other class hits every floor — so one model
   *  predicts both policies and the walk runs under each (C1). */
  policy: AutoregStallPolicy
}

const freshModel = (): AutoregModel => ({
  stallStreak: 0,
  stallTop: null,
  prevOutperform: false,
  lighterStreak: 0,
  lighterLoad: null,
})

function classOf(adjustment: AutoregAdjustment | null): VerdictClass {
  if (adjustment === null) return 'none'
  if (adjustment.action === 'repeat') return 'repeat'
  if (adjustment.action === 'decrement') return 'decrement'
  if (adjustment.action === 'anchor' && adjustment.anchor) {
    const { fromLoadKg, toLoadKg } = adjustment.anchor
    if (fromLoadKg !== null && toLoadKg > fromLoadKg) return 'anchor-up'
    if (fromLoadKg !== null && toLoadKg < fromLoadKg) return 'anchor-down'
  }
  // No other classes are reachable from these evidence classes (all sessions
  // carry loaded snapshots, so the null-bucket anchor never fires).
  return 'none'
}

/** The model's prediction AFTER appending a session of `cls` at `loadKg`,
 *  mutating the model — the docblock laws, verbatim:
 *  - stall ×1..2 → repeat; ×3 at the SAME top load → decrement (H2/C1);
 *  - outperform confirmed by the previous session → anchor-up (M2);
 *  - three comparable all-lighter sessions → anchor-down (H1);
 *  - anything else → no verdict (M3 silence / nothing to say). */
function advanceModel(model: AutoregModel, cls: SessionClass, loadKg: number): VerdictClass {
  switch (cls) {
    case 'stallAtLoad': {
      model.stallStreak = model.stallTop === loadKg ? model.stallStreak + 1 : 1
      model.stallTop = loadKg
      model.prevOutperform = false
      model.lighterStreak = 0
      model.lighterLoad = null
      return model.stallStreak >= AUTOREG_SESSION_WINDOW ? 'decrement' : 'repeat'
    }
    case 'outperform': {
      const confirmed = model.prevOutperform
      model.stallStreak = 0
      model.stallTop = null
      model.prevOutperform = true
      model.lighterStreak = 0
      model.lighterLoad = null
      return confirmed ? 'anchor-up' : 'none'
    }
    case 'lighterWork': {
      model.lighterStreak = model.lighterLoad === loadKg ? model.lighterStreak + 1 : 1
      model.lighterLoad = loadKg
      model.stallStreak = 0
      model.stallTop = null
      model.prevOutperform = false
      return model.lighterStreak >= AUTOREG_SESSION_WINDOW ? 'anchor-down' : 'none'
    }
    case 'cleanPass':
    case 'deviatedDay': {
      model.stallStreak = 0
      model.stallTop = null
      model.prevOutperform = false
      model.lighterStreak = 0
      model.lighterLoad = null
      return 'none'
    }
  }
}

/** One command: append an evidence-class session, then check the engine's
 *  verdict class against the model's prediction. */
class AppendSessionCommand implements fc.Command<AutoregModel, AutoregReal> {
  constructor(
    readonly cls: SessionClass,
    readonly loadKg: number,
    readonly withWarmup: boolean,
  ) {}

  check(): boolean {
    return true // every evidence class is appendable in any state
  }

  run(model: AutoregModel, real: AutoregReal): void {
    real.clock += DAY_MS
    real.sessions.push(
      evidenceSession({
        cls: this.cls,
        loadKg: this.loadKg,
        withWarmup: this.withWarmup,
        startedAtMs: real.clock,
      }),
    )
    const expected = advanceModel(model, this.cls, this.loadKg)
    const adjustment = autoregulate(INCREMENT_KG, real.sessions, real.policy)
    expect(classOf(adjustment)).toBe(expected)
    // Transparency rides along: any verdict the walk produces must render.
    expect(reasonNonEmptyOnAdjustment(adjustment)).toBe(true)
  }

  toString(): string {
    return `${this.cls}@${this.loadKg}${this.withWarmup ? '+warmup' : ''}`
  }
}

const commandArb = fc
  .tuple(sessionClassArb, evidenceLoadArb, fc.boolean())
  .map(([cls, loadKg, withWarmup]) => new AppendSessionCommand(cls, loadKg, withWarmup))

describe.each<AutoregStallPolicy>(['all-sets', 'first-set'])(
  'autoregulate model-based walk (FIXED mode, %s)',
  (policy) => {
    test.prop([fc.commands([commandArb], { maxCommands: 20 })])(
      'engine verdict class matches the docblock model after every append',
      (commands) => {
        fc.modelRun(
          () => ({ model: freshModel(), real: { sessions: [], clock: 0, policy } }),
          commands,
        )
      },
    )
  },
)
