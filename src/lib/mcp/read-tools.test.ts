import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

vi.mock('@/db/workouts', () => ({
  listWorkoutSummaries: vi.fn(),
  getWorkoutDetail: vi.fn(),
  getLastPerformance: vi.fn(),
}))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn() }))
vi.mock('@/lib/wger', () => ({ searchExercises: vi.fn() }))

import { registerReadTools } from './read-tools'
import { listWorkoutSummaries, getWorkoutDetail, getLastPerformance } from '@/db/workouts'
import { getWeightUnit } from '@/db/preferences'
import { searchExercises } from '@/lib/wger'
import { kgToDisplay } from '@/lib/units'
import { estimate1RM } from '@/lib/one-rep-max'

const mockedList = vi.mocked(listWorkoutSummaries)
const mockedDetail = vi.mocked(getWorkoutDetail)
const mockedLast = vi.mocked(getLastPerformance)
const mockedUnit = vi.mocked(getWeightUnit)
const mockedSearch = vi.mocked(searchExercises)

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean }
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>

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

/** Registers the read tools on a fresh fake server and returns the handler map. */
function setup(): Map<string, ToolHandler> {
  const { server, tools } = fakeServer()
  registerReadTools(server)
  return tools
}

/** Parses the JSON text payload of a (success) tool result. */
function payload(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text)
}

describe('registerReadTools', () => {
  const original = process.env.MCP_DEV_USER_ID
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MCP_DEV_USER_ID = 'user_env'
    mockedUnit.mockResolvedValue('lb')
  })
  afterEach(() => {
    if (original === undefined) delete process.env.MCP_DEV_USER_ID
    else process.env.MCP_DEV_USER_ID = original
  })

  it('registers exactly the five read tools', () => {
    // Arrange + Act
    const tools = setup()

    // Assert
    expect([...tools.keys()].sort()).toEqual([
      'get_last_performance',
      'get_weight_unit',
      'get_workout',
      'list_workouts',
      'search_exercises',
    ])
  })

  describe('list_workouts', () => {
    it('maps summaries with ISO startedAt and echoes the resolved userId', async () => {
      // Arrange
      const tools = setup()
      mockedList.mockResolvedValue([
        {
          id: 'w1',
          name: 'Push Day',
          startedAt: new Date('2026-06-01T10:00:00.000Z'),
          exerciseCount: 3,
          setCount: 9,
        },
      ])

      // Act
      const result = await tools.get('list_workouts')!({})

      // Assert
      expect(mockedList).toHaveBeenCalledWith('user_env')
      expect(payload(result)).toEqual({
        userId: 'user_env',
        workouts: [
          {
            id: 'w1',
            name: 'Push Day',
            startedAt: '2026-06-01T10:00:00.000Z',
            exerciseCount: 3,
            setCount: 9,
          },
        ],
      })
    })

    it('prefers an explicit userId argument over the env default', async () => {
      // Arrange
      const tools = setup()
      mockedList.mockResolvedValue([])

      // Act
      await tools.get('list_workouts')!({ userId: 'user_arg' })

      // Assert
      expect(mockedList).toHaveBeenCalledWith('user_arg')
    })

    it('returns a generic isError and logs (no internals leaked) when the db rejects', async () => {
      // Arrange
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const tools = setup()
      mockedList.mockRejectedValue(new Error('db down: secret-host:5432'))

      // Act
      const result = await tools.get('list_workouts')!({})

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toBe('MCP tool failed')
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })

    it('returns isError matching /userId/ and never queries when no user resolves', async () => {
      // Arrange
      delete process.env.MCP_DEV_USER_ID
      const tools = setup()

      // Act
      const result = await tools.get('list_workouts')!({})

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/userId/)
      expect(mockedList).not.toHaveBeenCalled()
    })
  })

  describe('get_workout', () => {
    /** A one-exercise workout: one scorable set (5 reps @ 100 kg) and one blank set. */
    function detail() {
      return {
        id: 'w1',
        name: 'Leg Day',
        startedAt: new Date('2026-06-02T08:00:00.000Z'),
        userId: 'user_env',
        exercises: [
          {
            id: 'we1',
            wgerExerciseId: 73,
            name: 'Squat',
            position: 0,
            sets: [
              { setNumber: 1, reps: 5, weight: 100 },
              { setNumber: 2, reps: null, weight: null },
            ],
          },
        ],
      }
    }

    it('converts kg to lb, passes null reps/weight through, and includes estimated1RM', async () => {
      // Arrange
      const tools = setup()
      mockedDetail.mockResolvedValue(
        detail() as unknown as Awaited<ReturnType<typeof getWorkoutDetail>>,
      )

      // Act
      const result = await tools.get('get_workout')!({ id: 'w1' })

      // Assert
      const body = payload(result) as {
        userId: string
        unit: string
        workout: {
          startedAt: string
          exercises: {
            sets: { weight: number | null; reps: number | null }[]
            estimated1RM: number | null
          }[]
        }
      }
      expect(body.userId).toBe('user_env')
      expect(body.unit).toBe('lb')
      expect(body.workout.startedAt).toBe('2026-06-02T08:00:00.000Z')
      const ex = body.workout.exercises[0]!
      expect(ex.sets[0]!.weight).toBe(kgToDisplay(100, 'lb'))
      expect(ex.sets[0]!.reps).toBe(5)
      expect(ex.sets[1]!.weight).toBeNull()
      expect(ex.sets[1]!.reps).toBeNull()
      expect(ex.estimated1RM).toBe(kgToDisplay(estimate1RM(5, 100)!, 'lb'))
    })

    it('returns weights verbatim when the unit is kg', async () => {
      // Arrange
      const tools = setup()
      mockedUnit.mockResolvedValue('kg')
      mockedDetail.mockResolvedValue(
        detail() as unknown as Awaited<ReturnType<typeof getWorkoutDetail>>,
      )

      // Act
      const result = await tools.get('get_workout')!({ id: 'w1' })

      // Assert
      const body = payload(result) as {
        unit: string
        workout: { exercises: { sets: { weight: number | null }[] }[] }
      }
      expect(body.unit).toBe('kg')
      expect(body.workout.exercises[0]!.sets[0]!.weight).toBe(100)
    })

    it('returns isError matching /not found/ when the workout is missing or unowned', async () => {
      // Arrange
      const tools = setup()
      mockedDetail.mockResolvedValue(undefined)

      // Act
      const result = await tools.get('get_workout')!({ id: 'missing' })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
    })

    it('does not fetch the weight unit when the workout is not found', async () => {
      // Arrange
      const tools = setup()
      mockedDetail.mockResolvedValue(undefined)

      // Act
      await tools.get('get_workout')!({ id: 'missing' })

      // Assert — no wasted query on the not-found path
      expect(mockedUnit).not.toHaveBeenCalled()
    })
  })

  describe('search_exercises', () => {
    it('returns count and exercises without reading MCP_DEV_USER_ID', async () => {
      // Arrange — env unset to prove no user resolution happens
      delete process.env.MCP_DEV_USER_ID
      const tools = setup()
      const exercises = [{ id: 1, name: 'Bench Press', category: 'Chest' }]
      mockedSearch.mockResolvedValue(exercises)

      // Act
      const result = await tools.get('search_exercises')!({ search: 'bench' })

      // Assert
      expect(result.isError).toBeFalsy()
      expect(mockedSearch).toHaveBeenCalledWith({
        search: 'bench',
        category: undefined,
        limit: undefined,
      })
      expect(payload(result)).toEqual({ count: 1, exercises })
    })

    it('returns a generic isError and logs when the catalog lookup rejects', async () => {
      // Arrange
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const tools = setup()
      mockedSearch.mockRejectedValue(new Error('wger down'))

      // Act
      const result = await tools.get('search_exercises')!({ search: 'x' })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toBe('MCP tool failed')
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })
  })

  describe('get_last_performance', () => {
    it('maps sets into the unit, ISO-formats performedAt, and forwards excludeWorkoutId', async () => {
      // Arrange
      const tools = setup()
      mockedLast.mockResolvedValue({
        performedAt: new Date('2026-05-20T12:00:00.000Z'),
        sets: [
          { reps: 5, weight: 95 },
          { reps: 8, weight: null },
        ],
      })

      // Act
      const result = await tools.get('get_last_performance')!({
        wgerExerciseId: 73,
        excludeWorkoutId: 'w1',
      })

      // Assert
      expect(mockedLast).toHaveBeenCalledWith('user_env', 73, 'w1')
      expect(payload(result)).toEqual({
        userId: 'user_env',
        unit: 'lb',
        wgerExerciseId: 73,
        lastPerformance: {
          performedAt: '2026-05-20T12:00:00.000Z',
          sets: [
            { reps: 5, weight: kgToDisplay(95, 'lb') },
            { reps: 8, weight: null },
          ],
        },
      })
    })

    it('returns lastPerformance null when there is no history', async () => {
      // Arrange
      const tools = setup()
      mockedLast.mockResolvedValue(null)

      // Act
      const result = await tools.get('get_last_performance')!({ wgerExerciseId: 73 })

      // Assert
      expect(payload(result)).toEqual({
        userId: 'user_env',
        unit: 'lb',
        wgerExerciseId: 73,
        lastPerformance: null,
      })
    })
  })

  describe('get_weight_unit', () => {
    it('returns the resolved userId and the stored unit', async () => {
      // Arrange
      const tools = setup()
      mockedUnit.mockResolvedValue('kg')

      // Act
      const result = await tools.get('get_weight_unit')!({})

      // Assert
      expect(payload(result)).toEqual({ userId: 'user_env', unit: 'kg' })
    })
  })

  // The remaining user-scoped handlers share list_workouts' try/catch + resolveUserId
  // structure; cover the failure and no-user paths for each so the contract is explicit.
  describe('shared failure handling (remaining user-scoped tools)', () => {
    const cases = [
      { name: 'get_workout', args: { id: 'w1' }, dep: mockedDetail as unknown as Mock },
      { name: 'get_last_performance', args: { wgerExerciseId: 1 }, dep: mockedLast as unknown as Mock },
      { name: 'get_weight_unit', args: {}, dep: mockedUnit as unknown as Mock },
    ] as const

    it.each(cases)(
      '$name returns a generic isError and logs when its query rejects',
      async ({ name, args, dep }) => {
        // Arrange
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const tools = setup()
        dep.mockRejectedValue(new Error('internal-host:5432 down'))

        // Act
        const result = await tools.get(name)!(args)

        // Assert
        expect(result.isError).toBe(true)
        expect(result.content[0]?.text).toBe('MCP tool failed')
        expect(spy).toHaveBeenCalled()
        spy.mockRestore()
      },
    )

    it.each(cases)(
      '$name returns isError /userId/ and never queries when no user resolves',
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
