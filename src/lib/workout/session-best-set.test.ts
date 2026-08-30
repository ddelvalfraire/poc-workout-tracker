import { describe, expect, it } from 'vitest'
import { sessionBestSet, type SessionSetLike } from './session-best-set'

/** One display-truth session set; overrides on top of a completed working set. */
function set(over: Partial<SessionSetLike> = {}): SessionSetLike {
  return {
    reps: 5,
    weight: 100,
    completed: true,
    metricMode: 'reps_weight',
    setType: 'working',
    ...over,
  }
}

describe('sessionBestSet', () => {
  it('picks the highest-e1RM set and reports its e1RM in kg', () => {
    const best = sessionBestSet(
      [set({ reps: 5, weight: 100 }), set({ reps: 3, weight: 110 }), set({ reps: 8, weight: 80 })],
      'weight_reps',
    )

    // 110×3 → 121 e1RM beats 100×5 → ~116.7 and 80×8 → ~101.3. Full-precision
    // kg (float): compare closely, round only at display.
    expect(best?.index).toBe(1)
    expect(best?.e1rmKg).toBeCloseTo(121)
  })

  it('returns indices into the ORIGINAL array, not the scorable subset', () => {
    const best = sessionBestSet(
      [
        set({ setType: 'warmup', reps: 10, weight: 200 }),
        set({ completed: false, reps: 5, weight: 300 }),
        set({ metricMode: 'duration', reps: null, weight: null }),
        set({ reps: 5, weight: 100 }),
      ],
      'weight_reps',
    )

    expect(best?.index).toBe(3)
  })

  it('never marks a warm-up, an uncompleted set, or a non-reps_weight row', () => {
    const best = sessionBestSet(
      [
        set({ setType: 'warmup', reps: 5, weight: 500 }),
        set({ completed: false, reps: 5, weight: 500 }),
        set({ metricMode: 'duration_distance' }),
      ],
      'weight_reps',
    )

    expect(best).toBeNull()
  })

  it('falls back to rep comparison (e1rmKg null) when nothing is load-scorable', () => {
    const best = sessionBestSet(
      [set({ reps: 8, weight: null }), set({ reps: 12, weight: null })],
      'bodyweight_reps',
    )

    expect(best).toEqual({ index: 1, e1rmKg: null })
  })

  it('scores bodyweight types over effective load when bodyweight is known', () => {
    const best = sessionBestSet(
      [set({ reps: 5, weight: 10 }), set({ reps: 5, weight: 20 })],
      'weighted_bodyweight',
      80,
    )

    // Effective loads 90 vs 100 kg at equal reps — the heavier added load wins.
    expect(best?.index).toBe(1)
    expect(best?.e1rmKg).toBeCloseTo(100 * (1 + 5 / 30))
  })

  it('keeps ties on the earliest set', () => {
    const best = sessionBestSet(
      [set({ reps: 5, weight: 100 }), set({ reps: 5, weight: 100 })],
      'weight_reps',
    )

    expect(best?.index).toBe(0)
  })

  it('treats rows without a setType field as working sets', () => {
    const rows: SessionSetLike[] = [
      { reps: 5, weight: 100, completed: true, metricMode: 'reps_weight' },
    ]

    expect(sessionBestSet(rows, 'weight_reps')?.index).toBe(0)
  })

  it('returns null for an empty session', () => {
    expect(sessionBestSet([], 'weight_reps')).toBeNull()
  })
})
