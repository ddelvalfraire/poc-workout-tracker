import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// The mock defines its own ProgramPatchError so the tools' `instanceof` check
// (they import the class from this same mocked module) matches what the tests throw.
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
  }
})
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn() }))

import { registerProgramPatchTools } from './program-patch-tools'
import {
  ProgramPatchError,
  addProgramDay,
  updateProgramDay,
  removeProgramDay,
  moveProgramDay,
  addProgramExercise,
  updateProgramExercise,
  removeProgramExercise,
  moveProgramExercise,
  addProgramSet,
  updateProgramSet,
  removeProgramSet,
  moveProgramSet,
  setProgramSetOverride,
  removeProgramSetOverride,
} from '@/db/program-patches'
import { getWeightUnit } from '@/db/preferences'
import { displayToKg } from '@/lib/units'

const mockedAddDay = vi.mocked(addProgramDay)
const mockedUpdateDay = vi.mocked(updateProgramDay)
const mockedRemoveDay = vi.mocked(removeProgramDay)
const mockedMoveDay = vi.mocked(moveProgramDay)
const mockedAddExercise = vi.mocked(addProgramExercise)
const mockedUpdateExercise = vi.mocked(updateProgramExercise)
const mockedRemoveExercise = vi.mocked(removeProgramExercise)
const mockedMoveExercise = vi.mocked(moveProgramExercise)
const mockedAddSet = vi.mocked(addProgramSet)
const mockedUpdateSet = vi.mocked(updateProgramSet)
const mockedRemoveSet = vi.mocked(removeProgramSet)
const mockedMoveSet = vi.mocked(moveProgramSet)
const mockedSetOverride = vi.mocked(setProgramSetOverride)
const mockedRemoveOverride = vi.mocked(removeProgramSetOverride)
const mockedGetUnit = vi.mocked(getWeightUnit)

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean }
type Extra = { authInfo?: { extra?: { userId?: unknown } } }
type ToolHandler = (args: Record<string, unknown>, extra?: Extra) => Promise<ToolResult>

/** Records registerTool(name, _config, handler) so tests can invoke handlers directly. */
function fakeServer(): { server: McpServer; tools: Map<string, ToolHandler> } {
  const tools = new Map<string, ToolHandler>()
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  }
  return { server: server as unknown as McpServer, tools }
}

function setup(): Map<string, ToolHandler> {
  const { server, tools } = fakeServer()
  registerProgramPatchTools(server)
  return tools
}

function payload(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text)
}

const PID = '22222222-2222-4222-8222-222222222222'

describe('registerProgramPatchTools', () => {
  const original = process.env.MCP_DEV_USER_ID
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MCP_DEV_USER_ID = 'user_env'
    mockedGetUnit.mockResolvedValue('lb')
  })
  afterEach(() => {
    if (original === undefined) delete process.env.MCP_DEV_USER_ID
    else process.env.MCP_DEV_USER_ID = original
  })

  it('registers exactly the fourteen program patch tools', () => {
    expect([...setup().keys()].sort()).toEqual([
      'add_program_day',
      'add_program_exercise',
      'add_program_set',
      'move_program_day',
      'move_program_exercise',
      'move_program_set',
      'remove_program_day',
      'remove_program_exercise',
      'remove_program_set',
      'remove_program_set_override',
      'set_program_set_override',
      'update_program_day',
      'update_program_exercise',
      'update_program_set',
    ])
  })

  describe('day tools', () => {
    it('add_program_day appends and echoes the new position', async () => {
      const tools = setup()
      mockedAddDay.mockResolvedValue({ position: 2 })

      const result = await tools.get('add_program_day')!({ programId: PID, name: 'Pull' })

      expect(mockedAddDay).toHaveBeenCalledWith('user_env', PID, { name: 'Pull', notes: undefined })
      expect(payload(result)).toEqual({ userId: 'user_env', programId: PID, dayPosition: 2 })
    })

    it('update_program_day errors on an empty patch without touching the db', async () => {
      const tools = setup()

      const result = await tools.get('update_program_day')!({ programId: PID, dayPosition: 0 })

      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/at least one/i)
      expect(mockedUpdateDay).not.toHaveBeenCalled()
    })

    it('update_program_day patches the named fields and echoes the address', async () => {
      const tools = setup()
      mockedUpdateDay.mockResolvedValue({ id: 'pd1' })

      const result = await tools.get('update_program_day')!({
        programId: PID,
        dayPosition: 1,
        name: 'Legs',
      })

      expect(mockedUpdateDay).toHaveBeenCalledWith('user_env', PID, 1, {
        name: 'Legs',
        notes: undefined,
      })
      expect(payload(result)).toEqual({ userId: 'user_env', programId: PID, dayPosition: 1 })
    })

    it('remove_program_day surfaces not-found when the day is not owned', async () => {
      const tools = setup()
      mockedRemoveDay.mockResolvedValue(null)

      const result = await tools.get('remove_program_day')!({ programId: PID, dayPosition: 9 })

      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
    })

    it('move_program_day moves and echoes from/to', async () => {
      const tools = setup()
      mockedMoveDay.mockResolvedValue({ moved: true })

      const result = await tools.get('move_program_day')!({ programId: PID, from: 2, to: 0 })

      expect(mockedMoveDay).toHaveBeenCalledWith('user_env', PID, 2, 0)
      expect(payload(result)).toEqual({ userId: 'user_env', programId: PID, from: 2, to: 0 })
    })
  })

  describe('exercise tools', () => {
    it('add_program_exercise appends and echoes the new position', async () => {
      const tools = setup()
      mockedAddExercise.mockResolvedValue({ position: 1 })

      const result = await tools.get('add_program_exercise')!({
        programId: PID,
        dayPosition: 0,
        wgerExerciseId: 73,
        name: 'Flat Bench',
      })

      expect(mockedAddExercise).toHaveBeenCalledWith('user_env', PID, 0, {
        wgerExerciseId: 73,
        name: 'Flat Bench',
        progression: undefined,
      })
      expect(payload(result)).toEqual({
        userId: 'user_env',
        programId: PID,
        dayPosition: 0,
        exercisePosition: 1,
      })
    })

    it('update_program_exercise swaps the movement without touching sets', async () => {
      const tools = setup()
      mockedUpdateExercise.mockResolvedValue({ id: 'pe1' })

      const result = await tools.get('update_program_exercise')!({
        programId: PID,
        dayPosition: 1,
        exercisePosition: 0,
        wgerExerciseId: 99,
        name: 'Incline Press',
      })

      expect(mockedUpdateExercise).toHaveBeenCalledWith('user_env', PID, 1, 0, {
        wgerExerciseId: 99,
        name: 'Incline Press',
        progression: undefined,
      })
      expect(payload(result)).toEqual({
        userId: 'user_env',
        programId: PID,
        dayPosition: 1,
        exercisePosition: 0,
      })
    })

    it('update_program_exercise errors on an empty patch without touching the db', async () => {
      const tools = setup()

      const result = await tools.get('update_program_exercise')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
      })

      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/at least one/i)
      expect(mockedUpdateExercise).not.toHaveBeenCalled()
    })

    it('remove_program_exercise removes and echoes the removed position', async () => {
      const tools = setup()
      mockedRemoveExercise.mockResolvedValue({ removed: true })

      const result = await tools.get('remove_program_exercise')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 2,
      })

      expect(mockedRemoveExercise).toHaveBeenCalledWith('user_env', PID, 0, 2)
      expect(payload(result)).toEqual({
        userId: 'user_env',
        programId: PID,
        dayPosition: 0,
        removedExercisePosition: 2,
      })
    })

    it('move_program_exercise surfaces not-found for an out-of-range target', async () => {
      const tools = setup()
      mockedMoveExercise.mockResolvedValue(null)

      const result = await tools.get('move_program_exercise')!({
        programId: PID,
        dayPosition: 0,
        from: 0,
        to: 9,
      })

      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
    })
  })

  describe('set tools', () => {
    it('add_program_set converts suggestedLoad with the stored unit and echoes it', async () => {
      const tools = setup()
      mockedAddSet.mockResolvedValue({ setNumber: 4 })

      const result = await tools.get('add_program_set')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        repMin: 8,
        repMax: 10,
        suggestedLoad: 225,
      })

      expect(mockedAddSet).toHaveBeenCalledWith('user_env', PID, 0, 0, {
        repMin: 8,
        repMax: 10,
        suggestedLoadKg: displayToKg(225, 'lb'),
      })
      expect(payload(result)).toEqual({
        userId: 'user_env',
        unit: 'lb',
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        setNumber: 4,
      })
    })

    it('update_program_set does not read the stored unit when no load is given', async () => {
      const tools = setup()
      mockedUpdateSet.mockResolvedValue({ id: 'ps1' })

      const result = await tools.get('update_program_set')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 1,
        setNumber: 3,
        repMin: 8,
        repMax: 10,
      })

      expect(mockedGetUnit).not.toHaveBeenCalled()
      expect(mockedUpdateSet).toHaveBeenCalledWith('user_env', PID, 0, 1, 3, {
        repMin: 8,
        repMax: 10,
      })
      expect(payload(result)).not.toHaveProperty('unit')
    })

    it('update_program_set passes an explicit null through as a clear without a unit fetch', async () => {
      const tools = setup()
      mockedUpdateSet.mockResolvedValue({ id: 'ps1' })

      await tools.get('update_program_set')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        setNumber: 1,
        suggestedLoad: null,
      })

      expect(mockedGetUnit).not.toHaveBeenCalled()
      expect(mockedUpdateSet).toHaveBeenCalledWith('user_env', PID, 0, 0, 1, {
        suggestedLoadKg: null,
      })
    })

    it('update_program_set with an explicit unit skips the stored-unit lookup', async () => {
      const tools = setup()
      mockedUpdateSet.mockResolvedValue({ id: 'ps1' })

      await tools.get('update_program_set')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        setNumber: 1,
        suggestedLoad: 100,
        unit: 'kg',
      })

      expect(mockedGetUnit).not.toHaveBeenCalled()
      expect(mockedUpdateSet).toHaveBeenCalledWith('user_env', PID, 0, 0, 1, {
        suggestedLoadKg: 100,
      })
    })

    it('add_program_set forwards restSec verbatim — seconds are unit-less, no unit fetch', async () => {
      // Arrange
      const tools = setup()
      mockedAddSet.mockResolvedValue({ setNumber: 2 })

      // Act
      await tools.get('add_program_set')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        restSec: 90,
      })

      // Assert
      expect(mockedGetUnit).not.toHaveBeenCalled()
      expect(mockedAddSet).toHaveBeenCalledWith('user_env', PID, 0, 0, { restSec: 90 })
    })

    it('update_program_set passes restSec through, and null clears it', async () => {
      // Arrange
      const tools = setup()
      mockedUpdateSet.mockResolvedValue({ id: 'ps1' })

      // Act — set, then clear
      await tools.get('update_program_set')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        setNumber: 1,
        restSec: 120,
      })
      await tools.get('update_program_set')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        setNumber: 1,
        restSec: null,
      })

      // Assert
      expect(mockedGetUnit).not.toHaveBeenCalled()
      expect(mockedUpdateSet).toHaveBeenNthCalledWith(1, 'user_env', PID, 0, 0, 1, { restSec: 120 })
      expect(mockedUpdateSet).toHaveBeenNthCalledWith(2, 'user_env', PID, 0, 0, 1, { restSec: null })
    })

    it('update_program_set errors on an empty patch before any unit fetch or op', async () => {
      const tools = setup()

      const result = await tools.get('update_program_set')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        setNumber: 1,
      })

      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/at least one/i)
      expect(mockedGetUnit).not.toHaveBeenCalled()
      expect(mockedUpdateSet).not.toHaveBeenCalled()
    })

    it('update_program_set rejects an over-max suggestedLoad with the bound in lb', async () => {
      const tools = setup()

      const result = await tools.get('update_program_set')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        setNumber: 1,
        suggestedLoad: 1_000_000,
      })

      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/lb/)
      expect(mockedUpdateSet).not.toHaveBeenCalled()
    })

    it('surfaces a ProgramPatchError message verbatim', async () => {
      const tools = setup()
      mockedRemoveSet.mockRejectedValue(
        new ProgramPatchError('an exercise needs at least one set — remove the exercise instead'),
      )

      const result = await tools.get('remove_program_set')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        setNumber: 1,
      })

      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toBe(
        'an exercise needs at least one set — remove the exercise instead',
      )
    })

    it('remove_program_set removes and echoes the removed set number', async () => {
      const tools = setup()
      mockedRemoveSet.mockResolvedValue({ removed: true })

      const result = await tools.get('remove_program_set')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        setNumber: 2,
      })

      expect(mockedRemoveSet).toHaveBeenCalledWith('user_env', PID, 0, 0, 2)
      expect(payload(result)).toEqual({
        userId: 'user_env',
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        removedSetNumber: 2,
      })
    })

    it('move_program_set moves and echoes from/to', async () => {
      const tools = setup()
      mockedMoveSet.mockResolvedValue({ moved: true })

      const result = await tools.get('move_program_set')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        from: 1,
        to: 3,
      })

      expect(mockedMoveSet).toHaveBeenCalledWith('user_env', PID, 0, 0, 1, 3)
      expect(payload(result)).toEqual({
        userId: 'user_env',
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        from: 1,
        to: 3,
      })
    })

    it('genericizes an unexpected db error instead of leaking it', async () => {
      const tools = setup()
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockedUpdateSet.mockRejectedValue(new Error('connect ECONNREFUSED db.internal:5432'))

      const result = await tools.get('update_program_set')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        setNumber: 1,
        repMin: 5,
      })

      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toBe('MCP tool failed')
      spy.mockRestore()
    })
  })

  it('surfaces not-found for a malformed programId without hitting the db', async () => {
    const tools = setup()

    const result = await tools.get('update_program_set')!({
      programId: 'not-a-uuid',
      dayPosition: 0,
      exercisePosition: 0,
      setNumber: 1,
      repMin: 5,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/not found/)
    expect(mockedUpdateSet).not.toHaveBeenCalled()
  })

  // Each patch tool gates on a resolved user before touching the db.
  describe('no-user gate', () => {
    const cases = [
      { name: 'add_program_day', args: { programId: PID, name: 'Push' } },
      { name: 'update_program_day', args: { programId: PID, dayPosition: 0, name: 'X' } },
      { name: 'remove_program_day', args: { programId: PID, dayPosition: 0 } },
      { name: 'move_program_day', args: { programId: PID, from: 0, to: 1 } },
      {
        name: 'add_program_exercise',
        args: { programId: PID, dayPosition: 0, wgerExerciseId: 1, name: 'Bench' },
      },
      {
        name: 'update_program_exercise',
        args: { programId: PID, dayPosition: 0, exercisePosition: 0, name: 'X' },
      },
      {
        name: 'remove_program_exercise',
        args: { programId: PID, dayPosition: 0, exercisePosition: 0 },
      },
      {
        name: 'move_program_exercise',
        args: { programId: PID, dayPosition: 0, from: 0, to: 1 },
      },
      {
        name: 'add_program_set',
        args: { programId: PID, dayPosition: 0, exercisePosition: 0 },
      },
      {
        name: 'update_program_set',
        args: { programId: PID, dayPosition: 0, exercisePosition: 0, setNumber: 1, repMin: 5 },
      },
      {
        name: 'remove_program_set',
        args: { programId: PID, dayPosition: 0, exercisePosition: 0, setNumber: 1 },
      },
      {
        name: 'move_program_set',
        args: { programId: PID, dayPosition: 0, exercisePosition: 0, from: 1, to: 2 },
      },
    ] as const

    it.each(cases)(
      '$name returns isError /userId/ when no user resolves',
      async ({ name, args }) => {
        // Arrange — no arg, no env
        delete process.env.MCP_DEV_USER_ID
        const tools = setup()

        // Act
        const result = await tools.get(name)!(args)

        // Assert
        expect(result.isError).toBe(true)
        expect(result.content[0]?.text).toMatch(/userId/)
      },
    )
  })

  describe('override tools (Phase 5)', () => {
    it('set_program_set_override converts the load lazily and echoes the pin', async () => {
      // Arrange
      const tools = setup()
      mockedGetUnit.mockResolvedValue('lb')
      mockedSetOverride.mockResolvedValue({ week: 3, cleared: false })

      // Act
      const result = await tools.get('set_program_set_override')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 1,
        setNumber: 2,
        week: 3,
        suggestedLoad: 225,
        repMin: 3,
      })

      // Assert — display lb → canonical kg; unit echoed
      expect(mockedSetOverride).toHaveBeenCalledWith('user_env', PID, 0, 1, 2, 3, {
        suggestedLoadKg: displayToKg(225, 'lb'),
        repMin: 3,
      })
      expect(payload(result)).toEqual({
        userId: 'user_env',
        unit: 'lb',
        programId: PID,
        dayPosition: 0,
        exercisePosition: 1,
        setNumber: 2,
        week: 3,
        cleared: false,
      })
    })

    it('set_program_set_override skips the unit read when no load is pinned', async () => {
      // Arrange
      const tools = setup()
      mockedSetOverride.mockResolvedValue({ week: 2, cleared: false })

      // Act
      const result = await tools.get('set_program_set_override')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        setNumber: 1,
        week: 2,
        rir: 1,
      })

      // Assert
      expect(mockedGetUnit).not.toHaveBeenCalled()
      expect(payload(result).unit).toBeUndefined()
      expect(mockedSetOverride).toHaveBeenCalledWith('user_env', PID, 0, 0, 1, 2, { rir: 1 })
    })

    it('set_program_set_override pins restSec for a week and null unpins it', async () => {
      // Arrange
      const tools = setup()
      mockedSetOverride.mockResolvedValue({ week: 2, cleared: false })

      // Act — pin, then unpin
      await tools.get('set_program_set_override')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        setNumber: 1,
        week: 2,
        restSec: 150,
      })
      await tools.get('set_program_set_override')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        setNumber: 1,
        week: 2,
        restSec: null,
      })

      // Assert — unit never read: rest is seconds, not weight
      expect(mockedGetUnit).not.toHaveBeenCalled()
      expect(mockedSetOverride).toHaveBeenNthCalledWith(1, 'user_env', PID, 0, 0, 1, 2, {
        restSec: 150,
      })
      expect(mockedSetOverride).toHaveBeenNthCalledWith(2, 'user_env', PID, 0, 0, 1, 2, {
        restSec: null,
      })
    })

    it('set_program_set_override rejects an all-undefined patch before any db call', async () => {
      // Arrange
      const tools = setup()

      // Act
      const result = await tools.get('set_program_set_override')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        setNumber: 1,
        week: 2,
      })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/at least one field/)
      expect(mockedSetOverride).not.toHaveBeenCalled()
    })

    it('set_program_set_override surfaces a ProgramPatchError message verbatim', async () => {
      // Arrange — merge broke the cross-field rules
      const tools = setup()
      mockedSetOverride.mockRejectedValue(
        new ProgramPatchError('repMin must be less than or equal to repMax'),
      )

      // Act
      const result = await tools.get('set_program_set_override')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 0,
        setNumber: 1,
        week: 2,
        repMin: 20,
      })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/repMin must be less than or equal to repMax/)
    })

    it('remove_program_set_override deletes the pin and echoes the week', async () => {
      // Arrange
      const tools = setup()
      mockedRemoveOverride.mockResolvedValue({ removed: true })

      // Act
      const result = await tools.get('remove_program_set_override')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 1,
        setNumber: 2,
        week: 3,
      })

      // Assert
      expect(mockedRemoveOverride).toHaveBeenCalledWith('user_env', PID, 0, 1, 2, 3)
      expect(payload(result)).toEqual({
        userId: 'user_env',
        programId: PID,
        dayPosition: 0,
        exercisePosition: 1,
        setNumber: 2,
        removedWeek: 3,
      })
    })

    it('remove_program_set_override reports not-found when no override exists', async () => {
      // Arrange
      const tools = setup()
      mockedRemoveOverride.mockResolvedValue(null)

      // Act
      const result = await tools.get('remove_program_set_override')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 1,
        setNumber: 2,
        week: 3,
      })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/override/)
    })

    it('update_program_exercise accepts a lone supersetGroup patch', async () => {
      // Arrange
      const tools = setup()
      mockedUpdateExercise.mockResolvedValue({ id: 'pe1' })

      // Act
      const result = await tools.get('update_program_exercise')!({
        programId: PID,
        dayPosition: 0,
        exercisePosition: 1,
        supersetGroup: 2,
      })

      // Assert
      expect(mockedUpdateExercise).toHaveBeenCalledWith('user_env', PID, 0, 1, {
        wgerExerciseId: undefined,
        name: undefined,
        progression: undefined,
        supersetGroup: 2,
      })
      expect(payload(result)).toEqual({
        userId: 'user_env',
        programId: PID,
        dayPosition: 0,
        exercisePosition: 1,
      })
    })
  })
})
