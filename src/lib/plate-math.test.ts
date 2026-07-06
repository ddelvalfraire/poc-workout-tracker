import { describe, it, expect } from 'vitest'
import { loadBar, warmupRamp } from './plate-math'

/** Standard lb gym: 45 bar, common plate denominations. */
const LB_PLATES = [45, 35, 25, 10, 5, 2.5]
/** Standard kg gym: 20 bar. */
const KG_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25]

describe('loadBar', () => {
  it('loads a classic 225 lb as two 45s per side', () => {
    // Act — (225 - 45) / 2 = 90 per side
    const load = loadBar(225, 45, LB_PLATES)

    // Assert
    expect(load).toEqual({ perSide: [45, 45], achieved: 225, exact: true })
  })

  it('mixes denominations greedily, largest first', () => {
    // (185 - 45) / 2 = 70 → 45 + 25
    expect(loadBar(185, 45, LB_PLATES)).toEqual({ perSide: [45, 25], achieved: 185, exact: true })
  })

  it('handles fractional plates without float drift', () => {
    // kg: (61.5 - 20) / 2 = 20.75 → one 20, the 0.75 gap unfillable → achieved 60 total
    const load = loadBar(61.5, 20, KG_PLATES)
    expect(load).toEqual({ perSide: [20], achieved: 60, exact: false })
  })

  it('reports the exact empty bar', () => {
    expect(loadBar(45, 45, LB_PLATES)).toEqual({ perSide: [], achieved: 45, exact: true })
  })

  it('supports bar = 0 for plate-loaded machines (everything is plates)', () => {
    // 90 total → 45 per side
    expect(loadBar(90, 0, LB_PLATES)).toEqual({ perSide: [45], achieved: 90, exact: true })
  })

  it('returns null when the target is below the bar', () => {
    expect(loadBar(40, 45, LB_PLATES)).toBeNull()
  })

  it('returns the closest achievable weight when plates cannot build the target', () => {
    // Only 45s available: (155 - 45) / 2 = 55 → one 45 fits, achieved 135
    expect(loadBar(155, 45, [45])).toEqual({ perSide: [45], achieved: 135, exact: false })
  })

  it('handles an empty plate inventory', () => {
    expect(loadBar(135, 45, [])).toEqual({ perSide: [], achieved: 45, exact: false })
  })
})

describe('warmupRamp', () => {
  it('ramps bar → ~40% → ~60% → ~80%, every step plate-buildable', () => {
    // Act — 225 working weight, lb gym
    const ramp = warmupRamp(225, 45, LB_PLATES)

    // Assert — each percentage rounded to what the plates can build:
    // 40% → 90: (90-45)/2 = 22.5 → 10+10+2.5 exact
    // 60% → 135: 45/side exact
    // 80% → 180: (180-45)/2 = 67.5 → 45+10+10+2.5 exact
    expect(ramp).toEqual([
      { weight: 45, reps: 10, perSide: [] },
      { weight: 90, reps: 5, perSide: [10, 10, 2.5] },
      { weight: 135, reps: 3, perSide: [45] },
      { weight: 180, reps: 1, perSide: [45, 10, 10, 2.5] },
    ])
  })

  it('keeps every step between the bar and the working weight', () => {
    // 95 working: 40% = 38 falls below the bar → dropped
    const ramp = warmupRamp(95, 45, LB_PLATES)
    expect(ramp[0]).toEqual({ weight: 45, reps: 10, perSide: [] })
    expect(ramp.every((s) => s.weight >= 45)).toBe(true)
    expect(ramp.every((s) => s.weight < 95)).toBe(true)
  })

  it('dedupes steps that collapse to the same achievable weight', () => {
    // Only 45s: 40% → 90 achieves just the bar (dup of bar step);
    // 60% → 135 exact; 80% → 180 achieves 135 (dup) — one 135 survives
    const ramp = warmupRamp(225, 45, [45])
    expect(ramp.map((s) => s.weight)).toEqual([45, 135])
  })

  it('returns only the bar step when the working weight IS the bar', () => {
    expect(warmupRamp(45, 45, LB_PLATES)).toEqual([{ weight: 45, reps: 10, perSide: [] }])
  })

  it('handles bar = 0 (plate-loaded): percentage steps only, no empty-bar step', () => {
    const ramp = warmupRamp(90, 0, LB_PLATES)
    expect(ramp.length).toBeGreaterThan(0)
    expect(ramp.every((s) => s.weight > 0 && s.weight < 90)).toBe(true)
  })

  it('returns empty for a working weight below the bar', () => {
    expect(warmupRamp(40, 45, LB_PLATES)).toEqual([])
  })
})
