import { describe, it, expect } from 'vitest'
import {
  REACTIVE_DELOAD_SOURCE,
  REACTIVE_DEFAULT_SHAPE,
  hasPendingReactiveDeloadProposal,
  reactiveDeloadKind,
  reactiveDeloadProposalContent,
  reactiveDeloadSubject,
  type ReactiveDeloadCandidate,
} from './reactive-deload'
import { proposalPatchesSchema } from './patch-proposal'
import type { AutoregAdjustment } from './autoregulate'

/** A minimal M4-ish verdict; overrides shape the flavor under test. */
function adjustment(over: Partial<AutoregAdjustment> = {}): AutoregAdjustment {
  return {
    action: 'decrement',
    deltaKg: -10,
    suggestEarlyDeload: true,
    stalledLoads: [100],
    evidence: { missedSets: 2, scorableSets: 3, repFloor: 8, loadKg: 100 },
    ...over,
  }
}

function candidate(over: Partial<ReactiveDeloadCandidate> = {}): ReactiveDeloadCandidate {
  return {
    name: 'Squat',
    dayPosition: 0,
    exercisePosition: 1,
    week: 5,
    workingSets: [
      { setNumber: 1, loadKg: 100 },
      { setNumber: 2, loadKg: 100 },
    ],
    adjustment: adjustment(),
    ...over,
  }
}

describe('reactiveDeloadKind (eligibility)', () => {
  it('is silent without an early-deload suggestion, whatever the policy/phase', () => {
    expect(reactiveDeloadKind(null, 'reactive', 'cutting')).toBeNull()
    expect(
      reactiveDeloadKind(adjustment({ suggestEarlyDeload: false }), 'reactive', 'cutting'),
    ).toBeNull()
  })

  it("mode 'reactive' + M4 → 'reactive' (Part B: the flag IS the trigger)", () => {
    expect(reactiveDeloadKind(adjustment({ action: 'flag', deltaKg: 0 }), 'reactive', null)).toBe(
      'reactive',
    )
  })

  it("a cutting-held backoff → 'cutting-hold' in ANY policy mode (Part A)", () => {
    const held = adjustment({
      action: 'repeat',
      deltaKg: 0,
      phaseContext: 'cutting',
      heldBackoffKg: 10,
    })
    expect(reactiveDeloadKind(held, 'scheduled', 'cutting')).toBe('cutting-hold')
    expect(reactiveDeloadKind(held, 'none', 'cutting')).toBe('cutting-hold')
    // Reactive + cutting collapses to the cutting phrasing — one proposal.
    expect(reactiveDeloadKind(held, 'reactive', 'cutting')).toBe('cutting-hold')
  })

  it("a non-reactive, non-cutting program raises nothing ('scheduled' keeps its week)", () => {
    expect(reactiveDeloadKind(adjustment(), 'scheduled', null)).toBeNull()
    expect(reactiveDeloadKind(adjustment(), 'none', 'bulking')).toBeNull()
  })
})

describe('reactiveDeloadSubject / pending dedup', () => {
  it('keys on the composite exercise identity', () => {
    expect(reactiveDeloadSubject('wger', 73)).toBe('wger:73')
    expect(reactiveDeloadSubject('custom', 9)).toBe('custom:9')
  })

  it('matches only its own source + subject among pending rows', () => {
    const pending = [
      { source: 'volume-progression', muscleGroup: 'wger:73' },
      { source: REACTIVE_DELOAD_SOURCE, muscleGroup: 'wger:73' },
    ]
    expect(hasPendingReactiveDeloadProposal(pending, 'wger:73')).toBe(true)
    expect(hasPendingReactiveDeloadProposal(pending, 'wger:9')).toBe(false)
    expect(hasPendingReactiveDeloadProposal([pending[0]], 'wger:73')).toBe(false)
  })
})

describe('reactiveDeloadProposalContent — reactive flavor (Part B)', () => {
  it('emits one valid override patch per loaded working set at the shape factor', () => {
    // Act
    const content = reactiveDeloadProposalContent(
      candidate(),
      'reactive',
      REACTIVE_DEFAULT_SHAPE,
      'kg',
    )!

    // Assert — kg-canonical patches that re-validate through the stored schema
    expect(proposalPatchesSchema.parse(content.patches)).toHaveLength(2)
    expect(content.patches[0]).toEqual({
      tool: 'set_program_set_override',
      args: {
        dayPosition: 0,
        exercisePosition: 1,
        setNumber: 1,
        week: 5,
        suggestedLoad: 85,
        unit: 'kg',
      },
    })
    expect(content.summary).toBe(
      'Squat stalled 3 sessions — deload next week (week 5)? 85% load.',
    )
  })

  it('carries the rpeCap when the stored shape has one', () => {
    const content = reactiveDeloadProposalContent(
      candidate(),
      'reactive',
      { loadFactor: 0.9, setFactor: 1, rpeCap: 7 },
      'kg',
    )!
    expect(content.patches[0].args).toMatchObject({ suggestedLoad: 90, rpe: 7 })
    expect(content.summary).toContain('90% load, RPE cap 7')
  })

  it('skips load-less sets and returns null when nothing is patchable', () => {
    const partial = reactiveDeloadProposalContent(
      candidate({ workingSets: [{ setNumber: 1, loadKg: null }, { setNumber: 2, loadKg: 80 }] }),
      'reactive',
      REACTIVE_DEFAULT_SHAPE,
      'kg',
    )!
    expect(partial.patches).toHaveLength(1)
    expect(partial.patches[0].args).toMatchObject({ setNumber: 2, suggestedLoad: 68 })

    expect(
      reactiveDeloadProposalContent(
        candidate({ workingSets: [{ setNumber: 1, loadKg: null }] }),
        'reactive',
        REACTIVE_DEFAULT_SHAPE,
        'kg',
      ),
    ).toBeNull()
  })
})

describe('reactiveDeloadProposalContent — cutting-hold flavor (Part A)', () => {
  const held = adjustment({
    action: 'repeat',
    deltaKg: 0,
    phaseContext: 'cutting',
    heldBackoffKg: 10,
  })

  it('offers exactly the HELD backoff (engine fraction, not the deload shape)', () => {
    // Act — held 10 off 100 → ×0.9, regardless of the 0.85 shape
    const content = reactiveDeloadProposalContent(
      candidate({ adjustment: held }),
      'cutting-hold',
      REACTIVE_DEFAULT_SHAPE,
      'kg',
    )!

    // Assert — patches carry the backoff; no rpeCap (that is the shape's)
    expect(
      content.patches.map((p) => (p.args as { suggestedLoad?: number }).suggestedLoad),
    ).toEqual([90, 90])
    expect('rpe' in content.patches[0].args).toBe(false)
    // Hold-first phrasing: declining is the recommendation, in the display unit.
    expect(content.summary).toBe(
      'Squat stalled 3× at 100 kg while cutting — hold rather than back off? Holding is the win; confirm only to back off week 5 (~90% load). Declining holds.',
    )
  })

  it('speaks the display unit in the summary while patches stay kg-canonical', () => {
    const content = reactiveDeloadProposalContent(
      candidate({ adjustment: held }),
      'cutting-hold',
      REACTIVE_DEFAULT_SHAPE,
      'lb',
    )!
    expect(content.summary).toContain('220.5 lb while cutting')
    expect(content.patches[0].args).toMatchObject({ suggestedLoad: 90, unit: 'kg' })
  })
})
