import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { resolveUserId } from './resolve-user'
import { jsonResult, errorResult } from './result'
import { ToolError } from './errors'
import { assertWorkoutIdShape } from './workout-id'
import { parseWorkoutInput, MAX_WEIGHT as MAX_WEIGHT_KG, type WorkoutInput } from '@/lib/workout-input'
import { displayToKg, kgToDisplay, type WeightUnit } from '@/lib/units'
import { saveWorkout, updateWorkout, deleteWorkout } from '@/db/workouts'
import { getWeightUnit, setWeightUnit } from '@/db/preferences'

/** Workout body shape the create/update tools accept (weights in display unit). */
const exercisesSchema = z.array(
  z.object({
    wgerExerciseId: z.number().int(),
    // Composite identity: absent = 'wger' (the column default), so
    // pre-discriminator callers keep their shape.
    source: z.enum(['wger', 'custom']).optional(),
    name: z.string(),
    // Free-form per-exercise note; length/trim rules live in parseWorkoutInput.
    notes: z.string().optional(),
    // Skipped in-session ("didn't do this"); the sets save uncompleted either way.
    skipped: z.boolean().optional(),
    sets: z.array(z.object({ reps: z.number().int().nullable(), weight: z.number().nullable() })),
  }),
)

/** Optional explicit unit override; absent → the user's stored unit. */
const unitArg = z.enum(['kg', 'lb']).optional()

/** Optional ISO-8601 backdate for create/update; parsed + future-checked downstream. */
const startedAtArg = z.string().datetime().optional()

/** The raw (display-unit) workout body before kg conversion. */
type RawWorkout = {
  name?: string
  /** Free-form session note; trimmed/bounded by `parseWorkoutInput`. */
  notes?: string
  exercises: z.infer<typeof exercisesSchema>
  /** ISO date string; `parseWorkoutInput` converts it to a Date and rejects the future. */
  startedAt?: string
}

/**
 * Converts agent-supplied display-unit weights to canonical kg, building the
 * object `parseWorkoutInput` expects. Only non-null weights are converted; reps
 * and blank (`null`) fields pass through untouched.
 */
function toKgInput(raw: RawWorkout, unit: WeightUnit): RawWorkout {
  return {
    name: raw.name,
    notes: raw.notes,
    startedAt: raw.startedAt,
    exercises: raw.exercises.map((e) => ({
      wgerExerciseId: e.wgerExerciseId,
      ...(e.source !== undefined ? { source: e.source } : {}),
      name: e.name,
      ...(e.notes !== undefined ? { notes: e.notes } : {}),
      ...(e.skipped !== undefined ? { skipped: e.skipped } : {}),
      sets: e.sets.map((s) => ({
        reps: s.reps,
        weight: s.weight === null ? null : displayToKg(s.weight, unit),
      })),
    })),
  }
}

/**
 * Range-checks the already-converted (kg) weights and, on any out-of-range value,
 * throws a `ToolError` stating the bound in the agent's *display* unit. The numeric
 * test is on the kg value, so it agrees exactly with `parseWorkoutInput`'s kg
 * backstop; only the message differs — an agent that submitted lb sees an lb bound
 * instead of `parseWorkoutInput`'s canonical-kg one. Weight is always a finite
 * number or null here (the tool's zod `inputSchema` guarantees it), so the only
 * failing conditions are below 0 or above the ceiling.
 */
function assertWeightsInRange(kgInput: RawWorkout, unit: WeightUnit): void {
  const outOfRange = kgInput.exercises.some((e) =>
    e.sets.some((s) => s.weight !== null && (s.weight < 0 || s.weight > MAX_WEIGHT_KG)),
  )
  if (!outOfRange) return
  const max = kgToDisplay(MAX_WEIGHT_KG, unit)
  throw new ToolError(`set weight must be a number between 0 and ${max} ${unit}, or null`)
}

/**
 * Converts then validates. The weight bound is checked first so the message is in
 * the agent's unit; the remaining structural checks fall to `parseWorkoutInput`,
 * which throws a plain `Error` that `errorResult` would genericize to "MCP tool
 * failed" — re-throw as a `ToolError` so the real validation message reaches the
 * agent.
 */
function validate(raw: RawWorkout, unit: WeightUnit): WorkoutInput {
  const kgInput = toKgInput(raw, unit)
  assertWeightsInRange(kgInput, unit)
  try {
    return parseWorkoutInput(kgInput)
  } catch (error: unknown) {
    throw new ToolError(error instanceof Error ? error.message : 'invalid workout input')
  }
}

/**
 * Registers the Phase 3 write tools — the agent's ability to mutate a user's
 * training: create, update, and delete a workout, plus set the weight unit.
 *
 * The write-side twin of `registerReadTools`. Like the read tools, every handler
 * funnels its `userId` through `resolveUserId` (the MCP authorization boundary)
 * and echoes the resolved id back. Weights are the mirror image of the read
 * side: the agent supplies them in the user's display unit and they are
 * converted to canonical kg via `displayToKg` *before* validation, since
 * `parseWorkoutInput` bounds weights in kg. Validation and not-owned conditions
 * surface as `ToolError` (so the agent sees the message); real DB failures fall
 * through to `errorResult`, which logs and genericizes them.
 */
export function registerWriteTools(server: McpServer): void {
  server.registerTool(
    'create_workout',
    {
      title: 'Create Workout',
      description:
        "Logs a new workout for the user. Weights are given in the user's unit (or the `unit` arg) and stored as kg. Pass `startedAt` (ISO 8601) to backdate a past session; omit it to stamp now. Optional `notes` (session-level) and per-exercise `notes`/`skipped` are stored too — `skipped: true` means the lifter didn't do that exercise; its sets stay uncompleted. Returns the new workoutId; call get_workout to confirm.",
      inputSchema: {
        name: z.string().optional(),
        notes: z.string().optional(),
        exercises: exercisesSchema,
        unit: unitArg,
        startedAt: startedAtArg,
        userId: z.string().optional(),
      },
    },
    async ({ name, notes, exercises, unit, startedAt, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        const basis = unit ?? (await getWeightUnit(resolved))
        const parsed = validate({ name, notes, exercises, startedAt }, basis)
        const { id } = await saveWorkout(resolved, parsed)
        return jsonResult({ userId: resolved, unit: basis, workoutId: id })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'update_workout',
    {
      title: 'Update Workout',
      description:
        'Replaces an existing workout (owned by the user) with the given exercises/sets. Full replace, not a partial edit — session `notes` and per-exercise `notes`/`skipped` follow the same rule: omitting them clears them (to set/clear only workout notes, prefer set_workout_meta; for one exercise, set_exercise_meta). Pass `startedAt` (ISO 8601) to also change the session date; omit it to keep the existing one. Errors if the workout is not found or not owned.',
      inputSchema: {
        id: z.string(),
        name: z.string().optional(),
        notes: z.string().optional(),
        exercises: exercisesSchema,
        unit: unitArg,
        startedAt: startedAtArg,
        userId: z.string().optional(),
      },
    },
    async ({ id, name, notes, exercises, unit, startedAt, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertWorkoutIdShape(id)
        const basis = unit ?? (await getWeightUnit(resolved))
        const parsed = validate({ name, notes, exercises, startedAt }, basis)
        const result = await updateWorkout(resolved, id, parsed)
        if (!result) {
          throw new ToolError(`Workout ${id} not found for user ${resolved}`)
        }
        return jsonResult({ userId: resolved, unit: basis, workoutId: result.id })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'delete_workout',
    {
      title: 'Delete Workout',
      description:
        'Deletes a workout (owned by the user) and its sets. Errors if the workout is not found or not owned.',
      inputSchema: { id: z.string(), userId: z.string().optional() },
    },
    async ({ id, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertWorkoutIdShape(id)
        const [deleted] = await deleteWorkout(resolved, id)
        if (!deleted) {
          throw new ToolError(`Workout ${id} not found for user ${resolved}`)
        }
        return jsonResult({ userId: resolved, workoutId: deleted.id, deleted: true })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'set_weight_unit',
    {
      title: 'Set Weight Unit',
      description:
        "Sets the user's stored weight unit ('kg' or 'lb'), the basis for weights the other tools read and write.",
      inputSchema: { unit: z.enum(['kg', 'lb']), userId: z.string().optional() },
    },
    async ({ unit, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        await setWeightUnit(resolved, unit)
        return jsonResult({ userId: resolved, unit })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )
}
