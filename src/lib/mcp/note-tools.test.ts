import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

vi.mock('@/db/notes', async (importOriginal) => {
  // Keep the pure helpers (noteAnchorKind) real; mock only the db-touching ops.
  const actual = await importOriginal<typeof import('@/db/notes')>()
  return {
    ...actual,
    createNote: vi.fn(),
    createPositionalSetNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    listNotes: vi.fn(),
  }
})
vi.mock('@/db/workouts', () => ({ workoutDetailQuery: vi.fn() }))

import { registerNoteTools } from './note-tools'
import {
  createNote,
  createPositionalSetNote,
  updateNote,
  deleteNote,
  listNotes,
  type NoteRow,
  type NoteWithContext,
} from '@/db/notes'
import { workoutDetailQuery } from '@/db/workouts'

const mockedCreate = vi.mocked(createNote)
const mockedPositional = vi.mocked(createPositionalSetNote)
const mockedUpdate = vi.mocked(updateNote)
const mockedDelete = vi.mocked(deleteNote)
const mockedList = vi.mocked(listNotes)
const mockedDetailQuery = vi.mocked(workoutDetailQuery)

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean }
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>

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
  registerNoteTools(server)
  return tools
}

function payload(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text)
}

const WORKOUT_ID = '11111111-1111-4111-8111-111111111111'
const PROGRAM_ID = '22222222-2222-4222-8222-222222222222'
const NOTE_ID = '33333333-3333-4333-8333-333333333333'

/** A workout-anchored NoteRow as the db op returns it. */
function noteRow(overrides: Partial<NoteRow> = {}): NoteRow {
  return {
    id: NOTE_ID,
    userId: 'user_env',
    author: 'user',
    body: 'felt heavy',
    programId: null,
    workoutId: WORKOUT_ID,
    workoutExerciseId: null,
    setId: null,
    anchorSnapshot: null,
    clientKey: null,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
  } as NoteRow
}

/** A one-exercise, two-set workout tree for positional resolution. */
function workoutTree() {
  return {
    id: WORKOUT_ID,
    userId: 'user_env',
    exercises: [
      {
        id: 'we1',
        position: 0,
        name: 'Squat',
        sets: [
          { id: 'set1', setNumber: 1 },
          { id: 'set2', setNumber: 2 },
        ],
      },
    ],
  } as unknown as Awaited<ReturnType<typeof workoutDetailQuery>>
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.MCP_DEV_USER_ID = 'user_env'
})

afterEach(() => {
  delete process.env.MCP_DEV_USER_ID
})

describe('registerNoteTools', () => {
  it('registers exactly the four note tools', () => {
    const tools = setup()
    expect([...tools.keys()].sort()).toEqual([
      'create_note',
      'delete_note',
      'list_notes',
      'update_note',
    ])
  })
})

describe('create_note', () => {
  it('creates a workout-anchored note as author user (never exposes an author arg)', async () => {
    const tools = setup()
    mockedCreate.mockResolvedValue(noteRow())

    const result = await tools.get('create_note')!({ workoutId: WORKOUT_ID, body: 'felt heavy' })

    expect(result.isError).toBeFalsy()
    // No author option: the db default ('user') is the only authorship this tool can mint.
    expect(mockedCreate).toHaveBeenCalledWith(
      'user_env',
      { kind: 'workout', id: WORKOUT_ID },
      'felt heavy',
    )
    expect(payload(result)).toMatchObject({
      userId: 'user_env',
      note: { id: NOTE_ID, author: 'user', anchorKind: 'workout', body: 'felt heavy' },
    })
  })

  it('creates a program-anchored note', async () => {
    const tools = setup()
    mockedCreate.mockResolvedValue(noteRow({ workoutId: null, programId: PROGRAM_ID }))

    const result = await tools.get('create_note')!({ programId: PROGRAM_ID, body: 'deload week 5' })

    expect(result.isError).toBeFalsy()
    expect(mockedCreate).toHaveBeenCalledWith(
      'user_env',
      { kind: 'program', id: PROGRAM_ID },
      'deload week 5',
    )
    expect(payload(result)).toMatchObject({ note: { anchorKind: 'program' } })
  })

  it('resolves an exercise anchor from workoutId + exercisePosition', async () => {
    const tools = setup()
    mockedDetailQuery.mockResolvedValue(workoutTree())
    mockedCreate.mockResolvedValue(noteRow({ workoutId: null, workoutExerciseId: 'we1' }))

    const result = await tools.get('create_note')!({
      workoutId: WORKOUT_ID,
      exercisePosition: 0,
      body: 'grip slipped',
    })

    expect(result.isError).toBeFalsy()
    expect(mockedCreate).toHaveBeenCalledWith(
      'user_env',
      { kind: 'workout_exercise', id: 'we1' },
      'grip slipped',
    )
    expect(payload(result)).toMatchObject({ note: { anchorKind: 'workout_exercise' } })
  })

  it('creates a set note through createPositionalSetNote with a minted clientKey', async () => {
    const tools = setup()
    mockedDetailQuery.mockResolvedValue(workoutTree())
    mockedPositional.mockResolvedValue(
      noteRow({ workoutId: null, setId: 'set2', anchorSnapshot: { setNumber: 2 } }),
    )

    const result = await tools.get('create_note')!({
      workoutId: WORKOUT_ID,
      exercisePosition: 0,
      setNumber: 2,
      body: 'left shoulder clicked',
    })

    expect(result.isError).toBeFalsy()
    expect(mockedPositional).toHaveBeenCalledWith('user_env', WORKOUT_ID, {
      exercisePosition: 0,
      setNumber: 2,
      body: 'left shoulder clicked',
      clientKey: expect.any(String),
    })
    expect(payload(result)).toMatchObject({ note: { anchorKind: 'set' } })
  })

  it('reports not-found when the workout tree lacks the addressed exercise position', async () => {
    const tools = setup()
    mockedDetailQuery.mockResolvedValue(workoutTree())

    const result = await tools.get('create_note')!({
      workoutId: WORKOUT_ID,
      exercisePosition: 5,
      body: 'x',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('exercise position 5')
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('reports not-found when the addressed set number does not exist', async () => {
    const tools = setup()
    mockedDetailQuery.mockResolvedValue(workoutTree())

    const result = await tools.get('create_note')!({
      workoutId: WORKOUT_ID,
      exercisePosition: 0,
      setNumber: 9,
      body: 'x',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('set 9')
    expect(mockedPositional).not.toHaveBeenCalled()
  })

  it('reports not-found when the workout is missing for a positional anchor', async () => {
    const tools = setup()
    mockedDetailQuery.mockResolvedValue(undefined)

    const result = await tools.get('create_note')!({
      workoutId: WORKOUT_ID,
      exercisePosition: 0,
      body: 'x',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('not found')
  })

  it('reports not-found when the db op returns null (unowned anchor)', async () => {
    const tools = setup()
    mockedCreate.mockResolvedValue(null)

    const result = await tools.get('create_note')!({ workoutId: WORKOUT_ID, body: 'x' })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('not found')
  })

  it('rejects both programId and workoutId', async () => {
    const tools = setup()

    const result = await tools.get('create_note')!({
      workoutId: WORKOUT_ID,
      programId: PROGRAM_ID,
      body: 'x',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/exactly one/i)
  })

  it('rejects neither programId nor workoutId', async () => {
    const tools = setup()

    const result = await tools.get('create_note')!({ body: 'x' })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/exactly one/i)
  })

  it('rejects setNumber without exercisePosition', async () => {
    const tools = setup()

    const result = await tools.get('create_note')!({
      workoutId: WORKOUT_ID,
      setNumber: 1,
      body: 'x',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('exercisePosition')
  })

  it('rejects exercisePosition on a program anchor', async () => {
    const tools = setup()

    const result = await tools.get('create_note')!({
      programId: PROGRAM_ID,
      exercisePosition: 0,
      body: 'x',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('exercisePosition')
  })

  it('rejects an empty body through the note input boundary', async () => {
    const tools = setup()

    const result = await tools.get('create_note')!({ workoutId: WORKOUT_ID, body: '   ' })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('empty')
    expect(mockedCreate).not.toHaveBeenCalled()
  })
})

describe('list_notes', () => {
  const contextRow: NoteWithContext = {
    id: NOTE_ID,
    author: 'user',
    body: 'left shoulder clicked',
    anchorKind: 'set',
    programId: null,
    workoutId: null,
    workoutExerciseId: null,
    setId: 'set2',
    anchorSnapshot: { exerciseName: 'Squat', setNumber: 2, loadKg: 100, reps: 5 },
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-01T10:00:00.000Z'),
    workoutName: 'Leg Day',
    workoutStartedAt: new Date('2026-08-01T08:00:00.000Z'),
    exerciseName: 'Squat',
    setNumber: 2,
    programName: null,
  }

  it('returns breadcrumb-ready rows with ISO dates', async () => {
    const tools = setup()
    mockedList.mockResolvedValue([contextRow])

    const result = await tools.get('list_notes')!({})

    expect(result.isError).toBeFalsy()
    expect(mockedList).toHaveBeenCalledWith('user_env', {})
    expect(payload(result)).toEqual({
      userId: 'user_env',
      count: 1,
      notes: [
        {
          id: NOTE_ID,
          author: 'user',
          body: 'left shoulder clicked',
          anchorKind: 'set',
          workoutId: null,
          workoutName: 'Leg Day',
          workoutStartedAt: '2026-08-01T08:00:00.000Z',
          exerciseName: 'Squat',
          setNumber: 2,
          programId: null,
          programName: null,
          anchorSnapshot: { exerciseName: 'Squat', setNumber: 2, loadKg: 100, reps: 5 },
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-01T10:00:00.000Z',
        },
      ],
    })
  })

  it('passes anchor-kind, workout, exercise-identity, and limit filters through', async () => {
    const tools = setup()
    mockedList.mockResolvedValue([])

    const result = await tools.get('list_notes')!({
      anchorKind: 'set',
      workoutId: WORKOUT_ID,
      exerciseId: 73,
      exerciseSource: 'custom',
      limit: 10,
    })

    expect(result.isError).toBeFalsy()
    expect(mockedList).toHaveBeenCalledWith('user_env', {
      anchorKind: 'set',
      workoutId: WORKOUT_ID,
      exercise: { source: 'custom', exerciseId: 73 },
      limit: 10,
    })
  })

  it("defaults the exercise identity source to 'wger'", async () => {
    const tools = setup()
    mockedList.mockResolvedValue([])

    await tools.get('list_notes')!({ exerciseId: 73 })

    expect(mockedList).toHaveBeenCalledWith('user_env', {
      exercise: { source: 'wger', exerciseId: 73 },
    })
  })
})

describe('update_note', () => {
  it('updates the body and returns the row', async () => {
    const tools = setup()
    mockedUpdate.mockResolvedValue(noteRow({ body: 'rewritten' }))

    const result = await tools.get('update_note')!({ noteId: NOTE_ID, body: 'rewritten' })

    expect(result.isError).toBeFalsy()
    expect(mockedUpdate).toHaveBeenCalledWith('user_env', NOTE_ID, 'rewritten')
    expect(payload(result)).toMatchObject({ note: { id: NOTE_ID, body: 'rewritten' } })
  })

  it('reports not-found when the note is absent, unowned, or coach-authored', async () => {
    const tools = setup()
    mockedUpdate.mockResolvedValue(null)

    const result = await tools.get('update_note')!({ noteId: NOTE_ID, body: 'rewritten' })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('not found')
  })

  it('rejects an empty body before touching the db', async () => {
    const tools = setup()

    const result = await tools.get('update_note')!({ noteId: NOTE_ID, body: '' })

    expect(result.isError).toBe(true)
    expect(mockedUpdate).not.toHaveBeenCalled()
  })
})

describe('delete_note', () => {
  it('deletes and confirms', async () => {
    const tools = setup()
    mockedDelete.mockResolvedValue(true)

    const result = await tools.get('delete_note')!({ noteId: NOTE_ID })

    expect(result.isError).toBeFalsy()
    expect(mockedDelete).toHaveBeenCalledWith('user_env', NOTE_ID)
    expect(payload(result)).toEqual({ userId: 'user_env', deleted: true, noteId: NOTE_ID })
  })

  it('reports not-found when nothing matched', async () => {
    const tools = setup()
    mockedDelete.mockResolvedValue(false)

    const result = await tools.get('delete_note')!({ noteId: NOTE_ID })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('not found')
  })
})
