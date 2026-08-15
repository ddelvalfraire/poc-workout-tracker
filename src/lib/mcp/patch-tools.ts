import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { resolveUserId } from './resolve-user'
import { jsonResult, errorResult } from './result'
import { ToolError } from './errors'
import { assertWorkoutIdShape } from './workout-id'
import { updateSet, addSet, removeSet, updateWorkoutMeta, updateExerciseMeta } from '@/db/workouts'
import { getWeightUnit } from '@/db/preferences'
import { displayToKg, kgToDisplay, type WeightUnit } from '@/lib/units'
import { MAX_WEIGHT as MAX_WEIGHT_KG, MAX_DURATION_SEC, MAX_DISTANCE_M, METRIC_MODES, parseStartedAt, parseNotes } from '@/lib/workout-input'
import { isValidRir, isValidRpe, RIR_MIN, RIR_MAX, RPE_MIN, RPE_MAX } from '@/lib/effort'

/** Optional explicit unit override; absent → the user's stored unit. */
const unitArg = z.enum(['kg', 'lb']).optional()
/** reps: a non-negative integer, null to blank, or omitted to leave unchanged. */
const repsArg = z.number().int().min(0).max(10_000).nullable().optional()
/** weight in the display unit; null to blank, omitted to leave unchanged (bounded in kg after conversion). */
const weightArg = z.number().nullable().optional()
/** Logged effort args — lib/effort.ts owns the ranges (rir 0–10 int, rpe 4–10
 *  half steps); null blanks, omitted leaves unchanged. Validated in the
 *  handler so the message names the grid instead of a generic zod failure. */
const rirArg = z.number().nullable().optional()
const rpeArg = z.number().nullable().optional()
/** Cardio fields (canonical units on the wire: seconds / meters — no display
 *  conversion). null blanks, omitted leaves unchanged; metricMode is NOT NULL
 *  in the column so it has no null arm. */
const metricModeArg = z.enum(METRIC_MODES).optional()
const durationSecArg = z.number().int().min(0).max(MAX_DURATION_SEC).nullable().optional()
const distanceMArg = z.number().min(0).max(MAX_DISTANCE_M).nullable().optional()

/** Throws a ToolError unless the effort values sit on the shared grid. */
function assertEffortArgs(rir: number | null | undefined, rpe: number | null | undefined): void {
  if (rir !== undefined && rir !== null && !isValidRir(rir)) {
    throw new ToolError(`rir must be an integer between ${RIR_MIN} and ${RIR_MAX}, or null`)
  }
  if (rpe !== undefined && rpe !== null && !isValidRpe(rpe)) {
    throw new ToolError(`rpe must be between ${RPE_MIN} and ${RPE_MAX} in 0.5 steps, or null`)
  }
}

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
 * exercise `position` + 1-based `setNumber`; `set_workout_meta` renames,
 * backdates, and/or annotates; `set_exercise_meta` notes/skips one exercise.
 * Like the other tools each handler funnels its user through
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
        "Updates one set's reps, weight, completed flag, logged effort (rir 0-10 integer, rpe 4-10 in 0.5 steps), and/or cardio fields (metricMode reps_weight|duration|duration_distance; durationSec; distanceM in meters), addressed by workoutId, 0-based exercise position, and 1-based set number. Weights are in the user's unit (or the `unit` arg); duration/distance are canonical seconds/meters. Only the named fields change; pass null to blank reps/weight/rir/rpe/durationSec/distanceM. `completed: true` checks the set off (what the web logger's in-session toggle does). Errors if the workout/exercise/set isn't found or owned.",
      inputSchema: {
        workoutId: z.string(),
        exercisePosition: z.number().int().min(0),
        setNumber: z.number().int().min(1),
        reps: repsArg,
        weight: weightArg,
        completed: z.boolean().optional(),
        rir: rirArg,
        rpe: rpeArg,
        metricMode: metricModeArg,
        durationSec: durationSecArg,
        distanceM: distanceMArg,
        unit: unitArg,
        userId: z.string().optional(),
      },
    },
    async ({ workoutId, exercisePosition, setNumber, reps, weight, completed, rir, rpe, metricMode, durationSec, distanceM, unit, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertWorkoutIdShape(workoutId)
        if (
          reps === undefined &&
          weight === undefined &&
          completed === undefined &&
          rir === undefined &&
          rpe === undefined &&
          metricMode === undefined &&
          durationSec === undefined &&
          distanceM === undefined
        ) {
          throw new ToolError(
            'update_set needs at least one of reps, weight, completed, rir, rpe, metricMode, durationSec, or distanceM',
          )
        }
        assertEffortArgs(rir, rpe)
        // Resolve the unit only when a weight needs converting — which also
        // narrows `basis` to a real WeightUnit at the conversion site (no cast).
        const patch: {
          reps?: number | null
          weight?: number | null
          completed?: boolean
          rir?: number | null
          rpe?: number | null
          metricMode?: (typeof METRIC_MODES)[number]
          durationSec?: number | null
          distanceM?: number | null
        } = {}
        if (reps !== undefined) patch.reps = reps
        if (completed !== undefined) patch.completed = completed
        if (rir !== undefined) patch.rir = rir
        if (rpe !== undefined) patch.rpe = rpe
        if (metricMode !== undefined) patch.metricMode = metricMode
        if (durationSec !== undefined) patch.durationSec = durationSec
        if (distanceM !== undefined) patch.distanceM = distanceM
        let basis: WeightUnit | undefined
        if (weight !== undefined) {
          basis = unit ?? (await getWeightUnit(resolved))
          patch.weight = toKgWeight(weight, basis) ?? null
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
        "Appends a set to an exercise (by workoutId + 0-based position), numbered after the current last set. reps/weight default to blank; weight is in the user's unit (or the `unit` arg). Optionally log effort with `rir`/`rpe`, or cardio fields (metricMode duration|duration_distance with durationSec seconds and distanceM meters). Pass `completed: true` to check the new set off as done. Returns the new set number. Errors if the workout/exercise isn't found or owned.",
      inputSchema: {
        workoutId: z.string(),
        exercisePosition: z.number().int().min(0),
        reps: repsArg,
        weight: weightArg,
        completed: z.boolean().optional(),
        rir: rirArg,
        rpe: rpeArg,
        metricMode: metricModeArg,
        durationSec: durationSecArg,
        distanceM: distanceMArg,
        unit: unitArg,
        userId: z.string().optional(),
      },
    },
    async ({ workoutId, exercisePosition, reps, weight, completed, rir, rpe, metricMode, durationSec, distanceM, unit, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertWorkoutIdShape(workoutId)
        assertEffortArgs(rir, rpe)
        const basis =
          weight === undefined || weight === null ? undefined : (unit ?? (await getWeightUnit(resolved)))
        const kgWeight = basis === undefined ? (weight ?? null) : toKgWeight(weight, basis)
        const result = await addSet(resolved, workoutId, exercisePosition, {
          reps: reps ?? null,
          weight: kgWeight ?? null,
          ...(completed !== undefined && { completed }),
          ...(rir !== undefined && { rir }),
          ...(rpe !== undefined && { rpe }),
          ...(metricMode !== undefined && { metricMode }),
          ...(durationSec !== undefined && { durationSec }),
          ...(distanceM !== undefined && { distanceM }),
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
        "Renames, backdates, and/or annotates a workout without touching its exercises/sets. Pass `name` (empty string clears it), `startedAt` (ISO 8601, not in the future), and/or `notes` (free-form session note, empty string clears it). Errors if the workout isn't found or owned.",
      inputSchema: {
        workoutId: z.string(),
        name: z.string().optional(),
        startedAt: z.string().datetime().optional(),
        notes: z.string().optional(),
        userId: z.string().optional(),
      },
    },
    async ({ workoutId, name, startedAt, notes, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertWorkoutIdShape(workoutId)
        if (name === undefined && startedAt === undefined && notes === undefined) {
          throw new ToolError('set_workout_meta needs at least one of name, startedAt, or notes')
        }
        // parseStartedAt/parseNotes throw a plain Error on a bad value; re-throw as
        // a ToolError so the real message reaches the agent instead of being genericized.
        let parsedStartedAt: Date | undefined
        let parsedNotes: string | null | undefined
        try {
          parsedStartedAt = parseStartedAt(startedAt)
          // parseNotes trims and bounds; blank → undefined, which here means CLEAR
          // (the arg was given), so it maps to null — same rule as name above.
          if (notes !== undefined) parsedNotes = parseNotes(notes, 'workout') ?? null
        } catch (error: unknown) {
          throw new ToolError(error instanceof Error ? error.message : 'invalid workout meta')
        }
        const meta = {
          ...(name !== undefined ? { name: name.trim() === '' ? null : name.trim() } : {}),
          ...(parsedStartedAt !== undefined ? { startedAt: parsedStartedAt } : {}),
          ...(parsedNotes !== undefined ? { notes: parsedNotes } : {}),
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

  server.registerTool(
    'set_exercise_meta',
    {
      title: 'Set Exercise Meta',
      description:
        "Sets one workout exercise's note and/or skipped flag (by workoutId + 0-based position) without touching its sets. `notes` is a free-form note (empty string clears it); `skipped: true` means the lifter didn't do this exercise that day — the sets stay as logged (uncompleted), never completed or deleted. Errors if the workout/exercise isn't found or owned.",
      inputSchema: {
        workoutId: z.string(),
        exercisePosition: z.number().int().min(0),
        notes: z.string().optional(),
        skipped: z.boolean().optional(),
        userId: z.string().optional(),
      },
    },
    async ({ workoutId, exercisePosition, notes, skipped, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertWorkoutIdShape(workoutId)
        if (notes === undefined && skipped === undefined) {
          throw new ToolError('set_exercise_meta needs at least one of notes or skipped')
        }
        // Same clear-on-blank rule as set_workout_meta's notes; parseNotes throws
        // a plain Error over the cap — re-throw as ToolError to keep the message.
        let parsedNotes: string | null | undefined
        try {
          if (notes !== undefined) parsedNotes = parseNotes(notes, 'exercise') ?? null
        } catch (error: unknown) {
          throw new ToolError(error instanceof Error ? error.message : 'invalid exercise notes')
        }
        const result = await updateExerciseMeta(resolved, workoutId, exercisePosition, {
          ...(parsedNotes !== undefined ? { notes: parsedNotes } : {}),
          ...(skipped !== undefined ? { skipped } : {}),
        })
        if (!result) {
          throw new ToolError(`Exercise ${exercisePosition} in workout ${workoutId} not found`)
        }
        return jsonResult({ userId: resolved, workoutId, exercisePosition })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )
}
