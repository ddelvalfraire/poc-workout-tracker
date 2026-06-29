import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

vi.mock('@/db/programs', () => ({
  saveProgram: vi.fn(),
  updateProgram: vi.fn(),
  deleteProgram: vi.fn(),
  setProgramStatus: vi.fn(),
  listPrograms: vi.fn(),
  getProgramDetail: vi.fn(),
}))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn() }))

import { registerProgramTools } from './program-tools'
import {
  saveProgram,
  updateProgram,
  deleteProgram,
  setProgramStatus,
  listPrograms,
  getProgramDetail,
} from '@/db/programs'
import { getWeightUnit } from '@/db/preferences'
import { displayToKg, kgToDisplay } from '@/lib/units'
import { MAX_WEIGHT as MAX_WEIGHT_KG } from '@/lib/workout-input'

const mockedSave = vi.mocked(saveProgram)
const mockedUpdate = vi.mocked(updateProgram)
const mockedDelete = vi.mocked(deleteProgram)
const mockedSetStatus = vi.mocked(setProgramStatus)
const mockedList = vi.mocked(listPrograms)
const mockedDetail = vi.mocked(getProgramDetail)
const mockedGetUnit = vi.mocked(getWeightUnit)

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean }
type Extra = { authInfo?: { extra?: { userId?: unknown } } }
type ToolHandler = (args: Record<string, unknown>, extra?: Extra) => Promise<ToolResult>

/** Minimal stand-in for an McpServer recording registerTool(name, _config, handler). */
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
  registerProgramTools(server)
  return tools
}

function payload(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text)
}

const PID = '11111111-1111-4111-8111-111111111111'

/** A valid one-day/one-exercise/one-set program body (display units). */
const BODY = {
  name: 'PPL',
  days: [
    {
      name: 'Push',
      exercises: [
        { wgerExerciseId: 1, name: 'Bench', sets: [{ suggestedLoad: 220.5, repMin: 8, repMax: 12 }] },
      ],
    },
  ],
}

/** A persisted program detail (kg) the read tool/resource render. */
function programDetail() {
  return {
    id: PID,
    userId: 'user_env',
    name: 'PPL',
    status: 'active',
    mesocycleWeeks: 4,
    deloadWeek: 4,
    notes: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-02T00:00:00.000Z'),
    days: [
      {
        id: 'd1',
        programId: PID,
        name: 'Push',
        position: 0,
        notes: null,
        exercises: [
          {
            id: 'e1',
            programDayId: 'd1',
            wgerExerciseId: 1,
            name: 'Bench',
            position: 0,
            progression: { scheme: 'linear', incrementKg: 2.5 },
            sets: [
              {
                id: 's1',
                programExerciseId: 'e1',
                setNumber: 1,
                setType: 'working',
                metricMode: 'reps_weight',
                repMin: 8,
                repMax: 12,
                rir: 2,
                rpe: null,
                suggestedLoadKg: 100,
                tempo: null,
                durationSec: null,
                distanceM: null,
                technique: { version: 1, kind: 'drop-set', stages: [{ loadKg: 20, reps: 10 }] },
              },
            ],
          },
        ],
      },
    ],
  }
}

type Detail = Awaited<ReturnType<typeof getProgramDetail>>

describe('registerProgramTools', () => {
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

  it('registers exactly the five program tools', () => {
    const tools = setup()
    expect([...tools.keys()].sort()).toEqual([
      'delete_program',
      'get_program',
      'list_programs',
      'set_program_status',
      'upsert_program',
    ])
  })

  describe('upsert_program (create)', () => {
    it('converts suggestedLoad to kg, applies defaults, echoes userId/unit/programId', async () => {
      // Arrange
      const tools = setup()
      mockedSave.mockResolvedValue({ id: PID })

      // Act
      const result = await tools.get('upsert_program')!(BODY)

      // Assert
      expect(mockedGetUnit).toHaveBeenCalledWith('user_env')
      expect(mockedSave).toHaveBeenCalledWith(
        'user_env',
        expect.objectContaining({
          name: 'PPL',
          status: 'draft',
          mesocycleWeeks: 1,
          days: [
            expect.objectContaining({
              name: 'Push',
              exercises: [
                expect.objectContaining({
                  sets: [
                    expect.objectContaining({
                      setType: 'working',
                      metricMode: 'reps_weight',
                      repMin: 8,
                      repMax: 12,
                      suggestedLoadKg: displayToKg(220.5, 'lb'),
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      )
      expect(payload(result)).toEqual({ userId: 'user_env', unit: 'lb', programId: PID })
    })

    it('acts as the authenticated user, ignoring a conflicting userId arg (no impersonation)', async () => {
      // Arrange
      const tools = setup()
      mockedSave.mockResolvedValue({ id: PID })

      // Act
      const result = await tools.get('upsert_program')!(
        { ...BODY, userId: 'user_arg' },
        { authInfo: { extra: { userId: 'user_token' } } },
      )

      // Assert
      expect(mockedSave).toHaveBeenCalledWith('user_token', expect.anything())
      expect(payload(result).userId).toBe('user_token')
    })

    it('uses an explicit unit:kg without converting and without reading the stored unit', async () => {
      // Arrange
      const tools = setup()
      mockedSave.mockResolvedValue({ id: PID })

      // Act
      const result = await tools.get('upsert_program')!({ ...BODY, unit: 'kg' })

      // Assert
      expect(mockedGetUnit).not.toHaveBeenCalled()
      expect(mockedSave).toHaveBeenCalledWith(
        'user_env',
        expect.objectContaining({
          days: [
            expect.objectContaining({
              exercises: [
                expect.objectContaining({ sets: [expect.objectContaining({ suggestedLoadKg: 220.5 })] }),
              ],
            }),
          ],
        }),
      )
      expect(payload(result).unit).toBe('kg')
    })

    it('rejects an over-max load with the bound stated in the agent unit (lb) and never saves', async () => {
      // Arrange — stored unit lb
      const tools = setup()
      const maxLb = kgToDisplay(MAX_WEIGHT_KG, 'lb')

      // Act
      const result = await tools.get('upsert_program')!({
        name: 'P',
        days: [{ name: 'Push', exercises: [{ wgerExerciseId: 1, name: 'Bench', sets: [{ suggestedLoad: maxLb + 1 }] }] }],
      })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain(`${maxLb} lb`)
      expect(result.content[0]?.text).not.toContain('kg')
      expect(mockedSave).not.toHaveBeenCalled()
    })

    it('rejects a timed set missing durationSec (surfaced ZodError) and never saves', async () => {
      // Arrange
      const tools = setup()

      // Act
      const result = await tools.get('upsert_program')!({
        name: 'Core',
        days: [{ name: 'Abs', exercises: [{ wgerExerciseId: 9, name: 'Plank', sets: [{ metricMode: 'duration' }] }] }],
      })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/durationSec/i)
      expect(mockedSave).not.toHaveBeenCalled()
    })

    it('rejects invalid input (empty days) as a surfaced ToolError and never saves', async () => {
      // Arrange
      const tools = setup()

      // Act
      const result = await tools.get('upsert_program')!({ name: 'P', days: [] })

      // Assert
      expect(result.isError).toBe(true)
      expect(mockedSave).not.toHaveBeenCalled()
    })

    it('returns a generic isError and logs (no internals leaked) when the db rejects', async () => {
      // Arrange
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const tools = setup()
      mockedSave.mockRejectedValue(new Error('db down: secret-host:5432'))

      // Act
      const result = await tools.get('upsert_program')!(BODY)

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
      const result = await tools.get('upsert_program')!(BODY)

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/userId/)
      expect(mockedSave).not.toHaveBeenCalled()
    })
  })

  describe('upsert_program (replace)', () => {
    it('updates an owned program when id is given, echoing the programId', async () => {
      // Arrange
      const tools = setup()
      mockedUpdate.mockResolvedValue({ id: PID })

      // Act
      const result = await tools.get('upsert_program')!({ id: PID, ...BODY })

      // Assert
      expect(mockedUpdate).toHaveBeenCalledWith('user_env', PID, expect.anything())
      expect(mockedSave).not.toHaveBeenCalled()
      expect(payload(result)).toEqual({ userId: 'user_env', unit: 'lb', programId: PID })
    })

    it('returns isError /not found/ when the program is not owned', async () => {
      // Arrange
      const tools = setup()
      mockedUpdate.mockResolvedValue(null)

      // Act
      const result = await tools.get('upsert_program')!({ id: PID, ...BODY })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
    })

    it('surfaces not-found for a malformed (non-UUID) id without hitting the db', async () => {
      // Arrange
      const tools = setup()

      // Act
      const result = await tools.get('upsert_program')!({ id: 'not-a-uuid', ...BODY })

      // Assert — the id guard fails fast, before the unit query or the update
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
      expect(mockedUpdate).not.toHaveBeenCalled()
      expect(mockedGetUnit).not.toHaveBeenCalled()
    })
  })

  describe('get_program', () => {
    it('returns the program payload with loads in the user unit, ISO dates, technique verbatim', async () => {
      // Arrange
      const tools = setup()
      mockedDetail.mockResolvedValue(programDetail() as unknown as Detail)

      // Act
      const result = await tools.get('get_program')!({ id: PID })

      // Assert
      const body = payload(result) as {
        unit: string
        program: {
          createdAt: string
          days: { exercises: { sets: { suggestedLoad: number | null; technique: unknown }[] }[] }[]
        }
      }
      expect(body.unit).toBe('lb')
      expect(body.program.createdAt).toBe('2026-06-01T00:00:00.000Z')
      const set = body.program.days[0]!.exercises[0]!.sets[0]!
      expect(set.suggestedLoad).toBe(kgToDisplay(100, 'lb'))
      expect(set.technique).toEqual({ version: 1, kind: 'drop-set', stages: [{ loadKg: 20, reps: 10 }] })
    })

    it('returns isError /not found/ when the program does not exist', async () => {
      // Arrange
      const tools = setup()
      mockedDetail.mockResolvedValue(undefined as unknown as Detail)

      // Act
      const result = await tools.get('get_program')!({ id: PID })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
    })

    it('surfaces not-found for a malformed id without hitting the db', async () => {
      // Arrange
      const tools = setup()

      // Act
      const result = await tools.get('get_program')!({ id: 'not-a-uuid' })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
      expect(mockedDetail).not.toHaveBeenCalled()
    })
  })

  describe('list_programs', () => {
    it('maps rows with ISO dates', async () => {
      // Arrange
      const tools = setup()
      mockedList.mockResolvedValue([
        {
          id: PID,
          name: 'PPL',
          status: 'active',
          mesocycleWeeks: 4,
          deloadWeek: 4,
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          updatedAt: new Date('2026-06-02T00:00:00.000Z'),
        },
      ] as unknown as Awaited<ReturnType<typeof listPrograms>>)

      // Act
      const result = await tools.get('list_programs')!({})

      // Assert
      const body = payload(result) as { programs: { id: string; updatedAt: string }[] }
      expect(body.programs[0]).toMatchObject({ id: PID, updatedAt: '2026-06-02T00:00:00.000Z' })
    })
  })

  describe('delete_program', () => {
    it('deletes an owned program and reports deleted:true', async () => {
      // Arrange
      const tools = setup()
      mockedDelete.mockResolvedValue([{ id: PID }] as unknown as Awaited<ReturnType<typeof deleteProgram>>)

      // Act
      const result = await tools.get('delete_program')!({ id: PID })

      // Assert
      expect(mockedDelete).toHaveBeenCalledWith('user_env', PID)
      expect(payload(result)).toEqual({ userId: 'user_env', programId: PID, deleted: true })
    })

    it('returns isError /not found/ when nothing was deleted', async () => {
      // Arrange
      const tools = setup()
      mockedDelete.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof deleteProgram>>)

      // Act
      const result = await tools.get('delete_program')!({ id: PID })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
    })

    it('surfaces not-found for a malformed id without hitting the db', async () => {
      // Arrange
      const tools = setup()

      // Act
      const result = await tools.get('delete_program')!({ id: 'not-a-uuid' })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
      expect(mockedDelete).not.toHaveBeenCalled()
    })
  })

  describe('set_program_status', () => {
    it('sets the status and echoes it', async () => {
      // Arrange
      const tools = setup()
      mockedSetStatus.mockResolvedValue({ id: PID })

      // Act
      const result = await tools.get('set_program_status')!({ id: PID, status: 'active' })

      // Assert
      expect(mockedSetStatus).toHaveBeenCalledWith('user_env', PID, 'active')
      expect(payload(result)).toEqual({ userId: 'user_env', programId: PID, status: 'active' })
    })

    it('returns isError /not found/ when the program is not owned', async () => {
      // Arrange
      const tools = setup()
      mockedSetStatus.mockResolvedValue(null)

      // Act
      const result = await tools.get('set_program_status')!({ id: PID, status: 'archived' })

      // Assert
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/not found/)
    })
  })

  // Every program tool gates on a resolved user before touching the db.
  describe('no-user gate (all program tools)', () => {
    const cases = [
      { name: 'get_program', args: { id: PID }, dep: mockedDetail as unknown as Mock },
      { name: 'list_programs', args: {}, dep: mockedList as unknown as Mock },
      { name: 'delete_program', args: { id: PID }, dep: mockedDelete as unknown as Mock },
      { name: 'set_program_status', args: { id: PID, status: 'active' }, dep: mockedSetStatus as unknown as Mock },
    ] as const

    it.each(cases)(
      '$name returns isError /userId/ and never touches the db when no user resolves',
      async ({ name, args, dep }) => {
        // Arrange
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
