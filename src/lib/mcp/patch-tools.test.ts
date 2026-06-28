import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

vi.mock('@/db/workouts', () => ({
  updateSet: vi.fn(),
  addSet: vi.fn(),
  removeSet: vi.fn(),
  updateWorkoutMeta: vi.fn(),
}))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn() }))

import { registerPatchTools } from './patch-tools'
import { updateSet, addSet, removeSet, updateWorkoutMeta } from '@/db/workouts'
import { getWeightUnit } from '@/db/preferences'
import { displayToKg } from '@/lib/units'

const mockedUpdateSet = vi.mocked(updateSet)
const mockedAddSet = vi.mocked(addSet)
const mockedRemoveSet = vi.mocked(removeSet)
const mockedUpdateMeta = vi.mocked(updateWorkoutMeta)
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
  registerPatchTools(server)
  return tools
}

function payload(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text)
}

const WID = '11111111-1111-4111-8111-111111111111'

describe('registerPatchTools', () => {
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

  it('registers exactly the four patch tools', () => {
    expect([...setup().keys()].sort()).toEqual(['add_set', 'remove_set', 'set_workout_meta', 'update_set'])
  })

  describe('update_set', () => {
    it('converts the weight with the stored unit and patches only the target set', async () => {
      // Arrange
      const tools = setup()
      mockedUpdateSet.mockResolvedValue({ id: 's1' })

      // Act
      const result = await tools.get('update_set')!({
        workoutId: WID,
        exercisePosition: 0,
        setNumber: 3,
        reps: 5,
        weight: 225,
      })

      // Assert
      expect(mockedUpdateSet).toHaveBeenCalledWith('user_env', WID, 0, 3, {
        reps: 5,
        weight: displayToKg(225, 'lb'),
      })
      expect(payload(result)).toEqual({
        userId: 'user_env',
        unit: 'lb',
        workoutId: WID,
        exercisePosition: 0,
        setNumber: 3,
      })
    })

    it('does not read the stored unit for a reps-only update', async () => {
      // Arrange
      const tools = setup()
      mockedUpdateSet.mockResolvedValue({ id: 's1' })

      // Act
      const result = await tools.get('update_set')!({
        workoutId: WID,
        exercisePosition: 1,
        setNumber: 2,
        reps: 8,
      })

      // Assert — no weight → no unit lookup, no unit echoed
      expect(mockedGetUnit).not.toHaveBeenCalled()
      expect(mockedUpdateSet).toHaveBeenCalledWith('user_env', WID, 1, 2, { reps: 8 })
      expect(payload(result)).not.toHaveProperty('unit')
    })

    it('errors when neither reps nor weight is given, without touching the db', async () => {
      // Arrange
      const tools = setup()

      // Act
      const result = await tools.get('update_set')!({ workoutId: WID, exercisePosition: 0, setNumber: 1 })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/at least one/i)
      expect(mockedUpdateSet).not.toHaveBeenCalled()
    })

    it('surfaces not-found when the set/exercise/workout is not owned', async () => {
      // Arrange
      const tools = setup()
      mockedUpdateSet.mockResolvedValue(null)

      // Act
      const result = await tools.get('update_set')!({
        workoutId: WID,
        exercisePosition: 0,
        setNumber: 9,
        reps: 5,
      })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
    })

    it('surfaces not-found for a malformed workout id without hitting the db', async () => {
      // Arrange
      const tools = setup()

      // Act
      const result = await tools.get('update_set')!({
        workoutId: 'not-a-uuid',
        exercisePosition: 0,
        setNumber: 1,
        reps: 5,
      })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
      expect(mockedUpdateSet).not.toHaveBeenCalled()
    })

    it('acts as the authenticated user, ignoring a conflicting userId arg', async () => {
      // Arrange
      const tools = setup()
      mockedUpdateSet.mockResolvedValue({ id: 's1' })

      // Act
      const result = await tools.get('update_set')!(
        { workoutId: WID, exercisePosition: 0, setNumber: 1, reps: 5, userId: 'user_arg' },
        { authInfo: { extra: { userId: 'user_token' } } },
      )

      // Assert
      expect(mockedUpdateSet).toHaveBeenCalledWith('user_token', WID, 0, 1, { reps: 5 })
      expect(payload(result).userId).toBe('user_token')
    })
  })

  describe('add_set', () => {
    it('appends a set with blank defaults and returns the new set number', async () => {
      // Arrange
      const tools = setup()
      mockedAddSet.mockResolvedValue({ setNumber: 4 })

      // Act
      const result = await tools.get('add_set')!({ workoutId: WID, exercisePosition: 0 })

      // Assert
      expect(mockedAddSet).toHaveBeenCalledWith('user_env', WID, 0, { reps: null, weight: null })
      expect(payload(result)).toMatchObject({ workoutId: WID, exercisePosition: 0, setNumber: 4 })
    })

    it('converts a provided weight with the stored unit', async () => {
      // Arrange
      const tools = setup()
      mockedAddSet.mockResolvedValue({ setNumber: 2 })

      // Act
      await tools.get('add_set')!({ workoutId: WID, exercisePosition: 0, reps: 5, weight: 135 })

      // Assert
      expect(mockedAddSet).toHaveBeenCalledWith('user_env', WID, 0, {
        reps: 5,
        weight: displayToKg(135, 'lb'),
      })
    })

    it('surfaces not-found when the exercise is not owned', async () => {
      // Arrange
      const tools = setup()
      mockedAddSet.mockResolvedValue(null)

      // Act
      const result = await tools.get('add_set')!({ workoutId: WID, exercisePosition: 5 })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
    })
  })

  describe('remove_set', () => {
    it('removes the set and echoes the removed set number', async () => {
      // Arrange
      const tools = setup()
      mockedRemoveSet.mockResolvedValue({ removed: true })

      // Act
      const result = await tools.get('remove_set')!({ workoutId: WID, exercisePosition: 0, setNumber: 2 })

      // Assert
      expect(mockedRemoveSet).toHaveBeenCalledWith('user_env', WID, 0, 2)
      expect(payload(result)).toEqual({
        userId: 'user_env',
        workoutId: WID,
        exercisePosition: 0,
        removedSetNumber: 2,
      })
    })

    it('surfaces not-found when the set does not exist', async () => {
      // Arrange
      const tools = setup()
      mockedRemoveSet.mockResolvedValue(null)

      // Act
      const result = await tools.get('remove_set')!({ workoutId: WID, exercisePosition: 0, setNumber: 9 })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
    })
  })

  describe('set_workout_meta', () => {
    it('renames the workout', async () => {
      // Arrange
      const tools = setup()
      mockedUpdateMeta.mockResolvedValue({ id: WID })

      // Act
      const result = await tools.get('set_workout_meta')!({ workoutId: WID, name: '  Leg Day  ' })

      // Assert — trimmed name, no startedAt
      expect(mockedUpdateMeta).toHaveBeenCalledWith('user_env', WID, { name: 'Leg Day' })
      expect(payload(result)).toEqual({ userId: 'user_env', workoutId: WID })
    })

    it('backdates with a parsed Date', async () => {
      // Arrange
      const tools = setup()
      mockedUpdateMeta.mockResolvedValue({ id: WID })
      const when = '2026-01-02T00:00:00.000Z'

      // Act
      await tools.get('set_workout_meta')!({ workoutId: WID, startedAt: when })

      // Assert
      expect(mockedUpdateMeta).toHaveBeenCalledWith('user_env', WID, { startedAt: new Date(when) })
    })

    it('rejects a future startedAt without touching the db', async () => {
      // Arrange
      const tools = setup()
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      // Act
      const result = await tools.get('set_workout_meta')!({ workoutId: WID, startedAt: future })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/future/i)
      expect(mockedUpdateMeta).not.toHaveBeenCalled()
    })

    it('errors when neither name nor startedAt is given', async () => {
      // Arrange
      const tools = setup()

      // Act
      const result = await tools.get('set_workout_meta')!({ workoutId: WID })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/at least one/i)
      expect(mockedUpdateMeta).not.toHaveBeenCalled()
    })

    it('surfaces not-found when the workout is not owned', async () => {
      // Arrange
      const tools = setup()
      mockedUpdateMeta.mockResolvedValue(null)

      // Act
      const result = await tools.get('set_workout_meta')!({ workoutId: WID, name: 'X' })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
    })
  })

  // Each patch tool gates on a resolved user before touching the db.
  describe('no-user gate', () => {
    const cases = [
      { name: 'update_set', args: { workoutId: WID, exercisePosition: 0, setNumber: 1, reps: 5 } },
      { name: 'add_set', args: { workoutId: WID, exercisePosition: 0 } },
      { name: 'remove_set', args: { workoutId: WID, exercisePosition: 0, setNumber: 1 } },
      { name: 'set_workout_meta', args: { workoutId: WID, name: 'X' } },
    ] as const

    it.each(cases)('$name returns isError /userId/ when no user resolves', async ({ name, args }) => {
      // Arrange — no arg, no env
      delete process.env.MCP_DEV_USER_ID
      const tools = setup()

      // Act
      const result = await tools.get(name)!(args)

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/userId/)
    })
  })
})
