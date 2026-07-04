import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

vi.mock('@/db/workouts', () => ({ getWorkoutDetail: vi.fn() }))
vi.mock('@/db/programs', () => ({ getProgramDetail: vi.fn(), getProgramDayDetail: vi.fn() }))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn() }))

import { registerResources } from './resources'
import { getWorkoutDetail } from '@/db/workouts'
import { getProgramDetail, getProgramDayDetail } from '@/db/programs'
import { getWeightUnit } from '@/db/preferences'
import { kgToDisplay } from '@/lib/units'

const mockedDetail = vi.mocked(getWorkoutDetail)
const mockedProgramDetail = vi.mocked(getProgramDetail)
const mockedWorkoutProgramDay = vi.mocked(getProgramDayDetail)
const mockedUnit = vi.mocked(getWeightUnit)

type ResourceContents = { uri: string; mimeType?: string; text: string }
type ResourceResult = { contents: ResourceContents[] }
type ReadCallback = (uri: URL, variables: Record<string, string | string[]>) => Promise<ResourceResult>
type Registered = { template: unknown; read: ReadCallback }

/**
 * Minimal stand-in for an McpServer that records
 * registerResource(name, template, _config, readCallback) calls, so a test can
 * assert the registered resource set and invoke each read callback directly.
 */
function fakeServer(): { server: McpServer; resources: Map<string, Registered> } {
  const resources = new Map<string, Registered>()
  const server = {
    registerResource: (name: string, template: unknown, _config: unknown, read: ReadCallback) => {
      resources.set(name, { template, read })
    },
  }
  return { server: server as unknown as McpServer, resources }
}

/** Registers the resources on a fresh fake server and returns the recorded map. */
function setup(): Map<string, Registered> {
  const { server, resources } = fakeServer()
  registerResources(server)
  return resources
}

/** A one-exercise workout: one scorable set (5 reps @ 100 kg) and one blank set. */
function detail() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Leg Day',
    startedAt: new Date('2026-06-02T08:00:00.000Z'),
    userId: 'user_env',
    programDayId: null,
    programWeek: null,
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

/** Invokes the `workout` resource's read callback for a given id. */
function readWorkout(resources: Map<string, Registered>, id = '11111111-1111-4111-8111-111111111111') {
  const { read } = resources.get('workout')!
  return read(new URL(`workout://${id}`), { id })
}

describe('registerResources', () => {
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

  it('registers a workout resource templated on workout://{id}', () => {
    // Arrange + Act
    const resources = setup()

    // Assert
    const reg = resources.get('workout')
    expect(reg).toBeDefined()
    const pattern = String((reg!.template as { uriTemplate?: unknown }).uriTemplate)
    expect(pattern).toContain('workout://{id}')
  })

  it('returns the get_workout payload as JSON contents, weights in the user unit', async () => {
    // Arrange
    const resources = setup()
    mockedDetail.mockResolvedValue(detail() as unknown as Awaited<ReturnType<typeof getWorkoutDetail>>)

    // Act
    const result = await readWorkout(resources)

    // Assert
    expect(mockedDetail).toHaveBeenCalledWith('user_env', '11111111-1111-4111-8111-111111111111')
    const content = result.contents[0]!
    expect(content.uri).toContain('11111111-1111-4111-8111-111111111111')
    expect(content.mimeType).toBe('application/json')
    const body = JSON.parse(content.text) as {
      userId: string
      unit: string
      workout: { startedAt: string; exercises: { sets: { weight: number | null }[] }[] }
    }
    expect(body.userId).toBe('user_env')
    expect(body.unit).toBe('lb')
    expect(body.workout.startedAt).toBe('2026-06-02T08:00:00.000Z')
    expect(body.workout.exercises[0]!.sets[0]!.weight).toBe(kgToDisplay(100, 'lb'))
    expect(body.workout.exercises[0]!.sets[1]!.weight).toBeNull()
  })

  it('rejects with /not found/ when the workout does not exist', async () => {
    // Arrange
    const resources = setup()
    mockedDetail.mockResolvedValue(undefined)

    // Act + Assert
    await expect(readWorkout(resources, '22222222-2222-4222-8222-222222222222')).rejects.toThrow(/not found/)
  })

  it('rejects with /required/ and never queries when the URI carries no id', async () => {
    // Arrange
    const resources = setup()
    const { read } = resources.get('workout')!

    // Act + Assert — empty variables (no {id})
    await expect(read(new URL('workout://none'), {})).rejects.toThrow(/required/)
    expect(mockedDetail).not.toHaveBeenCalled()
  })

  it('rejects with /userId/ and never queries when no user resolves', async () => {
    // Arrange — no env user, no arg in a resource URI
    delete process.env.MCP_DEV_USER_ID
    const resources = setup()

    // Act + Assert
    await expect(readWorkout(resources)).rejects.toThrow(/userId/)
    expect(mockedDetail).not.toHaveBeenCalled()
  })

  it('rejects with a generic message and logs (no internals leaked) when the db rejects', async () => {
    // Arrange
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const resources = setup()
    mockedDetail.mockRejectedValue(new Error('db down: secret-host:5432'))

    // Act + Assert
    await expect(readWorkout(resources)).rejects.toThrow('MCP resource read failed')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('overlays the program day plan when the workout was instantiated', async () => {
    // Arrange — a workout with provenance + the program day it came from
    const resources = setup()
    mockedDetail.mockResolvedValue(
      { ...detail(), programDayId: 'pd1', programWeek: 1 } as unknown as Awaited<ReturnType<typeof getWorkoutDetail>>,
    )
    mockedWorkoutProgramDay.mockResolvedValue(
      {
        id: 'pd1',
        name: 'Push',
        program: { userId: 'user_env' },
        exercises: [
          {
            id: 'pe1',
            wgerExerciseId: 73,
            name: 'Squat',
            position: 0,
            progression: null,
            sets: [
              {
                setNumber: 1,
                setType: 'working',
                metricMode: 'reps_weight',
                repMin: 5,
                repMax: 8,
                rir: 2,
                rpe: null,
                suggestedLoadKg: 100,
                tempo: null,
                durationSec: null,
                distanceM: null,
                technique: null,
                overrides: [],
              },
            ],
          },
        ],
      } as unknown as Awaited<ReturnType<typeof getProgramDayDetail>>,
    )

    // Act
    const result = await readWorkout(resources)

    // Assert — plan overlay rendered in the user's unit (lb)
    expect(mockedWorkoutProgramDay).toHaveBeenCalledWith('user_env', 'pd1')
    const body = JSON.parse(result.contents[0]!.text) as {
      workout: { programDayId: string | null; plan?: { exercises: { sets: { suggestedLoad: number | null }[] }[] } }
    }
    expect(body.workout.programDayId).toBe('pd1')
    expect(body.workout.plan!.exercises[0]!.sets[0]!.suggestedLoad).toBe(kgToDisplay(100, 'lb'))
  })

  describe('program resource', () => {
    /** A one-day/one-exercise/one-set program (set @ 100 kg). */
    function programDetail() {
      return {
        id: '11111111-1111-4111-8111-111111111111',
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
            programId: '11111111-1111-4111-8111-111111111111',
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
                progression: null,
                supersetGroup: null,
                muscles: [],
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
                    technique: null,
                    overrides: [],
                  },
                ],
              },
            ],
          },
        ],
      }
    }

    /** Invokes the `program` resource's read callback for a given id. */
    function readProgram(
      resources: Map<string, Registered>,
      id = '11111111-1111-4111-8111-111111111111',
    ) {
      const { read } = resources.get('program')!
      return read(new URL(`program://${id}`), { id })
    }

    it('registers a program resource templated on program://{id}', () => {
      // Arrange + Act
      const resources = setup()

      // Assert
      const reg = resources.get('program')
      expect(reg).toBeDefined()
      const pattern = String((reg!.template as { uriTemplate?: unknown }).uriTemplate)
      expect(pattern).toContain('program://{id}')
    })

    it('returns the get_program payload as JSON, suggested loads in the user unit', async () => {
      // Arrange
      const resources = setup()
      mockedProgramDetail.mockResolvedValue(
        programDetail() as unknown as Awaited<ReturnType<typeof getProgramDetail>>,
      )

      // Act
      const result = await readProgram(resources)

      // Assert
      expect(mockedProgramDetail).toHaveBeenCalledWith('user_env', '11111111-1111-4111-8111-111111111111')
      const content = result.contents[0]!
      expect(content.mimeType).toBe('application/json')
      const body = JSON.parse(content.text) as {
        userId: string
        unit: string
        program: { createdAt: string; days: { exercises: { sets: { suggestedLoad: number | null }[] }[] }[] }
      }
      expect(body.userId).toBe('user_env')
      expect(body.unit).toBe('lb')
      expect(body.program.createdAt).toBe('2026-06-01T00:00:00.000Z')
      expect(body.program.days[0]!.exercises[0]!.sets[0]!.suggestedLoad).toBe(kgToDisplay(100, 'lb'))
    })

    it('rejects with /not found/ when the program does not exist', async () => {
      // Arrange
      const resources = setup()
      mockedProgramDetail.mockResolvedValue(undefined)

      // Act + Assert
      await expect(
        readProgram(resources, '22222222-2222-4222-8222-222222222222'),
      ).rejects.toThrow(/not found/)
    })

    it('rejects with /required/ and never queries when the URI carries no id', async () => {
      // Arrange
      const resources = setup()
      const { read } = resources.get('program')!

      // Act + Assert
      await expect(read(new URL('program://none'), {})).rejects.toThrow(/required/)
      expect(mockedProgramDetail).not.toHaveBeenCalled()
    })

    it('rejects with /userId/ and never queries when no user resolves', async () => {
      // Arrange
      delete process.env.MCP_DEV_USER_ID
      const resources = setup()

      // Act + Assert
      await expect(readProgram(resources)).rejects.toThrow(/userId/)
      expect(mockedProgramDetail).not.toHaveBeenCalled()
    })

    it('rejects with a generic message and logs when the db rejects', async () => {
      // Arrange
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const resources = setup()
      mockedProgramDetail.mockRejectedValue(new Error('db down: secret-host:5432'))

      // Act + Assert
      await expect(readProgram(resources)).rejects.toThrow('MCP resource read failed')
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })
  })
})
