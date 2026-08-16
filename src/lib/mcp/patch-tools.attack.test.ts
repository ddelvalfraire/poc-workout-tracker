/**
 * Adversarial regression tests for the MCP set tools' #206/#242 completion
 * gates. DB mocked, so these cover the TOOL layer's pure-arg gate: completing
 * a set must carry its performed metric in the same call (the db layer's
 * SetCompletionError read-gate covers the row-dependent cases). Adopted from
 * the adversarial verification round.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

vi.mock('@/db/workouts', () => ({
  updateSet: vi.fn(),
  addSet: vi.fn(),
  removeSet: vi.fn(),
  updateWorkoutMeta: vi.fn(),
  updateExerciseMeta: vi.fn(),
}))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn() }))

import { registerPatchTools } from './patch-tools'
import { updateSet, addSet } from '@/db/workouts'
import { getWeightUnit } from '@/db/preferences'

const mockedUpdateSet = vi.mocked(updateSet)
const mockedAddSet = vi.mocked(addSet)
const mockedGetUnit = vi.mocked(getWeightUnit)

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean }
type ToolHandler = (args: Record<string, unknown>, extra?: unknown) => Promise<ToolResult>

function setup(): Map<string, ToolHandler> {
  const tools = new Map<string, ToolHandler>()
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  registerPatchTools(server)
  return tools
}

const WID = '11111111-1111-4111-8111-111111111111'

describe('MCP patch tools — completion-gate probes', () => {
  const original = process.env.MCP_DEV_USER_ID
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MCP_DEV_USER_ID = 'user_env'
    mockedGetUnit.mockResolvedValue('kg')
    mockedUpdateSet.mockResolvedValue({ id: 'set-1' })
    mockedAddSet.mockResolvedValue({ setNumber: 1 })
  })
  afterEach(() => {
    if (original === undefined) delete process.env.MCP_DEV_USER_ID
    else process.env.MCP_DEV_USER_ID = original
  })

  it('OBSERVATION (green): update_set writes durationSec onto a set WITHOUT setting metricMode', async () => {
    // The tool cannot know the target set's mode; it forwards durationSec
    // blind. An implicitly reps_weight set can therefore carry a duration —
    // the cross-field exclusivity the draft layer maintains is not enforced
    // here (scoring fences by metricMode, so the stray value is inert, but it
    // is persisted).
    const result = await setup().get('update_set')!({
      workoutId: WID,
      exercisePosition: 0,
      setNumber: 1,
      durationSec: 3600,
    })
    expect(result.isError).toBeUndefined()
    expect(mockedUpdateSet).toHaveBeenCalledWith('user_env', WID, 0, 1, { durationSec: 3600 })
  })

  it('OBSERVATION (green): update_set accepts durationSec + weight + reps together (no cross-field rule)', async () => {
    const result = await setup().get('update_set')!({
      workoutId: WID,
      exercisePosition: 0,
      setNumber: 1,
      metricMode: 'duration',
      durationSec: 1800,
      reps: 10,
      weight: 100,
    })
    expect(result.isError).toBeUndefined()
    expect(mockedUpdateSet).toHaveBeenCalledWith(
      'user_env',
      WID,
      0,
      1,
      expect.objectContaining({ metricMode: 'duration', durationSec: 1800, reps: 10 }),
    )
  })

  it('update_set refuses completed:true as the ONLY change (blind completion)', async () => {
    // #206: "Completing the set should require a weight value." The tool must
    // never forward completed:true without any performed metric among the args
    // — a weight-less weight_reps set completed over MCP is the exact
    // corruption #206 fixed in the logger.
    const result = await setup().get('update_set')!({
      workoutId: WID,
      exercisePosition: 0,
      setNumber: 1,
      completed: true,
    })
    expect(mockedUpdateSet).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
  })

  it('update_set refuses completed:true while blanking the weight in the same call', async () => {
    // The strongest form: one call that both nulls the weight AND completes.
    const result = await setup().get('update_set')!({
      workoutId: WID,
      exercisePosition: 0,
      setNumber: 1,
      weight: null,
      completed: true,
    })
    expect(result.isError).toBe(true)
  })

  it('add_set refuses a completed weight-less reps set', async () => {
    const result = await setup().get('add_set')!({
      workoutId: WID,
      exercisePosition: 0,
      reps: 15,
      weight: null,
      completed: true,
    })
    expect(mockedAddSet).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
  })

  it('add_set refuses a completed duration set with no duration', async () => {
    const result = await setup().get('add_set')!({
      workoutId: WID,
      exercisePosition: 0,
      reps: null,
      weight: null,
      metricMode: 'duration',
      durationSec: null,
      completed: true,
    })
    expect(result.isError).toBe(true)
  })
})
