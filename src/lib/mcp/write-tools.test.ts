import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

vi.mock('@/db/workouts', () => ({
  saveWorkout: vi.fn(),
  updateWorkout: vi.fn(),
  deleteWorkout: vi.fn(),
}))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn(), setWeightUnit: vi.fn() }))

import { registerWriteTools } from './write-tools'
import { saveWorkout, updateWorkout, deleteWorkout } from '@/db/workouts'
import { getWeightUnit, setWeightUnit } from '@/db/preferences'
import { displayToKg, kgToDisplay } from '@/lib/units'
import { MAX_WEIGHT as MAX_WEIGHT_KG } from '@/lib/workout-input'

const mockedSave = vi.mocked(saveWorkout)
const mockedUpdate = vi.mocked(updateWorkout)
const mockedDelete = vi.mocked(deleteWorkout)
const mockedGetUnit = vi.mocked(getWeightUnit)
const mockedSetUnit = vi.mocked(setWeightUnit)

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean }
/** Auth context an MCP tool handler receives as its 2nd arg (the bits we read). */
type Extra = { authInfo?: { extra?: { userId?: unknown } } }
type ToolHandler = (args: Record<string, unknown>, extra?: Extra) => Promise<ToolResult>

/**
 * Minimal stand-in for an McpServer that records registerTool(name, _config, handler)
 * calls, so a test can assert the registered tool set and invoke each handler directly.
 */
function fakeServer(): { server: McpServer; tools: Map<string, ToolHandler> } {
  const tools = new Map<string, ToolHandler>()
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  }
  return { server: server as unknown as McpServer, tools }
}

/** Registers the write tools on a fresh fake server and returns the handler map. */
function setup(): Map<string, ToolHandler> {
  const { server, tools } = fakeServer()
  registerWriteTools(server)
  return tools
}

/** Parses the JSON text payload of a (success) tool result. */
function payload(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text)
}

/** A valid one-exercise body: one scorable set (220.5) and one blank set. */
const BODY = {
  exercises: [
    { wgerExerciseId: 1, name: 'Bench', sets: [{ reps: 5, weight: 220.5 }, { reps: null, weight: null }] },
  ],
}

describe('registerWriteTools', () => {
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

  it('registers exactly the four write tools', () => {
    // Arrange + Act
    const tools = setup()

    // Assert
    expect([...tools.keys()].sort()).toEqual([
      'create_workout',
      'delete_workout',
      'set_weight_unit',
      'update_workout',
    ])
  })

  describe('create_workout', () => {
    it('converts display weights to kg with the stored unit and echoes userId/unit/workoutId', async () => {
      // Arrange
      const tools = setup()
      mockedSave.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })

      // Act
      const result = await tools.get('create_workout')!(BODY)

      // Assert
      expect(mockedGetUnit).toHaveBeenCalledWith('user_env')
      expect(mockedSave).toHaveBeenCalledWith(
        'user_env',
        expect.objectContaining({
          exercises: [
            expect.objectContaining({
              sets: [
                { reps: 5, weight: displayToKg(220.5, 'lb') },
                { reps: null, weight: null },
              ],
            }),
          ],
        }),
      )
      expect(payload(result)).toEqual({ userId: 'user_env', unit: 'lb', workoutId: '11111111-1111-4111-8111-111111111111' })
    })

    it('acts as the authenticated user, ignoring a conflicting userId arg (no impersonation)', async () => {
      // Arrange — token user differs from the arg-supplied id and the env default
      const tools = setup()
      mockedSave.mockResolvedValue({ id: 'w1' })

      // Act
      const result = await tools.get('create_workout')!(
        { ...BODY, userId: 'user_arg' },
        { authInfo: { extra: { userId: 'user_token' } } },
      )

      // Assert — the token wins everywhere the resolved id surfaces
      expect(mockedGetUnit).toHaveBeenCalledWith('user_token')
      expect(mockedSave).toHaveBeenCalledWith('user_token', expect.anything())
      expect(payload(result).userId).toBe('user_token')
    })

    it('uses an explicit unit:kg without converting and without reading the stored unit', async () => {
      // Arrange
      const tools = setup()
      mockedSave.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })

      // Act
      const result = await tools.get('create_workout')!({ ...BODY, unit: 'kg' })

      // Assert
      expect(mockedGetUnit).not.toHaveBeenCalled()
      expect(mockedSave).toHaveBeenCalledWith(
        'user_env',
        expect.objectContaining({
          exercises: [
            expect.objectContaining({
              sets: [
                { reps: 5, weight: 220.5 },
                { reps: null, weight: null },
              ],
            }),
          ],
        }),
      )
      expect(payload(result)).toEqual({ userId: 'user_env', unit: 'kg', workoutId: '11111111-1111-4111-8111-111111111111' })
    })

    it('rejects an over-max weight with the bound stated in the agent unit (lb) and never saves', async () => {
      // Arrange — stored unit is lb (beforeEach), so the basis is lb
      const tools = setup()
      const maxLb = kgToDisplay(MAX_WEIGHT_KG, 'lb')
      const overMaxLb = maxLb + 1

      // Act
      const result = await tools.get('create_workout')!({
        exercises: [{ wgerExerciseId: 1, name: 'Bench', sets: [{ reps: 1, weight: overMaxLb }] }],
      })

      // Assert — the message names the lb bound, not the canonical kg one
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain(`${maxLb} lb`)
      expect(result.content[0]?.text).not.toContain('kg')
      expect(mockedSave).not.toHaveBeenCalled()
    })

    it('states the kg bound when the basis is kg', async () => {
      // Arrange
      const tools = setup()

      // Act — explicit kg basis, weight just over the kg ceiling
      const result = await tools.get('create_workout')!({
        unit: 'kg',
        exercises: [
          { wgerExerciseId: 1, name: 'Bench', sets: [{ reps: 1, weight: MAX_WEIGHT_KG + 1 }] },
        ],
      })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain(`${MAX_WEIGHT_KG} kg`)
      expect(mockedSave).not.toHaveBeenCalled()
    })

    it('passes workout notes and per-exercise notes/skipped through to saveWorkout', async () => {
      // Arrange
      const tools = setup()
      mockedSave.mockResolvedValue({ id: 'w1' })

      // Act
      await tools.get('create_workout')!({
        notes: '  great session  ',
        exercises: [
          {
            wgerExerciseId: 1,
            name: 'Bench',
            notes: 'shoulder twinge on set 1',
            skipped: true,
            sets: [{ reps: null, weight: null }],
          },
        ],
      })

      // Assert — validated through parseWorkoutInput: notes trimmed, skipped verbatim
      expect(mockedSave).toHaveBeenCalledWith(
        'user_env',
        expect.objectContaining({
          notes: 'great session',
          exercises: [
            expect.objectContaining({ notes: 'shoulder twinge on set 1', skipped: true }),
          ],
        }),
      )
    })

    it('rejects over-long workout notes (>2000 chars) and never saves', async () => {
      // Arrange
      const tools = setup()

      // Act
      const result = await tools.get('create_workout')!({ ...BODY, notes: 'x'.repeat(2001) })

      // Assert — parseWorkoutInput's reject-don't-truncate rule surfaces verbatim
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/2000 characters or fewer/)
      expect(mockedSave).not.toHaveBeenCalled()
    })

    it('rejects a non-boolean skipped (a truthy string must not mark work skipped)', async () => {
      // Arrange
      const tools = setup()

      // Act
      const result = await tools.get('create_workout')!({
        exercises: [
          { wgerExerciseId: 1, name: 'Bench', skipped: 'yes', sets: [{ reps: null, weight: null }] },
        ],
      })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/skipped must be a boolean/)
      expect(mockedSave).not.toHaveBeenCalled()
    })

    it('persists a backdated startedAt as a Date passed to saveWorkout', async () => {
      // Arrange
      const tools = setup()
      mockedSave.mockResolvedValue({ id: 'w1' })
      const when = '2026-01-02T00:00:00.000Z'

      // Act
      await tools.get('create_workout')!({ ...BODY, startedAt: when })

      // Assert
      expect(mockedSave).toHaveBeenCalledWith(
        'user_env',
        expect.objectContaining({ startedAt: new Date(when) }),
      )
    })

    it('rejects a future startedAt with /future/ and never saves', async () => {
      // Arrange
      const tools = setup()
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      // Act
      const result = await tools.get('create_workout')!({ ...BODY, startedAt: future })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/future/i)
      expect(mockedSave).not.toHaveBeenCalled()
    })

    it('rejects invalid input as a surfaced ToolError and never calls saveWorkout', async () => {
      // Arrange
      const tools = setup()

      // Act
      const result = await tools.get('create_workout')!({ exercises: [] })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/at least one exercise/)
      expect(mockedSave).not.toHaveBeenCalled()
    })

    it('returns a generic isError and logs (no internals leaked) when the db rejects', async () => {
      // Arrange
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const tools = setup()
      mockedSave.mockRejectedValue(new Error('db down: secret-host:5432'))

      // Act
      const result = await tools.get('create_workout')!(BODY)

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toBe('MCP tool failed')
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })

    it('returns isError matching /userId/ and never saves when no user resolves', async () => {
      // Arrange
      delete process.env.MCP_DEV_USER_ID
      const tools = setup()

      // Act
      const result = await tools.get('create_workout')!(BODY)

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/userId/)
      expect(mockedSave).not.toHaveBeenCalled()
    })
  })

  describe('update_workout', () => {
    it('converts and replaces the workout, echoing the affected workoutId', async () => {
      // Arrange
      const tools = setup()
      mockedUpdate.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })

      // Act
      const result = await tools.get('update_workout')!({ id: '11111111-1111-4111-8111-111111111111', ...BODY })

      // Assert
      expect(mockedUpdate).toHaveBeenCalledWith(
        'user_env',
        '11111111-1111-4111-8111-111111111111',
        expect.objectContaining({
          exercises: [
            expect.objectContaining({
              sets: [
                { reps: 5, weight: displayToKg(220.5, 'lb') },
                { reps: null, weight: null },
              ],
            }),
          ],
        }),
      )
      expect(payload(result)).toEqual({ userId: 'user_env', unit: 'lb', workoutId: '11111111-1111-4111-8111-111111111111' })
    })

    it('returns isError matching /not found/ when the workout is not owned', async () => {
      // Arrange
      const tools = setup()
      mockedUpdate.mockResolvedValue(null)

      // Act
      const result = await tools.get('update_workout')!({ id: '11111111-1111-4111-8111-111111111111', ...BODY })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
    })

    it('surfaces not-found for a malformed (non-UUID) id without hitting the db', async () => {
      // Arrange
      const tools = setup()

      // Act
      const result = await tools.get('update_workout')!({ id: 'not-a-uuid', ...BODY })

      // Assert — the uuid-shape guard short-circuits before updateWorkout
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
      expect(mockedUpdate).not.toHaveBeenCalled()
    })
  })

  describe('delete_workout', () => {
    it('deletes an owned workout and reports deleted:true', async () => {
      // Arrange
      const tools = setup()
      mockedDelete.mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111' }])

      // Act
      const result = await tools.get('delete_workout')!({ id: '11111111-1111-4111-8111-111111111111' })

      // Assert
      expect(mockedDelete).toHaveBeenCalledWith('user_env', '11111111-1111-4111-8111-111111111111')
      expect(payload(result)).toEqual({ userId: 'user_env', workoutId: '11111111-1111-4111-8111-111111111111', deleted: true })
    })

    it('returns isError matching /not found/ when nothing was deleted', async () => {
      // Arrange
      const tools = setup()
      mockedDelete.mockResolvedValue([])

      // Act
      const result = await tools.get('delete_workout')!({ id: '11111111-1111-4111-8111-111111111111' })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
    })

    it('surfaces not-found for a malformed (non-UUID) id without hitting the db', async () => {
      // Arrange
      const tools = setup()

      // Act
      const result = await tools.get('delete_workout')!({ id: 'not-a-uuid' })

      // Assert — guard short-circuits before deleteWorkout
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
      expect(mockedDelete).not.toHaveBeenCalled()
    })
  })

  describe('set_weight_unit', () => {
    it('upserts the unit and echoes the resolved userId and unit', async () => {
      // Arrange
      const tools = setup()
      mockedSetUnit.mockResolvedValue()

      // Act
      const result = await tools.get('set_weight_unit')!({ unit: 'kg' })

      // Assert
      expect(mockedSetUnit).toHaveBeenCalledWith('user_env', 'kg')
      expect(payload(result)).toEqual({ userId: 'user_env', unit: 'kg' })
    })
  })

  // Every write handler gates on a resolved user before touching the db; assert
  // the no-user path for each so the authorization contract is explicit.
  describe('no-user gate (all write tools)', () => {
    const cases = [
      { name: 'update_workout', args: { id: '11111111-1111-4111-8111-111111111111', ...BODY }, dep: mockedUpdate as unknown as Mock },
      { name: 'delete_workout', args: { id: '11111111-1111-4111-8111-111111111111' }, dep: mockedDelete as unknown as Mock },
      { name: 'set_weight_unit', args: { unit: 'kg' }, dep: mockedSetUnit as unknown as Mock },
    ] as const

    it.each(cases)(
      '$name returns isError /userId/ and never touches the db when no user resolves',
      async ({ name, args, dep }) => {
        // Arrange — no arg, no env
        delete process.env.MCP_DEV_USER_ID
        const tools = setup()

        // Act
        const result = await tools.get(name)!(args)

        // Assert
        expect(result.isError).toBe(true)
        expect(result.content[0]?.text).toMatch(/userId/)
        expect(dep).not.toHaveBeenCalled()
      },
    )
  })
})
