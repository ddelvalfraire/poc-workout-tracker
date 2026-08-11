import { describe, it, expect } from 'vitest'
import {
  proposalPatchSchema,
  proposalPatchesSchema,
  patchForDisplay,
  MAX_PROPOSAL_PATCHES,
  type ProposalPatch,
} from './patch-proposal'

describe('proposalPatchSchema (batch-proposal envelope)', () => {
  it('accepts each proposable op with kg-canonical args', () => {
    // Arrange — one representative envelope per supported tool
    const patches = [
      { tool: 'add_program_set', args: { dayPosition: 0, exercisePosition: 1, repMin: 8, repMax: 12 } },
      {
        tool: 'update_program_set',
        args: { dayPosition: 0, exercisePosition: 0, setNumber: 2, suggestedLoad: 100, unit: 'kg' },
      },
      { tool: 'remove_program_set', args: { dayPosition: 1, exercisePosition: 0, setNumber: 3 } },
      {
        tool: 'set_program_set_override',
        args: { dayPosition: 0, exercisePosition: 0, setNumber: 1, week: 4, rir: 0 },
      },
      {
        tool: 'remove_program_set_override',
        args: { dayPosition: 0, exercisePosition: 0, setNumber: 1, week: 4 },
      },
      { tool: 'set_training_max', args: { dayPosition: 0, exercisePosition: 0, trainingMax: 90 } },
      { tool: 'set_program_diet_phase', args: { phase: 'cutting' } },
      // null clears the phase — still a deliberate statement (stamps set_at).
      { tool: 'set_program_diet_phase', args: { phase: null } },
    ]

    // Act + Assert
    for (const patch of patches) {
      expect(proposalPatchSchema.safeParse(patch).success, JSON.stringify(patch)).toBe(true)
    }
  })

  it('rejects an unknown tool name', () => {
    const result = proposalPatchSchema.safeParse({
      tool: 'remove_program_day', // a real MCP tool, deliberately NOT proposable
      args: { dayPosition: 0 },
    })
    expect(result.success).toBe(false)
  })

  it('rejects junk keys — nothing can smuggle past confirm-time re-validation', () => {
    const result = proposalPatchSchema.safeParse({
      tool: 'remove_program_set',
      args: { dayPosition: 0, exercisePosition: 0, setNumber: 1, programId: 'p1' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-kg unit — stored args are canonical', () => {
    const result = proposalPatchSchema.safeParse({
      tool: 'set_training_max',
      args: { dayPosition: 0, exercisePosition: 0, trainingMax: 200, unit: 'lb' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects a diet phase outside the enum (and junk keys on the loadless op)', () => {
    expect(
      proposalPatchSchema.safeParse({
        tool: 'set_program_diet_phase',
        args: { phase: 'recomp' },
      }).success,
    ).toBe(false)
    expect(
      proposalPatchSchema.safeParse({
        tool: 'set_program_diet_phase',
        args: { phase: 'cutting', unit: 'kg' },
      }).success,
    ).toBe(false)
  })

  it('rejects an update patch that changes nothing', () => {
    const result = proposalPatchSchema.safeParse({
      tool: 'update_program_set',
      args: { dayPosition: 0, exercisePosition: 0, setNumber: 1 },
    })
    expect(result.success).toBe(false)
  })

  it('rejects out-of-bounds values (negative TM, position, oversized rep)', () => {
    expect(
      proposalPatchSchema.safeParse({
        tool: 'set_training_max',
        args: { dayPosition: 0, exercisePosition: 0, trainingMax: -1 },
      }).success,
    ).toBe(false)
    expect(
      proposalPatchSchema.safeParse({
        tool: 'remove_program_set',
        args: { dayPosition: -1, exercisePosition: 0, setNumber: 1 },
      }).success,
    ).toBe(false)
    expect(
      proposalPatchSchema.safeParse({
        tool: 'add_program_set',
        args: { dayPosition: 0, exercisePosition: 0, repMin: 10_001 },
      }).success,
    ).toBe(false)
  })
})

describe('proposalPatchesSchema (the batch)', () => {
  const one = {
    tool: 'remove_program_set',
    args: { dayPosition: 0, exercisePosition: 0, setNumber: 2 },
  }

  it('rejects an empty batch', () => {
    expect(proposalPatchesSchema.safeParse([]).success).toBe(false)
  })

  it('caps the batch at MAX_PROPOSAL_PATCHES', () => {
    expect(
      proposalPatchesSchema.safeParse(Array.from({ length: MAX_PROPOSAL_PATCHES }, () => one))
        .success,
    ).toBe(true)
    expect(
      proposalPatchesSchema.safeParse(Array.from({ length: MAX_PROPOSAL_PATCHES + 1 }, () => one))
        .success,
    ).toBe(false)
  })
})

describe('patchForDisplay', () => {
  it('returns the patch untouched for a kg viewer', () => {
    const patch: ProposalPatch = {
      tool: 'set_training_max',
      args: { dayPosition: 0, exercisePosition: 0, trainingMax: 100, unit: 'kg' },
    }
    expect(patchForDisplay(patch, 'kg')).toBe(patch)
  })

  it('passes the loadless diet-phase op through untouched for any viewer', () => {
    const patch: ProposalPatch = {
      tool: 'set_program_diet_phase',
      args: { phase: 'cutting' },
    }
    expect(patchForDisplay(patch, 'lb')).toBe(patch)
  })

  it('converts trainingMax and stamps the display unit for an lb viewer', () => {
    const patch: ProposalPatch = {
      tool: 'set_training_max',
      args: { dayPosition: 0, exercisePosition: 0, trainingMax: 100, unit: 'kg' },
    }
    const display = patchForDisplay(patch, 'lb')
    expect(display.args).toMatchObject({ trainingMax: 220.5, unit: 'lb' })
    // The stored patch is never mutated.
    expect(patch.args.trainingMax).toBe(100)
    expect(patch.args.unit).toBe('kg')
  })

  it('converts suggestedLoad but leaves null/omitted loads alone', () => {
    const withLoad: ProposalPatch = {
      tool: 'update_program_set',
      args: { dayPosition: 0, exercisePosition: 0, setNumber: 1, suggestedLoad: 100, unit: 'kg' },
    }
    const cleared: ProposalPatch = {
      tool: 'update_program_set',
      args: { dayPosition: 0, exercisePosition: 0, setNumber: 1, suggestedLoad: null, unit: 'kg' },
    }
    expect(patchForDisplay(withLoad, 'lb').args).toMatchObject({
      suggestedLoad: 220.5,
      unit: 'lb',
    })
    expect(patchForDisplay(cleared, 'lb').args).toMatchObject({ suggestedLoad: null, unit: 'lb' })
  })
})
