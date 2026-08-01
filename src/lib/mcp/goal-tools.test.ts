import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

vi.mock('@/lib/goals', () => ({ evaluateGoalProgress: vi.fn(async () => []) }))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn(async () => 'lb') }))
vi.mock('./resolve-user', () => ({ resolveUserId: vi.fn(() => 'user_123') }))

import { evaluateGoalProgress, type GoalWithProgress } from '@/lib/goals'
import { resolveUserId } from './resolve-user'
import { registerGoalTools } from './goal-tools'

const mockedEvaluate = vi.mocked(evaluateGoalProgress)
const mockedResolve = vi.mocked(resolveUserId)

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean }
type ToolHandler = (
  args: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<ToolResult>

function fakeServer(): { server: McpServer; tools: Map<string, ToolHandler> } {
  const tools = new Map<string, ToolHandler>()
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  }
  return { server: server as unknown as McpServer, tools }
}

const strengthEntry: GoalWithProgress = {
  goal: {
    id: 'g1',
    kind: 'strength',
    target: { e1rmKg: 142.88 },
    wgerExerciseId: 73,
    source: 'wger',
    exerciseName: 'Squat',
    deadline: '2026-11-12',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    achievedAt: null,
    archivedAt: null,
  },
  progress: {
    kind: 'strength',
    bestE1rmKg: 126,
    percent: 88,
    projectedAt: new Date('2026-11-12T00:00:00Z'),
  },
  achieved: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedEvaluate.mockResolvedValue([])
  mockedResolve.mockReturnValue('user_123')
})

describe('list_goals', () => {
  it('registers the tool', () => {
    const { server, tools } = fakeServer()
    registerGoalTools(server)
    expect([...tools.keys()]).toEqual(['list_goals'])
  })

  it('returns evaluated goals with display-unit weights, label, and pace date', async () => {
    const { server, tools } = fakeServer()
    registerGoalTools(server)
    mockedEvaluate.mockResolvedValue([strengthEntry])

    const result = await tools.get('list_goals')!({}, {})
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0].text)
    expect(payload).toEqual({
      userId: 'user_123',
      unit: 'lb',
      goals: [
        {
          id: 'g1',
          kind: 'strength',
          label: 'Squat 315 lb',
          achieved: false,
          deadline: '2026-11-12',
          createdAt: '2026-07-01T00:00:00.000Z',
          achievedAt: null,
          exercise: { wgerExerciseId: 73, source: 'wger', name: 'Squat' },
          target: { e1rm: 315 },
          progress: { bestE1rm: 277.8, percent: 88, onPaceFor: '2026-11-12' },
        },
      ],
    })
  })

  it('projects consistency progress verbatim (weeks, grace evidence)', async () => {
    const { server, tools } = fakeServer()
    registerGoalTools(server)
    mockedEvaluate.mockResolvedValue([
      {
        goal: {
          id: 'g2',
          kind: 'consistency',
          target: { targetWeeks: 8, allowedMissesPerWeek: 1 },
          wgerExerciseId: null,
          source: null,
          exerciseName: null,
          deadline: null,
          createdAt: new Date('2026-07-01T00:00:00Z'),
          achievedAt: null,
          archivedAt: null,
        },
        progress: {
          kind: 'consistency',
          streakWeeks: 3,
          targetWeeks: 8,
          allowedMissesPerWeek: 1,
          scheduledWeekdays: [1, 3, 5],
        },
        achieved: false,
      },
    ])

    const payload = JSON.parse((await tools.get('list_goals')!({}, {})).content[0].text)
    expect(payload.goals[0]).toMatchObject({
      kind: 'consistency',
      label: '8-week streak',
      target: { targetWeeks: 8, allowedMissesPerWeek: 1 },
      progress: { streakWeeks: 3, targetWeeks: 8, scheduledWeekdays: [1, 3, 5] },
    })
    expect(payload.goals[0]).not.toHaveProperty('exercise')
  })

  it('returns an error result when the user cannot be resolved', async () => {
    const { server, tools } = fakeServer()
    registerGoalTools(server)
    mockedResolve.mockImplementation(() => {
      throw new Error('no user in scope')
    })

    const result = await tools.get('list_goals')!({}, {})
    expect(result.isError).toBe(true)
  })
})
