import { describe, it, expect } from 'vitest'
import {
  applyEffortToAdjustment,
  sustainedUndershoot,
  EFFORT_GATE_MIN_SESSIONS,
} from './effort-gate'
import type { AutoregAdjustment, AutoregSession } from '../programs/autoregulate'

/**
 * The effort gate (RPE plan slice 3): overshoot-hold + trend veto ONLY.
 * Sessions are built newest-first here, but the gate must sort defensively
 * (H6). Effort is expressed as RIR (chips' primary scale); RPE fixtures
 * exercise the conversion.
 */

/** One session: a single top working pair at `loadKg`, floor met by default. */
function session(over: {
  startedAtMs: number
  loadKg?: number
  reps?: number
  repMin?: number | null
  rir?: number | null
  rpe?: number | null
  prescribedRir?: number | null
  prescribedRpe?: number | null
}): AutoregSession {
  const loadKg = over.loadKg ?? 100
  return {
    startedAtMs: over.startedAtMs,
    prescribed: [
      {
        setNumber: 1,
        repMin: over.repMin === undefined ? 5 : over.repMin,
        loadKg,
        setType: 'working',
        rir: over.prescribedRir ?? null,
        rpe: over.prescribedRpe ?? null,
      },
    ],
    actual: [
      {
        setNumber: 1,
        reps: over.reps ?? 5,
        weightKg: loadKg,
        completed: true,
        setType: 'working',
        rir: over.rir === undefined ? null : over.rir,
        rpe: over.rpe === undefined ? null : over.rpe,
      },
    ],
  }
}

/** Three sessions with logged effort (activation floor met), newest first. */
function effortSessions(newestRir: number, olderRir = 2): AutoregSession[] {
  return [
    session({ startedAtMs: 3, rir: newestRir, prescribedRir: 2 }),
    session({ startedAtMs: 2, rir: olderRir, prescribedRir: 2 }),
    session({ startedAtMs: 1, rir: olderRir, prescribedRir: 2 }),
  ]
}

const h2Decrement: AutoregAdjustment = {
  action: 'decrement',
  deltaKg: -10,
  suggestEarlyDeload: true,
  stalledLoads: [100],
  evidence: { missedSets: 2, scorableSets: 3, repFloor: 5, loadKg: 100 },
}

describe('applyEffortToAdjustment — passthrough discipline', () => {
  it('returns the input BY REFERENCE with no effort logs (byte-identity for non-RPE users)', () => {
    const sessions = [
      session({ startedAtMs: 3 }),
      session({ startedAtMs: 2 }),
      session({ startedAtMs: 1 }),
    ]
    expect(applyEffortToAdjustment(h2Decrement, sessions, 'fixed')).toBe(h2Decrement)
    expect(applyEffortToAdjustment(null, sessions, 'fixed')).toBeNull()
  })

  it('stays silent below the activation floor (fewer than EFFORT_GATE_MIN_SESSIONS logged sessions)', () => {
    const sessions = [
      session({ startedAtMs: 3, rir: 0, prescribedRir: 2 }),
      session({ startedAtMs: 2, rir: 0, prescribedRir: 2 }),
      // Third session has no effort log — floor not met.
      session({ startedAtMs: 1 }),
    ]
    expect(EFFORT_GATE_MIN_SESSIONS).toBe(3)
    expect(applyEffortToAdjustment(null, sessions, 'fixed')).toBeNull()
  })

  it('never touches a cutting hold (diet gate runs first and wins)', () => {
    const held: AutoregAdjustment = {
      ...h2Decrement,
      action: 'repeat',
      deltaKg: 0,
      phaseContext: 'cutting',
      heldBackoffKg: 10,
    }
    expect(applyEffortToAdjustment(held, effortSessions(0), 'fixed')).toBe(held)
  })

  it('anchor and deload-flag modes pass through untouched (their schemes self-correct)', () => {
    expect(applyEffortToAdjustment(null, effortSessions(0), 'anchor')).toBeNull()
    const flag: AutoregAdjustment = {
      ...h2Decrement,
      action: 'flag',
      deltaKg: 0,
    }
    expect(applyEffortToAdjustment(flag, effortSessions(0), 'deload-flag')).toBe(flag)
  })
})

describe('overshoot-hold (fixed mode: synthesized repeat from a would-be scheme increment)', () => {
  it('holds when the newest top set ran a full RPE point hot (RIR 0 vs prescribed 2)', () => {
    const result = applyEffortToAdjustment(null, effortSessions(0), 'fixed')
    expect(result).not.toBeNull()
    expect(result).toMatchObject({
      action: 'repeat',
      deltaKg: 0,
      effortContext: 'overshoot',
      stalledLoads: [100],
    })
    expect(result!.evidence.loadKg).toBe(100)
  })

  it('half-point-hot sessions are inside reporting noise — no hold (threshold is a FULL point)', () => {
    // Prescribed RPE 8, logged RPE 8.5 → +0.5, below the +1 threshold.
    const sessions = [
      session({ startedAtMs: 3, rpe: 8.5, prescribedRpe: 8 }),
      session({ startedAtMs: 2, rpe: 8, prescribedRpe: 8 }),
      session({ startedAtMs: 1, rpe: 8, prescribedRpe: 8 }),
    ]
    expect(applyEffortToAdjustment(null, sessions, 'fixed')).toBeNull()
  })

  it('RPE and RIR scales interconvert (logged RPE 9.5 vs prescribed RIR 2 = +1.5 hot)', () => {
    const sessions = [
      session({ startedAtMs: 3, rpe: 9.5, prescribedRir: 2 }),
      session({ startedAtMs: 2, rir: 2, prescribedRir: 2 }),
      session({ startedAtMs: 1, rir: 2, prescribedRir: 2 }),
    ]
    const result = applyEffortToAdjustment(null, sessions, 'fixed')
    expect(result?.effortContext).toBe('overshoot')
  })

  it('no prescribed effort target → nothing to compare → silence', () => {
    const sessions = [
      session({ startedAtMs: 3, rir: 0 }),
      session({ startedAtMs: 2, rir: 0 }),
      session({ startedAtMs: 1, rir: 0 }),
    ]
    expect(applyEffortToAdjustment(null, sessions, 'fixed')).toBeNull()
  })

  it('a missed floor is the rep rules’ jurisdiction — the gate never doubles up', () => {
    const sessions = [
      session({ startedAtMs: 3, reps: 3, rir: 0, prescribedRir: 2 }), // floor missed
      session({ startedAtMs: 2, rir: 2, prescribedRir: 2 }),
      session({ startedAtMs: 1, rir: 2, prescribedRir: 2 }),
    ]
    expect(applyEffortToAdjustment(null, sessions, 'fixed')).toBeNull()
  })
})

describe('overshoot-hold (range mode: downgrades a step)', () => {
  const step: AutoregAdjustment = {
    action: 'step',
    deltaKg: 2.5,
    suggestEarlyDeload: false,
    stalledLoads: [100],
    evidence: { missedSets: 0, scorableSets: 3, repFloor: 8, loadKg: 100 },
  }

  it('a hot newest session downgrades step → repeat', () => {
    const result = applyEffortToAdjustment(step, effortSessions(0), 'range')
    expect(result).toMatchObject({ action: 'repeat', deltaKg: 0, effortContext: 'overshoot' })
    // The base verdict's evidence is never rewritten.
    expect(result!.evidence).toEqual(step.evidence)
  })

  it('an on-target session leaves the step alone (by reference)', () => {
    expect(applyEffortToAdjustment(step, effortSessions(2), 'range')).toBe(step)
  })

  it('range mode never synthesizes from null (fill/hold is the scheme’s own logic)', () => {
    expect(applyEffortToAdjustment(null, effortSessions(0), 'range')).toBeNull()
  })
})

describe('sustainedUndershoot (slice 4 detection)', () => {
  it('fires after TWO consecutive easy sessions at the same load (mirror of M2)', () => {
    // Prescribed RIR 2 (RPE 8), logged RIR 4 (RPE 6) = a full point-plus under.
    const sessions = [
      session({ startedAtMs: 3, rir: 4, prescribedRir: 2 }),
      session({ startedAtMs: 2, rir: 4, prescribedRir: 2 }),
      session({ startedAtMs: 1, rir: 2, prescribedRir: 2 }),
    ]
    expect(sustainedUndershoot(sessions)).toEqual({ loadKg: 100 })
  })

  it('one easy session is a good day, not a trend — silence', () => {
    const sessions = [
      session({ startedAtMs: 3, rir: 4, prescribedRir: 2 }),
      session({ startedAtMs: 2, rir: 2, prescribedRir: 2 }),
      session({ startedAtMs: 1, rir: 2, prescribedRir: 2 }),
    ]
    expect(sustainedUndershoot(sessions)).toBeNull()
  })

  it('the two sessions must be at the SAME load (ε) — a fresh load restarts the case', () => {
    const sessions = [
      session({ startedAtMs: 3, loadKg: 102.5, rir: 4, prescribedRir: 2 }),
      session({ startedAtMs: 2, loadKg: 100, rir: 4, prescribedRir: 2 }),
      session({ startedAtMs: 1, loadKg: 100, rir: 2, prescribedRir: 2 }),
    ]
    expect(sustainedUndershoot(sessions)).toBeNull()
  })

  it('respects the activation floor and the full-point threshold', () => {
    // Only 2 logged sessions in the window → below EFFORT_GATE_MIN_SESSIONS.
    const tooFew = [
      session({ startedAtMs: 3, rir: 4, prescribedRir: 2 }),
      session({ startedAtMs: 2, rir: 4, prescribedRir: 2 }),
      session({ startedAtMs: 1 }),
    ]
    expect(sustainedUndershoot(tooFew)).toBeNull()
    // RIR 3 vs prescribed 2 = one RIR under... exactly −1 RPE: fires only at ≤ target − 1.
    const boundary = [
      session({ startedAtMs: 3, rir: 3, prescribedRir: 2 }),
      session({ startedAtMs: 2, rir: 3, prescribedRir: 2 }),
      session({ startedAtMs: 1, rir: 2, prescribedRir: 2 }),
    ]
    expect(sustainedUndershoot(boundary)).toEqual({ loadKg: 100 })
  })

  it('a missed floor disqualifies the session — easy AND failed cannot coexist honestly', () => {
    const sessions = [
      session({ startedAtMs: 3, reps: 3, rir: 4, prescribedRir: 2 }),
      session({ startedAtMs: 2, rir: 4, prescribedRir: 2 }),
      session({ startedAtMs: 1, rir: 2, prescribedRir: 2 }),
    ]
    expect(sustainedUndershoot(sessions)).toBeNull()
  })
})

describe('trend veto (H2 decrement only)', () => {
  it('a rising credited-e1RM trend across the window vetoes the decrement, keeps the flag', () => {
    // Same load, same reps, RIR climbing 0→1→2 oldest→newest: credited e1RM rises.
    const sessions = [
      session({ startedAtMs: 3, reps: 4, repMin: 5, rir: 2 }),
      session({ startedAtMs: 2, reps: 4, repMin: 5, rir: 1 }),
      session({ startedAtMs: 1, reps: 4, repMin: 5, rir: 0 }),
    ]
    const result = applyEffortToAdjustment(h2Decrement, sessions, 'fixed')
    expect(result).toMatchObject({
      action: 'repeat',
      deltaKg: 0,
      effortContext: 'trend-veto',
      suggestEarlyDeload: true, // the advisory flag survives — resolved decision
    })
  })

  it('a flat or falling trend leaves the decrement alone (by reference)', () => {
    const sessions = [
      session({ startedAtMs: 3, reps: 4, repMin: 5, rir: 1 }),
      session({ startedAtMs: 2, reps: 4, repMin: 5, rir: 1 }),
      session({ startedAtMs: 1, reps: 4, repMin: 5, rir: 1 }),
    ]
    expect(applyEffortToAdjustment(h2Decrement, sessions, 'fixed')).toBe(h2Decrement)
  })
})
