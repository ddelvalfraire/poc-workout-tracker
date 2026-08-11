import { describe, it, expect } from 'vitest'
import { ROLLING_E1RM_SESSIONS, rollingE1rm } from './rolling-e1rm'

/** A qualifying history row; synthetic workout ids order sessions by startedAtMs. */
function row(over: Partial<Parameters<typeof rollingE1rm>[0][number]> = {}) {
  return {
    workoutId: 'w1',
    startedAtMs: 1_000,
    reps: 5,
    weightKg: 100,
    rir: null,
    setType: 'working' as const,
    completed: true,
    ...over,
  }
}

// Epley: 100 kg × 5 → 100 × (1 + 5/30) ≈ 116.67
const E5X100 = 100 * (1 + 5 / 30)

describe('rollingE1rm', () => {
  it('averages the per-session top-set e1RMs over the window', () => {
    const rows = [
      row({ workoutId: 'a', startedAtMs: 1, reps: 5, weightKg: 100 }),
      // Same session, lighter set — never the top.
      row({ workoutId: 'a', startedAtMs: 1, reps: 5, weightKg: 80 }),
      row({ workoutId: 'b', startedAtMs: 2, reps: 5, weightKg: 110 }),
    ]
    const expected = (E5X100 + 110 * (1 + 5 / 30)) / 2
    expect(rollingE1rm(rows)).toBeCloseTo(expected, 6)
  })

  it('keeps only the newest ROLLING_E1RM_SESSIONS sessions — a bad recent stretch LOWERS the signal', () => {
    // One ancient monster session followed by ROLLING_E1RM_SESSIONS lighter ones:
    // the monster falls out of the window, unlike the old all-time bestSet.
    const rows = [
      row({ workoutId: 'old', startedAtMs: 0, weightKg: 200 }),
      ...Array.from({ length: ROLLING_E1RM_SESSIONS }, (_, i) =>
        row({ workoutId: `s${i}`, startedAtMs: i + 1, weightKg: 100 }),
      ),
    ]
    expect(rollingE1rm(rows)).toBeCloseTo(E5X100, 6)
  })

  it('credits logged RIR as reps in the bank (Epley on reps + rir)', () => {
    // 100 kg × 5 @ RIR 2 → e1RM as if 7 reps: 100 × (1 + 7/30)
    const rows = [row({ rir: 2 })]
    expect(rollingE1rm(rows)).toBeCloseTo(100 * (1 + 7 / 30), 6)
  })

  it('excludes far-from-failure sets (RIR > 3) — unreliable per the literature', () => {
    expect(rollingE1rm([row({ rir: 4 })])).toBeNull()
    // But a same-session harder set still counts.
    const rows = [row({ rir: 4, weightKg: 120 }), row({ rir: 1, weightKg: 100 })]
    expect(rollingE1rm(rows)).toBeCloseTo(100 * (1 + 6 / 30), 6)
  })

  it('excludes high-rep sets (> 12 reps), warmups, and incomplete sets', () => {
    expect(rollingE1rm([row({ reps: 13 })])).toBeNull()
    expect(rollingE1rm([row({ setType: 'warmup' })])).toBeNull()
    expect(rollingE1rm([row({ completed: false })])).toBeNull()
    // amrap and backoff sets are honest evidence.
    expect(rollingE1rm([row({ setType: 'amrap' })])).toBeCloseTo(E5X100, 6)
  })

  it('a set without logged RIR counts at face value (effort logging stays optional)', () => {
    expect(rollingE1rm([row({ rir: null })])).toBeCloseTo(E5X100, 6)
  })

  it('null on no qualifying rows', () => {
    expect(rollingE1rm([])).toBeNull()
    expect(rollingE1rm([row({ reps: null })])).toBeNull()
    expect(rollingE1rm([row({ weightKg: null })])).toBeNull()
  })

  it('a single (credited) rep is its own max — no Epley inflation (estimate1RM contract)', () => {
    expect(rollingE1rm([row({ reps: 1, rir: null, weightKg: 150 })])).toBe(150)
  })
})
