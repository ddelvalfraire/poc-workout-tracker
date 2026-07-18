import { describe, it, expect } from 'vitest'
import {
  autoregulate,
  autoregReason,
  sessionStall,
  type AutoregSession,
} from './autoregulate'

/** 3 working sets prescribed at 100 kg × 8-rep floor. */
const prescribed = () => [
  { repMin: 8, loadKg: 100 },
  { repMin: 8, loadKg: 100 },
  { repMin: 8, loadKg: 100 },
]

const session = (reps: (number | null)[], weightKg = 100): AutoregSession => ({
  prescribed: prescribed(),
  actual: reps.map((r) => ({ reps: r, weightKg, completed: r !== null })),
})

describe('sessionStall', () => {
  it('flags a session missing the floor on at least half its sets', () => {
    expect(sessionStall(session([8, 6, 5]))).toEqual({
      missedSets: 2,
      scorableSets: 3,
      repFloor: 8,
      loadKg: 100,
    })
  })

  it('does not flag a single missed set among three', () => {
    expect(sessionStall(session([8, 8, 6]))).toBeNull()
  })

  it('excludes sets attempted lighter than prescribed (self-regulation is not a stall)', () => {
    // All sets at 80 kg vs 100 prescribed: zero scorable → no verdict.
    expect(sessionStall(session([5, 5, 5], 80))).toBeNull()
  })

  it('ignores warm-up sets on both sides', () => {
    const s: AutoregSession = {
      prescribed: [{ repMin: 5, loadKg: 60, setType: 'warmup' }, ...prescribed()],
      actual: [
        { reps: 1, weightKg: 60, completed: true, setType: 'warmup' },
        { reps: 8, weightKg: 100, completed: true },
        { reps: 8, weightKg: 100, completed: true },
        { reps: 8, weightKg: 100, completed: true },
      ],
    }
    expect(sessionStall(s)).toBeNull()
  })

  it('returns null (no verdict) for a session with nothing scorable', () => {
    expect(sessionStall({ prescribed: [], actual: [] })).toBeNull()
    expect(
      sessionStall({ prescribed: [{ repMin: null, loadKg: null }], actual: [] }),
    ).toBeNull()
  })

  it('never counts uncompleted or rep-less sets', () => {
    expect(sessionStall(session([null, null, 8]))).toBeNull()
  })
})

describe('autoregulate', () => {
  it('returns null with no history or no stall', () => {
    expect(autoregulate(2.5, [])).toBeNull()
    expect(autoregulate(2.5, [session([8, 8, 8])])).toBeNull()
  })

  it('repeats the load after a single stall', () => {
    const adjustment = autoregulate(2.5, [session([6, 5, 8])])
    expect(adjustment).toMatchObject({ action: 'repeat', deltaKg: 0, suggestEarlyDeload: false })
  })

  it('decrements and suggests an early deload after two consecutive stalls', () => {
    const adjustment = autoregulate(2.5, [session([6, 5, 8]), session([7, 6, 6])])
    expect(adjustment).toMatchObject({
      action: 'decrement',
      deltaKg: -2.5,
      suggestEarlyDeload: true,
    })
  })

  it('a clean previous session keeps a fresh stall at repeat, not decrement', () => {
    const adjustment = autoregulate(2.5, [session([6, 5, 8]), session([8, 8, 8])])
    expect(adjustment).toMatchObject({ action: 'repeat', suggestEarlyDeload: false })
  })

  it('a no-verdict previous session (deviated day) never escalates', () => {
    const deviated: AutoregSession = { prescribed: [], actual: [] }
    const adjustment = autoregulate(2.5, [session([6, 5, 8]), deviated])
    expect(adjustment).toMatchObject({ action: 'repeat' })
  })
})

describe('autoregReason', () => {
  it('names the evidence in the display unit', () => {
    const adjustment = autoregulate(2.5, [session([6, 5, 8])])!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'Missed 8 reps on 2 of 3 sets at 100 kg — repeating the load',
    )
    expect(autoregReason(adjustment, 'lb')).toContain('220.5 lb')
  })

  it('describes the back-off distinctly', () => {
    const adjustment = autoregulate(2.5, [session([6, 5, 8]), session([6, 6, 6])])!
    expect(autoregReason(adjustment, 'kg')).toBe(
      'Second straight stall at 100 kg — backing off one increment',
    )
  })
})
