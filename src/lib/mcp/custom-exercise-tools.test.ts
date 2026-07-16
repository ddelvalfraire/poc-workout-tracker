import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

vi.mock('@/db/custom-exercises', () => ({
  createCustomExercise: vi.fn(),
  updateCustomExercise: vi.fn(),
  listCustomExercises: vi.fn(),
}))

import { registerCustomExerciseTools } from './custom-exercise-tools'
import {
  createCustomExercise,
  updateCustomExercise,
  listCustomExercises,
} from '@/db/custom-exercises'

const mockedCreate = vi.mocked(createCustomExercise)
const mockedUpdate = vi.mocked(updateCustomExercise)
const mockedList = vi.mocked(listCustomExercises)

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean }
type Extra = { authInfo?: { extra?: { userId?: unknown } } }
type ToolHandler = (args: Record<string, unknown>, extra?: Extra) => Promise<ToolResult>

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
  registerCustomExerciseTools(server)
  return tools
}

function payload(result: ToolResult): unknown {
  return JSON.parse(result.content[0]!.text)
}

const ROW = {
  id: 7,
  userId: 'user_env',
  name: 'Cable Face Pull',
  category: 'Shoulders',
  equipment: null,
  muscles: ['Shoulders'],
  musclesSecondary: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as Awaited<ReturnType<typeof createCustomExercise>>

beforeEach(() => {
  vi.clearAllMocks()
  process.env.MCP_DEV_USER_ID = 'user_env'
})

afterEach(() => {
  delete process.env.MCP_DEV_USER_ID
})

describe('create_custom_exercise', () => {
  it('creates under the resolved user and returns the composite identity', async () => {
    const tools = setup()
    mockedCreate.mockResolvedValue(ROW)

    const result = await tools.get('create_custom_exercise')!({
      name: 'Cable Face Pull',
      category: 'Shoulders',
      muscles: ['Shoulders'],
    })

    expect(result.isError).toBeFalsy()
    expect(mockedCreate).toHaveBeenCalledWith('user_env', {
      name: 'Cable Face Pull',
      category: 'Shoulders',
      muscles: ['Shoulders'],
    })
    expect(payload(result)).toMatchObject({
      userId: 'user_env',
      exercise: { wgerExerciseId: 7, source: 'custom', name: 'Cable Face Pull' },
    })
  })

  it('translates the duplicate-name violation into a readable tool error', async () => {
    const tools = setup()
    mockedCreate.mockRejectedValue(
      new Error('violates unique constraint "custom_exercises_user_name_unique"'),
    )

    const result = await tools.get('create_custom_exercise')!({
      name: 'Cable Face Pull',
      category: 'Shoulders',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('already exists')
  })
})

describe('update_custom_exercise', () => {
  it('reports not-found for an unowned id', async () => {
    const tools = setup()
    mockedUpdate.mockResolvedValue(null)

    const result = await tools.get('update_custom_exercise')!({
      wgerExerciseId: 99,
      name: 'X',
      category: 'Shoulders',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('not found')
  })

  it('passes the full-field input through on success', async () => {
    const tools = setup()
    mockedUpdate.mockResolvedValue({ ...ROW, name: 'Renamed' })

    const result = await tools.get('update_custom_exercise')!({
      wgerExerciseId: 7,
      name: 'Renamed',
      category: 'Shoulders',
      muscles: ['Shoulders'],
    })

    expect(result.isError).toBeFalsy()
    expect(mockedUpdate).toHaveBeenCalledWith('user_env', 7, {
      name: 'Renamed',
      category: 'Shoulders',
      muscles: ['Shoulders'],
    })
    expect(payload(result)).toMatchObject({ exercise: { name: 'Renamed' } })
  })
})

describe('list_custom_exercises', () => {
  it('lists the resolved user’s definitions with composite ids', async () => {
    const tools = setup()
    mockedList.mockResolvedValue([ROW] as Awaited<ReturnType<typeof listCustomExercises>>)

    const result = await tools.get('list_custom_exercises')!({})

    expect(result.isError).toBeFalsy()
    expect(mockedList).toHaveBeenCalledWith('user_env')
    expect(payload(result)).toMatchObject({
      count: 1,
      exercises: [{ wgerExerciseId: 7, source: 'custom', muscles: ['Shoulders'] }],
    })
  })
})
