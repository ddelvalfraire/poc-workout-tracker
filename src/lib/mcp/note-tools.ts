import { randomUUID } from 'node:crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  createNote,
  createPositionalSetNote,
  deleteNote,
  listNotes,
  noteAnchorKind,
  updateNote,
  type ListNotesFilters,
  type NoteRow,
  type NoteWithContext,
} from '@/db/notes'
import { workoutDetailQuery } from '@/db/workouts'
import { parseNoteBody, NOTE_ANCHOR_KINDS } from '@/lib/notes/note-input'
import { resolveUserId } from './resolve-user'
import { errorResult, jsonResult } from './result'
import { ToolError } from './errors'
import { assertWorkoutIdShape } from './workout-id'
import { assertProgramIdShape } from './program-id'

/**
 * Registers the notes-v2 tools — create/list/update/delete over the `notes`
 * table (src/db/notes.ts), the same rows the app's capture sheet and browser
 * read and write.
 *
 * Anchors are addressed the MCP way (no server ids the client can't know):
 * `programId` for a program note; `workoutId` for a workout note; add
 * `exercisePosition` (0-based) for an exercise-instance note; add `setNumber`
 * (1-based) on top for a set note — the same positional grammar as
 * `createPositionalSetNote`, whose insert (frozen anchor snapshot included)
 * the set tier delegates to.
 *
 * Author is ALWAYS 'user' through this surface: the coach write path is gated
 * behind the coach surface (notes v2 amendment), so no author argument exists
 * — an MCP client can never mint coach-attributed words.
 */
export function registerNoteTools(server: McpServer): void {
  server.registerTool(
    'create_note',
    {
      title: 'Create Note',
      description:
        "Creates a note (plain text, max 2000 chars) on one anchor, authored as the user. Address exactly one root: `programId` (program note) or `workoutId` (workout note); with `workoutId`, add `exercisePosition` (0-based) for an exercise-instance note, and `setNumber` (1-based) too for a set note. Set notes freeze an anchor snapshot (exercise, load×reps at write time). Notes are the user's own words — there is no author argument.",
      inputSchema: {
        body: z.string(),
        programId: z.string().optional(),
        workoutId: z.string().optional(),
        exercisePosition: z.number().int().min(0).optional(),
        setNumber: z.number().int().min(1).optional(),
        userId: z.string().optional(),
      },
    },
    async ({ body, programId, workoutId, exercisePosition, setNumber, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        const parsedBody = parseBodyArg(body)
        assertAnchorAddress({ programId, workoutId, exercisePosition, setNumber })
        const row =
          programId !== undefined
            ? await createProgramNote(resolved, programId, parsedBody)
            : await createWorkoutTreeNote(resolved, workoutId!, parsedBody, {
                exercisePosition,
                setNumber,
              })
        return jsonResult({ userId: resolved, note: buildNotePayload(row) })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'list_notes',
    {
      title: 'List Notes',
      description:
        "Lists the user's notes (newest first) with anchor breadcrumbs: workout name/date, exercise name, set number, program name, plus the frozen anchor snapshot for set notes. Filter by `anchorKind` ('program' | 'workout' | 'workout_exercise' | 'set'), `workoutId`, or exercise identity (`exerciseId` + `exerciseSource`, source defaulting to 'wger' — the reverse index: every note ever anchored to that exercise across workouts). `author` distinguishes user notes from coach comments.",
      inputSchema: {
        anchorKind: z.enum(NOTE_ANCHOR_KINDS).optional(),
        workoutId: z.string().optional(),
        exerciseId: z.number().int().optional(),
        exerciseSource: z.enum(['wger', 'custom']).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        userId: z.string().optional(),
      },
    },
    async ({ anchorKind, workoutId, exerciseId, exerciseSource, limit, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        if (workoutId !== undefined) assertWorkoutIdShape(workoutId)
        const filters: ListNotesFilters = {
          ...(anchorKind !== undefined ? { anchorKind } : {}),
          ...(workoutId !== undefined ? { workoutId } : {}),
          ...(exerciseId !== undefined
            ? { exercise: { source: exerciseSource ?? 'wger', exerciseId } }
            : {}),
          ...(limit !== undefined ? { limit } : {}),
        }
        const rows = await listNotes(resolved, filters)
        return jsonResult({
          userId: resolved,
          count: rows.length,
          notes: rows.map(buildNoteListRow),
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'update_note',
    {
      title: 'Update Note',
      description:
        "Rewrites the body of one of the user's OWN notes (plain text, max 2000 chars). Coach-authored comments cannot be rewritten — only deleted — so those report not-found here.",
      inputSchema: {
        noteId: z.string().uuid(),
        body: z.string(),
        userId: z.string().optional(),
      },
    },
    async ({ noteId, body, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        const parsedBody = parseBodyArg(body)
        const row = await updateNote(resolved, noteId, parsedBody)
        if (!row) {
          return errorResult(
            new ToolError(
              `Note ${noteId} not found for user ${resolved} (or coach-authored — those can only be deleted)`,
            ),
          )
        }
        return jsonResult({ userId: resolved, note: buildNotePayload(row) })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'delete_note',
    {
      title: 'Delete Note',
      description:
        "Deletes one note the user owns (any author — it's their data). Irreversible.",
      inputSchema: { noteId: z.string().uuid(), userId: z.string().optional() },
    },
    async ({ noteId, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        const deleted = await deleteNote(resolved, noteId)
        if (!deleted) {
          return errorResult(new ToolError(`Note ${noteId} not found for user ${resolved}`))
        }
        return jsonResult({ userId: resolved, deleted: true, noteId })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )
}

/** The note-input boundary throws plain Errors; its messages are exactly the
 *  actionable kind the caller should see, so re-throw them as ToolError
 *  (errorResult genericizes anything else). */
function parseBodyArg(raw: unknown): string {
  try {
    return parseNoteBody(raw)
  } catch (error: unknown) {
    throw new ToolError(error instanceof Error ? error.message : 'invalid note body')
  }
}

/** The anchor-address rules create_note enforces before touching the db. */
function assertAnchorAddress(args: {
  programId: string | undefined
  workoutId: string | undefined
  exercisePosition: number | undefined
  setNumber: number | undefined
}): void {
  const { programId, workoutId, exercisePosition, setNumber } = args
  if ((programId !== undefined) === (workoutId !== undefined)) {
    throw new ToolError('Provide exactly one of programId or workoutId')
  }
  if (programId !== undefined && (exercisePosition !== undefined || setNumber !== undefined)) {
    throw new ToolError('exercisePosition/setNumber only apply to a workoutId anchor')
  }
  if (setNumber !== undefined && exercisePosition === undefined) {
    throw new ToolError('setNumber requires exercisePosition')
  }
}

async function createProgramNote(
  userId: string,
  programId: string,
  body: string,
): Promise<NoteRow> {
  assertProgramIdShape(programId)
  const row = await createNote(userId, { kind: 'program', id: programId }, body)
  if (!row) throw new ToolError(`Program ${programId} not found for user ${userId}`)
  return row
}

/**
 * The workout-rooted tiers. Positional tiers resolve through the owned workout
 * tree first so a bad address is a loud not-found — never silently parked:
 * `createPositionalSetNote`'s workout-anchor fallback exists for the offline
 * queue (a draft that diverged from the save), not for an agent addressing a
 * set that was never there.
 */
async function createWorkoutTreeNote(
  userId: string,
  workoutId: string,
  body: string,
  address: { exercisePosition: number | undefined; setNumber: number | undefined },
): Promise<NoteRow> {
  assertWorkoutIdShape(workoutId)
  const { exercisePosition, setNumber } = address
  if (exercisePosition === undefined) {
    const row = await createNote(userId, { kind: 'workout', id: workoutId }, body)
    if (!row) throw new ToolError(`Workout ${workoutId} not found for user ${userId}`)
    return row
  }
  const workout = await workoutDetailQuery(userId, workoutId)
  if (!workout) throw new ToolError(`Workout ${workoutId} not found for user ${userId}`)
  const exercise = workout.exercises.find((e) => e.position === exercisePosition)
  if (!exercise) {
    throw new ToolError(`Workout ${workoutId} has no exercise position ${exercisePosition}`)
  }
  if (setNumber === undefined) {
    const row = await createNote(userId, { kind: 'workout_exercise', id: exercise.id }, body)
    if (!row) throw new ToolError(`Workout ${workoutId} not found for user ${userId}`)
    return row
  }
  if (!exercise.sets.some((s) => s.setNumber === setNumber)) {
    throw new ToolError(
      `${exercise.name} (position ${exercisePosition}) has no set ${setNumber} in workout ${workoutId}`,
    )
  }
  // The positional insert stamps the frozen anchor snapshot; the clientKey is
  // minted per call (MCP has no offline queue to replay against).
  const row = await createPositionalSetNote(userId, workoutId, {
    exercisePosition,
    setNumber,
    body,
    clientKey: randomUUID(),
  })
  if (!row) throw new ToolError(`Workout ${workoutId} not found for user ${userId}`)
  return row
}

/** The agent-facing shape of one created/updated note row. */
function buildNotePayload(row: NoteRow) {
  return {
    id: row.id,
    author: row.author,
    body: row.body,
    anchorKind: noteAnchorKind(row),
    programId: row.programId,
    workoutId: row.workoutId,
    workoutExerciseId: row.workoutExerciseId,
    setId: row.setId,
    anchorSnapshot: row.anchorSnapshot,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** One breadcrumb-ready list row: anchor kind + resolved names/dates. */
function buildNoteListRow(row: NoteWithContext) {
  return {
    id: row.id,
    author: row.author,
    body: row.body,
    anchorKind: row.anchorKind,
    workoutId: row.workoutId,
    workoutName: row.workoutName,
    workoutStartedAt: row.workoutStartedAt?.toISOString() ?? null,
    exerciseName: row.exerciseName,
    setNumber: row.setNumber,
    programId: row.programId,
    programName: row.programName,
    anchorSnapshot: row.anchorSnapshot,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
