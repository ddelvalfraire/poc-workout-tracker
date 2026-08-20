import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// The patch-tools module pulls in the db layer at import time; mock it so the
// REAL zod input schemas can be captured without a database. (Same pattern as
// program-patch-tools.test.ts.)
vi.mock('@/db/program-patches', () => {
  class ProgramPatchError extends Error {}
  return {
    ProgramPatchError,
    addProgramDay: vi.fn(),
    updateProgramDay: vi.fn(),
    removeProgramDay: vi.fn(),
    moveProgramDay: vi.fn(),
    addProgramExercise: vi.fn(),
    updateProgramExercise: vi.fn(),
    removeProgramExercise: vi.fn(),
    moveProgramExercise: vi.fn(),
    addProgramSet: vi.fn(),
    updateProgramSet: vi.fn(),
    removeProgramSet: vi.fn(),
    moveProgramSet: vi.fn(),
    setProgramSetOverride: vi.fn(),
    removeProgramSetOverride: vi.fn(),
    setProgramAutoregulation: vi.fn(),
    setProgramPlanSync: vi.fn(),
  }
})
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn() }))

import { registerProgramPatchTools } from '@/lib/mcp/program-patch-tools'
import { catalogTranslator } from '../../../vitest.intl'
import { COACH_APPROVAL_TOOLS } from './tool-policy'
import { describeToolCall } from './describe-tool-call'
import { renderToolCall } from './render-tool-call'

/**
 * describeToolCall now returns the summary's PARTS as descriptors, so the
 * suite has two halves: which messages a tool call resolves to (the decision,
 * unchanged by any rewording) and — through the real catalog — the sentence
 * those messages produce. The sentence half is worth keeping verbatim here
 * because it is the approval card's trust-critical line: a user is about to
 * say yes to it.
 */
const tTool = catalogTranslator('CoachToolCall')
const sentence = (toolName: string, input: unknown) =>
  renderToolCall(tTool, describeToolCall(toolName, input))

/**
 * Capture the ACTUAL registered inputSchema per tool, so every example input
 * below is validated against the live zod shape — if a tool's schema drifts
 * (renamed arg, new required field), the parse fails and this suite breaks
 * instead of the summaries silently lying.
 */
const capturedSchemas: Record<string, z.ZodRawShape> = {}
const stubServer = {
  registerTool: (name: string, config: { inputSchema: z.ZodRawShape }) => {
    capturedSchemas[name] = config.inputSchema
  },
} as unknown as McpServer
registerProgramPatchTools(stubServer)

const PROGRAM_ID = '4de3c1a0-9d55-4a2b-8f18-2ab0c1d2e3f4'

/** Parses `input` with the tool's real registered schema before describing. */
function validated(toolName: string, input: Record<string, unknown>): unknown {
  const shape = capturedSchemas[toolName]
  expect(shape, `no registered schema for ${toolName}`).toBeDefined()
  return z.object(shape).parse(input)
}

/** Every approval-gated tool: schema-valid input → the messages it resolves
 *  to, and the sentence they render as. */
const CASES: Record<
  (typeof COACH_APPROVAL_TOOLS)[number],
  { input: Record<string, unknown>; changes: string[]; expected: string }
> = {
  add_program_day: {
    input: { programId: PROGRAM_ID, name: 'Pull B' },
    changes: ['change.addDayNamed'],
    expected: 'Add day “Pull B”',
  },
  update_program_day: {
    input: { programId: PROGRAM_ID, dayPosition: 1, name: 'Push A', notes: null },
    changes: ['change.rename', 'change.notesClear'],
    expected: 'Day 2: rename to “Push A”, clear notes',
  },
  remove_program_day: {
    input: { programId: PROGRAM_ID, dayPosition: 2 },
    changes: ['change.removeDay'],
    expected: 'Remove day 3 and everything in it',
  },
  move_program_day: {
    input: { programId: PROGRAM_ID, from: 0, to: 2 },
    changes: ['change.moveDay'],
    expected: 'Move day 1 → day 3',
  },
  add_program_exercise: {
    input: { programId: PROGRAM_ID, dayPosition: 0, wgerExerciseId: 192, name: 'Bench Press' },
    changes: ['change.addExercise'],
    expected: 'Day 1: add “Bench Press”',
  },
  update_program_exercise: {
    input: {
      programId: PROGRAM_ID,
      dayPosition: 0,
      exercisePosition: 2,
      wgerExerciseId: 211,
      name: 'Incline Dumbbell Press',
    },
    changes: ['change.swapTo'],
    expected: 'Day 1, exercise 3: swap to “Incline Dumbbell Press”',
  },
  substitute_program_exercise: {
    input: {
      programId: PROGRAM_ID,
      dayPosition: 0,
      exercisePosition: 2,
      wgerExerciseId: 211,
      name: 'Incline Dumbbell Press',
    },
    changes: ['change.substitute'],
    expected: 'Day 1, exercise 3: substitute “Incline Dumbbell Press” (old loads cleared)',
  },
  remove_program_exercise: {
    input: { programId: PROGRAM_ID, dayPosition: 1, exercisePosition: 0 },
    changes: ['change.removeExercise'],
    expected: 'Day 2: remove exercise 1 and its sets',
  },
  move_program_exercise: {
    input: { programId: PROGRAM_ID, dayPosition: 1, from: 3, to: 0 },
    changes: ['change.moveExercise'],
    expected: 'Day 2: move exercise 4 → 1',
  },
  add_program_set: {
    input: {
      programId: PROGRAM_ID,
      dayPosition: 0,
      exercisePosition: 1,
      repMin: 8,
      repMax: 10,
      rir: 2,
    },
    changes: ['change.addSet'],
    expected: 'Day 1, exercise 2: add a set (reps → 8–10, RIR → 2)',
  },
  update_program_set: {
    input: {
      programId: PROGRAM_ID,
      dayPosition: 0,
      exercisePosition: 1,
      setNumber: 3,
      repMin: 8,
      repMax: 8,
      suggestedLoad: 100,
      unit: 'kg',
    },
    changes: ['target.value', 'target.value'],
    expected: 'Day 1, exercise 2, set 3: reps → 8, load → 100 kg',
  },
  remove_program_set: {
    input: { programId: PROGRAM_ID, dayPosition: 0, exercisePosition: 1, setNumber: 4 },
    changes: ['change.removeSet'],
    expected: 'Day 1, exercise 2: remove set 4',
  },
  move_program_set: {
    input: { programId: PROGRAM_ID, dayPosition: 0, exercisePosition: 1, from: 2, to: 1 },
    changes: ['change.moveSet'],
    expected: 'Day 1, exercise 2: move set 2 → set 1',
  },
  set_program_set_override: {
    input: {
      programId: PROGRAM_ID,
      dayPosition: 0,
      exercisePosition: 0,
      setNumber: 1,
      week: 4,
      repMin: 10,
      repMax: 10,
      suggestedLoad: 185,
      unit: 'lb',
    },
    changes: ['target.value', 'target.value'],
    expected: 'Week 4 only — day 1, exercise 1, set 1: reps → 10, load → 185 lb',
  },
  remove_program_set_override: {
    input: { programId: PROGRAM_ID, dayPosition: 0, exercisePosition: 0, setNumber: 1, week: 4 },
    changes: ['change.dropOverride'],
    expected: 'Day 1, exercise 1, set 1: drop the week 4 override',
  },
  set_program_policy: {
    input: { programId: PROGRAM_ID, policy: { name: 'autoregulation', value: false } },
    changes: ['change.autoregulationOff'],
    expected: 'Turn auto-regulation off',
  },
  set_training_max: {
    input: {
      programId: PROGRAM_ID,
      dayPosition: 0,
      exercisePosition: 1,
      trainingMax: 145,
      reason: 'manual',
      unit: 'kg',
    },
    changes: ['change.trainingMaxWithReason'],
    expected: 'Day 1, exercise 2: set the training max → 145 kg (manual)',
  },
}

describe('describeToolCall', () => {
  it('covers every approval-gated tool', () => {
    expect(Object.keys(CASES).sort()).toEqual([...COACH_APPROVAL_TOOLS].sort())
  })

  for (const toolName of COACH_APPROVAL_TOOLS) {
    it(`${toolName}: schema-valid input → the messages it means`, () => {
      const { input, changes } = CASES[toolName]
      const described = describeToolCall(toolName, validated(toolName, input))
      expect(described.changes.map((c) => c.key)).toEqual(changes)
      // The tool name rides along as the never-blank fallback, unchanged: it
      // is a protocol identifier, so it is not a catalog key.
      expect(described.toolName).toBe(toolName)
    })

    it(`${toolName}: renders the approval card's sentence`, () => {
      const { input, expected } = CASES[toolName]
      expect(sentence(toolName, validated(toolName, input))).toBe(expected)
    })
  }

  // The CASES table holds one row per gated tool, but set_program_policy
  // carries five policies behind that single row — so the other four arms get
  // their own coverage here. Each must keep the exact sentence it rendered
  // when it was its own tool.
  describe('set_program_policy: the arms beyond the CASES row', () => {
    const ARMS: { policy: Record<string, unknown>; changes: string[]; expected: string }[] = [
      {
        policy: { name: 'deload', value: { mode: 'scheduled', shape: {} } },
        changes: ['change.deloadPolicy'],
        expected: 'Set the deload policy → scheduled',
      },
      {
        policy: { name: 'deload', value: null },
        changes: ['change.deloadPolicyClear'],
        expected: 'Clear the deload policy (back to the default behavior)',
      },
      {
        policy: { name: 'dietPhase', value: 'cutting' },
        changes: ['change.dietPhase'],
        expected: 'Set the diet phase → cutting',
      },
      {
        policy: { name: 'dietPhase', value: null },
        changes: ['change.dietPhaseClear'],
        expected: 'Clear the diet phase',
      },
      {
        policy: { name: 'overshoot', value: 'e1rm-equivalent' },
        changes: ['change.overshoot'],
        expected: 'Set the overshoot policy → e1rm-equivalent',
      },
      {
        policy: { name: 'planSync', value: true },
        changes: ['change.planSyncEnabled'],
        expected: 'Turn plan sync on',
      },
    ]

    for (const { policy, changes, expected } of ARMS) {
      it(`${String(policy.name)}=${JSON.stringify(policy.value)} → ${expected}`, () => {
        // Arrange
        const input = { programId: PROGRAM_ID, policy }

        // Act
        const parsed = validated('set_program_policy', input)

        // Assert
        expect(describeToolCall('set_program_policy', parsed).changes.map((c) => c.key)).toEqual(
          changes,
        )
        expect(sentence('set_program_policy', parsed)).toBe(expected)
      })
    }
  })

  it('never leaks snake_case or ids into a valid gated summary', () => {
    for (const toolName of COACH_APPROVAL_TOOLS) {
      const summary = sentence(toolName, validated(toolName, CASES[toolName].input))
      expect(summary).not.toMatch(/_/)
      expect(summary).not.toContain(PROGRAM_ID)
    }
  })

  it('leaves no key path unresolved in any gated summary', () => {
    for (const toolName of COACH_APPROVAL_TOOLS) {
      expect(sentence(toolName, validated(toolName, CASES[toolName].input))).not.toMatch(
        /(change|location|target|meta)\.[a-zA-Z.]+/,
      )
    }
  })

  it('upsert_program (create): title + day/week meta from the input', () => {
    const input = {
      name: 'Hypertrophy Block',
      mesocycleWeeks: 6,
      days: [{}, {}, {}, {}],
    }
    expect(describeToolCall('upsert_program', input).changes).toEqual([
      { key: 'change.programNamed', values: { mode: 'create', name: 'Hypertrophy Block' } },
    ])
    expect(sentence('upsert_program', input)).toBe(
      'Create program “Hypertrophy Block” · 4 days · 6 weeks',
    )
  })

  it('upsert_program (replace, id given): says Replace', () => {
    // The day count is asserted at one here and at many above — the plural
    // branch is where an ICU message actually breaks.
    expect(
      sentence('upsert_program', { id: PROGRAM_ID, name: 'Hypertrophy Block', days: [{}] }),
    ).toBe('Replace program “Hypertrophy Block” · 1 day')
  })

  it('states only what the input holds — nulls read as cleared, not before-values', () => {
    const cleared = describeToolCall('update_program_set', {
      programId: PROGRAM_ID,
      dayPosition: 0,
      exercisePosition: 0,
      setNumber: 2,
      suggestedLoad: null,
      tempo: null,
    })
    expect(cleared.changes).toEqual([
      { key: 'target.cleared', values: { field: 'load' } },
      { key: 'target.cleared', values: { field: 'tempo' } },
    ])
    expect(renderToolCall(tTool, cleared)).toBe(
      'Day 1, exercise 1, set 2: load cleared, tempo cleared',
    )
  })

  it('override nulls read as unpinned (revert to engine), not cleared', () => {
    const unpinned = describeToolCall('set_program_set_override', {
      programId: PROGRAM_ID,
      dayPosition: 1,
      exercisePosition: 2,
      setNumber: 1,
      week: 3,
      repMin: null,
      repMax: null,
    })
    expect(unpinned.changes).toEqual([{ key: 'target.unpinned', values: { field: 'reps' } }])
    expect(renderToolCall(tTool, unpinned)).toBe(
      'Week 3 only — day 2, exercise 3, set 1: reps unpinned',
    )
  })

  it('unknown tools describe nothing, and render the humanized tool name', () => {
    // No invented copy for a tool the catalog has never heard of: the empty
    // change list IS the signal, and the renderer humanizes the identifier.
    expect(describeToolCall('brand_new_tool', {}).changes).toEqual([])
    expect(sentence('set_weight_unit', { unit: 'lb' })).toBe('Set weight unit')
    expect(sentence('brand_new_tool', {})).toBe('Brand new tool')
  })

  it('a known tool with mangled input degrades to the humanized name, never throws', () => {
    expect(sentence('update_program_set', null)).toBe('Update program set')
    expect(sentence('move_program_day', { from: 'x' })).toBe('Move program day')
    expect(sentence('set_program_autoregulation', 'garbage')).toBe('Set program autoregulation')
  })
})
