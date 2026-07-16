import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { resolveUserId } from './resolve-user'
import { jsonResult, errorResult } from './result'
import { ToolError } from './errors'
import { EXERCISE_CATEGORIES } from '@/lib/custom-exercise-input'
import {
  createCustomExercise,
  listCustomExercises,
  updateCustomExercise,
  type CustomExerciseRow,
} from '@/db/custom-exercises'

/**
 * MCP lifecycle tools for the user's custom exercises (per-user, never
 * shared — the PRD's ownership decision). Mirrors the web action boundary:
 * same category whitelist, same duplicate-name translation; ownership is
 * enforced by the db layer's user-scoped writes.
 */

const nameArg = z.string().trim().min(1).max(80)
const categoryArg = z.enum(EXERCISE_CATEGORIES)
const namesArg = z.array(z.string().trim().min(1).max(100)).max(20).optional()

/** The response subset agents act on. */
function toResult(row: CustomExerciseRow) {
  return {
    wgerExerciseId: row.id,
    source: 'custom' as const,
    name: row.name,
    category: row.category,
    equipment: row.equipment ?? [],
    muscles: row.muscles ?? [],
    musclesSecondary: row.musclesSecondary ?? [],
  }
}

/** Postgres unique-violation (per-user name guard) → a ToolError sentence. */
function translateDuplicateName(error: unknown): never {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('custom_exercises_user_name_unique')) {
    throw new ToolError('a custom exercise with this name already exists for this user')
  }
  throw error instanceof Error ? error : new Error('saving the custom exercise failed')
}

export function registerCustomExerciseTools(server: McpServer): void {
  server.registerTool(
    'create_custom_exercise',
    {
      title: 'Create Custom Exercise',
      description:
        "Creates a per-user custom exercise for movements the public catalog lacks. Identity is the composite (source: 'custom', wgerExerciseId) — pass BOTH wherever the exercise is referenced. Tag primary/secondary muscles with catalog muscle names so muscle-volume and replacement suggestions include it. Search the catalog first: creating a near-duplicate of an existing entry fragments history.",
      inputSchema: {
        name: nameArg,
        category: categoryArg,
        equipment: namesArg,
        muscles: namesArg,
        musclesSecondary: namesArg,
        userId: z.string().optional(),
      },
    },
    async ({ name, category, equipment, muscles, musclesSecondary, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        const row = await createCustomExercise(resolved, {
          name,
          category,
          ...(equipment ? { equipment } : {}),
          ...(muscles ? { muscles } : {}),
          ...(musclesSecondary ? { musclesSecondary } : {}),
        }).catch(translateDuplicateName)
        return jsonResult({ userId: resolved, exercise: toResult(row) })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'update_custom_exercise',
    {
      title: 'Update Custom Exercise',
      description:
        'Full-field update of an owned custom exercise (name, category, equipment, muscles). Omitted array fields are CLEARED, not kept — fetch current values via list_custom_exercises first and resend what should survive.',
      inputSchema: {
        wgerExerciseId: z.number().int().positive(),
        name: nameArg,
        category: categoryArg,
        equipment: namesArg,
        muscles: namesArg,
        musclesSecondary: namesArg,
        userId: z.string().optional(),
      },
    },
    async (
      { wgerExerciseId, name, category, equipment, muscles, musclesSecondary, userId },
      extra,
    ) => {
      try {
        const resolved = resolveUserId(extra, userId)
        const row = await updateCustomExercise(resolved, wgerExerciseId, {
          name,
          category,
          ...(equipment ? { equipment } : {}),
          ...(muscles ? { muscles } : {}),
          ...(musclesSecondary ? { musclesSecondary } : {}),
        }).catch(translateDuplicateName)
        if (!row) throw new ToolError('custom exercise not found for this user')
        return jsonResult({ userId: resolved, exercise: toResult(row) })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'list_custom_exercises',
    {
      title: 'List Custom Exercises',
      description:
        "The user's custom exercise definitions (name, category, muscles) with their composite ids. Merged catalog search also returns these — this list is the authoritative definition view for edits.",
      inputSchema: {
        userId: z.string().optional(),
      },
    },
    async ({ userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        const rows = await listCustomExercises(resolved)
        return jsonResult({
          userId: resolved,
          count: rows.length,
          exercises: rows.map(toResult),
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )
}
