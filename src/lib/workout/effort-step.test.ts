import { describe, it, expect } from 'vitest'
import {
  EFFORT_STEP_SOURCE,
  effortStepProposalContent,
  hasPendingEffortStepProposal,
} from './effort-step'
import { proposalPatchesSchema } from '../patch-proposal'

const candidate = {
  name: 'Squat',
  dayPosition: 0,
  exercisePosition: 1,
  week: 5,
  workingSets: [
    { setNumber: 1, loadKg: 100 },
    { setNumber: 2, loadKg: 100 },
    { setNumber: 3, loadKg: null },
  ],
}

describe('effortStepProposalContent', () => {
  it('steps every loaded working set +2.5% as valid kg-canonical override patches', () => {
    const content = effortStepProposalContent(candidate, 100, 'kg')
    expect(content).not.toBeNull()
    // Loadless sets carry no patch; the batch must validate against the union.
    expect(content!.patches).toHaveLength(2)
    expect(proposalPatchesSchema.safeParse(content!.patches).success).toBe(true)
    expect(content!.patches[0]).toEqual({
      tool: 'set_program_set_override',
      args: {
        dayPosition: 0,
        exercisePosition: 1,
        setNumber: 1,
        week: 5,
        suggestedLoad: 102.5,
        unit: 'kg',
      },
    })
  })

  it('phrases the summary in the display unit with decline-keeps semantics', () => {
    const content = effortStepProposalContent(candidate, 100, 'lb')
    expect(content!.summary).toContain('220.5 lb')
    expect(content!.summary).toContain('week 5')
    expect(content!.summary).toContain('Declining keeps current loads')
  })

  it('null when nothing is patchable (no loaded working sets)', () => {
    expect(
      effortStepProposalContent(
        { ...candidate, workingSets: [{ setNumber: 1, loadKg: null }] },
        100,
        'kg',
      ),
    ).toBeNull()
  })
})

describe('hasPendingEffortStepProposal', () => {
  it('matches only its own source + subject', () => {
    const pending = [
      { source: EFFORT_STEP_SOURCE, muscleGroup: 'wger:73' },
      { source: 'reactive-deload', muscleGroup: 'wger:99' },
    ]
    expect(hasPendingEffortStepProposal(pending, 'wger:73')).toBe(true)
    expect(hasPendingEffortStepProposal(pending, 'wger:99')).toBe(false)
  })
})
