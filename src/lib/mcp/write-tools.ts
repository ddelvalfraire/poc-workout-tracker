import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { resolveUserId, resolveWorkoutActor } from './resolve-user'
import { jsonResult, errorResult } from './result'
import { ToolError } from './errors'
import { assertWorkoutIdShape } from './workout-id'
import { parseWorkoutInput, MAX_WEIGHT as MAX_WEIGHT_KG, MAX_DURATION_SEC, MAX_DISTANCE_M, METRIC_MODES, type WorkoutInput } from '@/lib/workout/workout-input'
import { displayToKg, kgToDisplay, type WeightUnit } from '@/lib/units'
import { saveWorkout, updateWorkout, deleteWorkout } from '@/db/workouts'
import { completeWorkoutSideEffects } from '@/lib/workout/workout-completion'
import { getWeightUnit, setWeightUnit } from '@/db/preferences'
import { getExerciseNote, upsertExerciseNote, deleteExerciseNote } from '@/db/exercise-notes'
import { parseExerciseNoteInput } from '@/lib/notes/exercise-note-input'

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
    sets: z.array(
      z.object({
        reps: z.number().int().nullable(),
        weight: z.number().nullable(),
        // Cardio fields (canonical seconds/meters — no display conversion);
        // optional so pre-cardio callers keep their shape. parseWorkoutInput
        // re-validates the cross-field rules downstream.
        metricMode: z.enum(METRIC_MODES).optional(),
        durationSec: z.number().int().min(0).max(MAX_DURATION_SEC).nullable().optional(),
        distanceM: z.number().min(0).max(MAX_DISTANCE_M).nullable().optional(),
      }),
    ),
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
        // Seconds/meters are canonical on the wire — pass-through, no conversion.
        ...(s.metricMode !== undefined ? { metricMode: s.metricMode } : {}),
        ...(s.durationSec !== undefined ? { durationSec: s.durationSec } : {}),
        ...(s.distanceM !== undefined ? { distanceM: s.distanceM } : {}),
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
 *
 * Post-save side effects, and what deliberately does NOT ride here:
 * - The DOMAIN pipeline (plan sync → goals → trophies) is shared with the web
 *   actions via lib/workout-completion.ts — an MCP-logged finish syncs the
 *   plan, completes goals, and earns trophies exactly like a web finish.
 * - ANALYTICS stays web-only: MCP tool writes fire no product events, by the
 *   documented decision in lib/analytics.ts.
 * - The logger's cross-device DRAFT is untouched: a draft is the web logger's
 *   own in-progress session, and an agent-logged workout is not that session —
 *   deleting it here would destroy work the user may still resume.
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
        // An agent logging a session is that session's ORIGINAL record —
        // it is being created here, not corrected.
        const { id } = await saveWorkout(resolved, parsed, {
          actor: resolveWorkoutActor(extra),
          kind: 'original',
        })
        // An MCP log IS a completion (saveWorkout stamps completedAt), so the
        // shared post-save pipeline rides here exactly as in the web save
        // action. Fails soft inside — it can never fail the committed save.
        await completeWorkoutSideEffects(resolved, id)
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
        // A full replace of an already-persisted session CONTRADICTS what
        // was recorded — that is an amendment, whatever the values.
        const result = await updateWorkout(resolved, id, parsed, {
          actor: resolveWorkoutActor(extra),
          kind: 'amendment',
        })
        if (!result) {
          throw new ToolError(`Workout ${id} not found for user ${resolved}`)
        }
        // Same shared post-save pipeline as create_workout (and the web edit
        // action): a replaced session must sync the plan, complete goals, and
        // stamp trophies like any other finish. Fails soft inside.
        await completeWorkoutSideEffects(resolved, result.id)
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
    'set_exercise_note',
    {
      title: 'Set Exercise Note',
      description:
        "Creates, replaces, or clears the user's IDENTITY note for an exercise — the note that follows the exercise across every workout (seat pins, setup, cues), distinct from set_exercise_meta's per-workout-instance notes. `body` is markdown (markdown is the stored source of truth). An empty/blank body deletes the note; deleting when no note exists is a soft no-op — the result carries `deleted: false` rather than an error. `pinned: true` resurfaces the note as a sticky chip in the live logger; omitted, an existing note keeps its pin state (new notes default unpinned). Identity is the composite (source, wgerExerciseId); `source` defaults to 'wger'.",
      inputSchema: {
        wgerExerciseId: z.number().int().positive(),
        source: z.enum(['wger', 'custom']).optional(),
        body: z.string(),
        pinned: z.boolean().optional(),
        userId: z.string().optional(),
      },
    },
    async ({ wgerExerciseId, source, body, pinned, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        const src = source ?? 'wger'
        if (body.trim() === '') {
          const deleted = await deleteExerciseNote(resolved, src, wgerExerciseId)
          return jsonResult({ userId: resolved, source: src, wgerExerciseId, deleted, note: null })
        }
        // Pin inheritance: an omitted `pinned` must never silently unpin an
        // existing note (the chip vanishing would read as data loss).
        const effectivePinned = pinned ?? (await getExerciseNote(resolved, src, wgerExerciseId))?.pinned ?? false
        const parsed = parseExerciseNoteInput({ body, pinned: effectivePinned })
        const row = await upsertExerciseNote(resolved, src, wgerExerciseId, parsed)
        return jsonResult({
          userId: resolved,
          source: src,
          wgerExerciseId,
          note: { body: row.body, pinned: row.pinned },
        })
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
