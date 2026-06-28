import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { resolveUserId } from './resolve-user'
import { jsonResult, errorResult } from './result'
import { ToolError } from './errors'
import { assertWorkoutIdShape } from './workout-id'
import { updateSet, addSet, removeSet, updateWorkoutMeta } from '@/db/workouts'
import { getWeightUnit } from '@/db/preferences'
import { displayToKg, kgToDisplay, type WeightUnit } from '@/lib/units'
import { MAX_WEIGHT as MAX_WEIGHT_KG, parseStartedAt } from '@/lib/workout-input'

/** Optional explicit unit override; absent → the user's stored unit. */
const unitArg = z.enum(['kg', 'lb']).optional()
/** reps: a non-negative integer, null to blank, or omitted to leave unchanged. */
const repsArg = z.number().int().min(0).max(10_000).nullable().optional()
/** weight in the display unit; null to blank, omitted to leave unchanged (bounded in kg after conversion). */
const weightArg = z.number().nullable().optional()

/**
 * Converts a single display-unit weight to canonical kg, bounding it with a
 * message in the agent's unit. `undefined` (not provided) and `null` (explicit
 * blank) pass straight through — only a real number is converted and range-checked.
 */
function toKgWeight(
  weight: number | null | undefined,
  unit: WeightUnit,
): number | null | undefined {
  if (weight === undefined || weight === null) return weight
  const kg = displayToKg(weight, unit)
  if (kg < 0 || kg > MAX_WEIGHT_KG) {
    const maxDisplay = kgToDisplay(MAX_WEIGHT_KG, unit)
    throw new ToolError(`set weight must be a number between 0 and ${maxDisplay} ${unit}, or null`)
  }
  return kg
}

/**
 * Registers the Phase 8 partial-edit tools — targeted, single-purpose edits so
 * an agent can "fix set 3" without resending the whole workout (the full-replace
 * `update_workout` still exists for wholesale changes).
 *
 * `update_set` / `add_set` / `remove_set` address a set by `workoutId` + 0-based
 * exercise `position` + 1-based `setNumber`; `set_workout_meta` renames and/or
 * backdates. Like the other tools each handler funnels its user through
 * `resolveUserId` (the authorization boundary), guards the id shape, converts
 * display weights to kg, and surfaces not-owned/not-found as a `ToolError`. The
 * DB ops are themselves user-scoped, so ownership is enforced at two layers.
 */
export function registerPatchTools(server: McpServer): void {
  server.registerTool(
    'update_set',
    {
      title: 'Update Set',
      description:
        "Updates one set's reps and/or weight, addressed by workoutId, 0-based exercise position, and 1-based set number. Weights are in the user's unit (or the `unit` arg). Only the named fields change; pass null to blank one. Errors if the workout/exercise/set isn't found or owned.",
      inputSchema: {
        workoutId: z.string(),
        exercisePosition: z.number().int().min(0),
        setNumber: z.number().int().min(1),
        reps: repsArg,
        weight: weightArg,
        unit: unitArg,
        userId: z.string().optional(),
      },
    },
    async ({ workoutId, exercisePosition, setNumber, reps, weight, unit, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertWorkoutIdShape(workoutId)
        if (reps === undefined && weight === undefined) {
          throw new ToolError('update_set needs at least one of reps or weight')
        }
        // Only resolve the unit when a weight needs converting.
        const basis = weight === undefined ? undefined : (unit ?? (await getWeightUnit(resolved)))
        const patch = {
          ...(reps !== undefined ? { reps } : {}),
          ...(weight !== undefined ? { weight: toKgWeight(weight, basis as WeightUnit) } : {}),
        }
        const result = await updateSet(resolved, workoutId, exercisePosition, setNumber, patch)
        if (!result) {
          throw new ToolError(
            `Set ${setNumber} of exercise ${exercisePosition} in workout ${workoutId} not found`,
          )
        }
        return jsonResult({
          userId: resolved,
          ...(basis ? { unit: basis } : {}),
          workoutId,
          exercisePosition,
          setNumber,
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'add_set',
    {
      title: 'Add Set',
      description:
        "Appends a set to an exercise (by workoutId + 0-based position), numbered after the current last set. reps/weight default to blank; weight is in the user's unit (or the `unit` arg). Returns the new set number. Errors if the workout/exercise isn't found or owned.",
      inputSchema: {
        workoutId: z.string(),
        exercisePosition: z.number().int().min(0),
        reps: repsArg,
        weight: weightArg,
        unit: unitArg,
        userId: z.string().optional(),
      },
    },
    async ({ workoutId, exercisePosition, reps, weight, unit, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertWorkoutIdShape(workoutId)
        const basis =
          weight === undefined || weight === null ? undefined : (unit ?? (await getWeightUnit(resolved)))
        const kgWeight = basis === undefined ? (weight ?? null) : toKgWeight(weight, basis)
        const result = await addSet(resolved, workoutId, exercisePosition, {
          reps: reps ?? null,
          weight: kgWeight ?? null,
        })
        if (!result) {
          throw new ToolError(`Exercise ${exercisePosition} in workout ${workoutId} not found`)
        }
        return jsonResult({
          userId: resolved,
          ...(basis ? { unit: basis } : {}),
          workoutId,
          exercisePosition,
          setNumber: result.setNumber,
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'remove_set',
    {
      title: 'Remove Set',
      description:
        'Removes one set (by workoutId + 0-based exercise position + 1-based set number) and renumbers the higher sets down so the order stays contiguous. Errors if the workout/exercise/set isn\'t found or owned.',
      inputSchema: {
        workoutId: z.string(),
        exercisePosition: z.number().int().min(0),
        setNumber: z.number().int().min(1),
        userId: z.string().optional(),
      },
    },
    async ({ workoutId, exercisePosition, setNumber, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertWorkoutIdShape(workoutId)
        const result = await removeSet(resolved, workoutId, exercisePosition, setNumber)
        if (!result) {
          throw new ToolError(
            `Set ${setNumber} of exercise ${exercisePosition} in workout ${workoutId} not found`,
          )
        }
        return jsonResult({ userId: resolved, workoutId, exercisePosition, removedSetNumber: setNumber })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'set_workout_meta',
    {
      title: 'Set Workout Meta',
      description:
        "Renames and/or backdates a workout without touching its exercises/sets. Pass `name` (empty string clears it) and/or `startedAt` (ISO 8601, not in the future). Errors if the workout isn't found or owned.",
      inputSchema: {
        workoutId: z.string(),
        name: z.string().optional(),
        startedAt: z.string().datetime().optional(),
        userId: z.string().optional(),
      },
    },
    async ({ workoutId, name, startedAt, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertWorkoutIdShape(workoutId)
        if (name === undefined && startedAt === undefined) {
          throw new ToolError('set_workout_meta needs at least one of name or startedAt')
        }
        // parseStartedAt throws a plain Error on a future/invalid date; re-throw as
        // a ToolError so the real message reaches the agent instead of being genericized.
        let parsedStartedAt: Date | undefined
        try {
          parsedStartedAt = parseStartedAt(startedAt)
        } catch (error: unknown) {
          throw new ToolError(error instanceof Error ? error.message : 'invalid startedAt')
        }
        const meta = {
          ...(name !== undefined ? { name: name.trim() === '' ? null : name.trim() } : {}),
          ...(parsedStartedAt ? { startedAt: parsedStartedAt } : {}),
        }
        const result = await updateWorkoutMeta(resolved, workoutId, meta)
        if (!result) {
          throw new ToolError(`Workout ${workoutId} not found for user ${resolved}`)
        }
        return jsonResult({ userId: resolved, workoutId })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )
}
