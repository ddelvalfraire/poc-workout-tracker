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
import { COACH_APPROVAL_TOOLS } from './tool-policy'
import { describeToolCall } from './describe-tool-call'

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

/** Every approval-gated tool: schema-valid input → exact expected sentence. */
const CASES: Record<
  (typeof COACH_APPROVAL_TOOLS)[number],
  { input: Record<string, unknown>; expected: string }
> = {
  add_program_day: {
    input: { programId: PROGRAM_ID, name: 'Pull B' },
    expected: 'Add day “Pull B”',
  },
  update_program_day: {
    input: { programId: PROGRAM_ID, dayPosition: 1, name: 'Push A', notes: null },
    expected: 'Day 2: rename to “Push A”, clear notes',
  },
  remove_program_day: {
    input: { programId: PROGRAM_ID, dayPosition: 2 },
    expected: 'Remove day 3 and everything in it',
  },
  move_program_day: {
    input: { programId: PROGRAM_ID, from: 0, to: 2 },
    expected: 'Move day 1 → day 3',
  },
  add_program_exercise: {
    input: { programId: PROGRAM_ID, dayPosition: 0, wgerExerciseId: 192, name: 'Bench Press' },
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
    expected: 'Day 1, exercise 3: swap to “Incline Dumbbell Press”',
  },
  remove_program_exercise: {
    input: { programId: PROGRAM_ID, dayPosition: 1, exercisePosition: 0 },
    expected: 'Day 2: remove exercise 1 and its sets',
  },
  move_program_exercise: {
    input: { programId: PROGRAM_ID, dayPosition: 1, from: 3, to: 0 },
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
    expected: 'Day 1, exercise 2, set 3: reps → 8, load → 100 kg',
  },
  remove_program_set: {
    input: { programId: PROGRAM_ID, dayPosition: 0, exercisePosition: 1, setNumber: 4 },
    expected: 'Day 1, exercise 2: remove set 4',
  },
  move_program_set: {
    input: { programId: PROGRAM_ID, dayPosition: 0, exercisePosition: 1, from: 2, to: 1 },
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
    expected: 'Week 4 only — day 1, exercise 1, set 1: reps → 10, load → 185 lb',
  },
  remove_program_set_override: {
    input: { programId: PROGRAM_ID, dayPosition: 0, exercisePosition: 0, setNumber: 1, week: 4 },
    expected: 'Day 1, exercise 1, set 1: drop the week 4 override',
  },
  set_program_autoregulation: {
    input: { programId: PROGRAM_ID, enabled: false },
    expected: 'Turn auto-regulation off',
  },
  set_program_plan_sync: {
    input: { programId: PROGRAM_ID, enabled: true },
    expected: 'Turn plan sync on',
  },
}

describe('describeToolCall', () => {
  it('covers every approval-gated tool', () => {
    expect(Object.keys(CASES).sort()).toEqual([...COACH_APPROVAL_TOOLS].sort())
  })

  for (const toolName of COACH_APPROVAL_TOOLS) {
    it(`${toolName}: schema-valid input → human sentence`, () => {
      const { input, expected } = CASES[toolName]
      expect(describeToolCall(toolName, validated(toolName, input))).toBe(expected)
    })
  }

  it('never leaks snake_case or ids into a valid gated summary', () => {
    for (const toolName of COACH_APPROVAL_TOOLS) {
      const summary = describeToolCall(toolName, validated(toolName, CASES[toolName].input))
      expect(summary).not.toMatch(/_/)
      expect(summary).not.toContain(PROGRAM_ID)
    }
  })

  it('upsert_program (create): title + day/week meta from the input', () => {
    const input = {
      name: 'Hypertrophy Block',
      mesocycleWeeks: 6,
      days: [{}, {}, {}, {}],
    }
    expect(describeToolCall('upsert_program', input)).toBe(
      'Create program “Hypertrophy Block” · 4 days · 6 weeks',
    )
  })

  it('upsert_program (replace, id given): says Replace', () => {
    expect(
      describeToolCall('upsert_program', { id: PROGRAM_ID, name: 'Hypertrophy Block', days: [{}] }),
    ).toBe('Replace program “Hypertrophy Block” · 1 day')
  })

  it('states only what the input holds — nulls read as cleared, not before-values', () => {
    expect(
      describeToolCall('update_program_set', {
        programId: PROGRAM_ID,
        dayPosition: 0,
        exercisePosition: 0,
        setNumber: 2,
        suggestedLoad: null,
        tempo: null,
      }),
    ).toBe('Day 1, exercise 1, set 2: load cleared, tempo cleared')
  })

  it('override nulls read as unpinned (revert to engine), not cleared', () => {
    expect(
      describeToolCall('set_program_set_override', {
        programId: PROGRAM_ID,
        dayPosition: 1,
        exercisePosition: 2,
        setNumber: 1,
        week: 3,
        repMin: null,
        repMax: null,
      }),
    ).toBe('Week 3 only — day 2, exercise 3, set 1: reps unpinned')
  })

  it('unknown tools fall back to the humanized tool name', () => {
    expect(describeToolCall('set_weight_unit', { unit: 'lb' })).toBe('Set weight unit')
    expect(describeToolCall('brand_new_tool', {})).toBe('Brand new tool')
  })

  it('a known tool with mangled input degrades to the humanized name, never throws', () => {
    expect(describeToolCall('update_program_set', null)).toBe('Update program set')
    expect(describeToolCall('move_program_day', { from: 'x' })).toBe('Move program day')
    expect(describeToolCall('set_program_autoregulation', 'garbage')).toBe(
      'Set program autoregulation',
    )
  })
})
