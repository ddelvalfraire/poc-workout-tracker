import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { resolveUserId } from './resolve-user'
import { jsonResult, errorResult } from './result'
import { ToolError } from './errors'
import { assertWorkoutIdShape } from './workout-id'
import {
  listWorkoutSummaries,
  getWorkoutDetail,
  getLastPerformance,
  type WorkoutDetail,
} from '@/db/workouts'
import { getProgramDayDetail, type ProgramDayDetail } from '@/db/programs'
import { getWeightUnit, getBodyweightKg } from '@/db/preferences'
import { searchExercises } from '@/lib/wger'
import { kgToDisplay, type WeightUnit } from '@/lib/units'
import { bestScoredSet } from '@/lib/one-rep-max'
import type { LoggingType } from '@/lib/workout-input'
import { buildProgramDayView, type ProgramDayView } from './program-tools'

/**
 * Registers the Phase 2 read tools — the agent's read-only window into a user's
 * training and the exercise catalog.
 *
 * Each user-scoped tool funnels its `userId` through `resolveUserId` (the MCP
 * authorization boundary) and echoes the resolved id back so the agent can
 * confirm whose data it read. Weights are stored in kg and converted to the
 * user's unit at this boundary via `kgToDisplay`; the `unit` is echoed in every
 * payload so the agent isn't guessing the basis. `search_exercises` is the lone
 * exception — the catalog is public reference data, so it takes no `userId`.
 */
export function registerReadTools(server: McpServer): void {
  server.registerTool(
    'list_workouts',
    {
      title: 'List Workouts',
      description:
        "Lists the user's workouts (most recent first) with exercise and set counts. Use to review recent training before drilling into one.",
      inputSchema: { userId: z.string().optional() },
    },
    async ({ userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        const rows = await listWorkoutSummaries(resolved)
        return jsonResult({
          userId: resolved,
          workouts: rows.map((r) => ({
            ...r,
            startedAt: r.startedAt.toISOString(),
            completedAt: r.completedAt?.toISOString() ?? null,
          })),
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'get_workout',
    {
      title: 'Get Workout',
      description:
        "Returns one workout (owned by the user) with its exercises and sets, weights in the user's unit, plus a per-exercise estimated 1RM.",
      inputSchema: { id: z.string(), userId: z.string().optional() },
    },
    async ({ id, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertWorkoutIdShape(id)
        // Resolve the workout first; only fetch the unit once we know it exists,
        // so the not-found path does no wasted query.
        const workout = await getWorkoutDetail(resolved, id)
        if (!workout) {
          return errorResult(new ToolError(`Workout ${id} not found for user ${resolved}`))
        }
        // Bodyweight is fetched once per request, like the unit — it's the
        // load basis for any bodyweight-type exercise's estimated 1RM.
        const [unit, bodyweightKg] = await Promise.all([
          getWeightUnit(resolved),
          getBodyweightKg(resolved),
        ])
        // When the workout was instantiated from a program day, overlay that day's
        // prescription (targets) — read from the program, never stored on the sets.
        const programDay = workout.programDayId
          ? await getProgramDayDetail(resolved, workout.programDayId)
          : null
        return jsonResult(
          buildWorkoutPayload(workout, resolved, unit, bodyweightKg, programDay ?? undefined),
        )
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'search_exercises',
    {
      title: 'Search Exercises',
      description:
        'Searches the public exercise catalog by name and/or category. Use to resolve an exercise name to its wgerExerciseId. No userId needed.',
      inputSchema: {
        search: z.string().optional(),
        category: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async ({ search, category, limit }) => {
      try {
        const exercises = await searchExercises({ search, category, limit })
        return jsonResult({ count: exercises.length, exercises })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'get_last_performance',
    {
      title: 'Get Last Performance',
      description:
        "Returns the user's most recent prior performance of an exercise (by wgerExerciseId) — when and the sets done, weights in the user's unit. Use to answer \"what did I do last time?\".",
      inputSchema: {
        wgerExerciseId: z.number().int(),
        userId: z.string().optional(),
        excludeWorkoutId: z.string().optional(),
      },
    },
    async ({ wgerExerciseId, userId, excludeWorkoutId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        const [last, unit] = await Promise.all([
          getLastPerformance(resolved, wgerExerciseId, excludeWorkoutId),
          getWeightUnit(resolved),
        ])
        return jsonResult({
          userId: resolved,
          unit,
          wgerExerciseId,
          lastPerformance:
            last === null
              ? null
              : {
                  performedAt: last.performedAt.toISOString(),
                  sets: last.sets.map((s) => ({
                    reps: s.reps,
                    weight: s.weight === null ? null : kgToDisplay(s.weight, unit),
                  })),
                },
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'get_weight_unit',
    {
      title: 'Get Weight Unit',
      description:
        "Returns the user's stored weight unit ('kg' or 'lb'). The basis for every weight the other tools return.",
      inputSchema: { userId: z.string().optional() },
    },
    async ({ userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        const unit = await getWeightUnit(resolved)
        return jsonResult({ userId: resolved, unit })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )
}

/**
 * The agent-facing shape of a single workout — what the `get_workout` tool and
 * the `workout://{id}` resource both return. Weights are in the user's display
 * unit; `startedAt` is an ISO string.
 */
export interface WorkoutPayload {
  userId: string
  unit: WeightUnit
  workout: {
    id: string
    name: string | null
    startedAt: string
    // Provenance: the program day this workout was instantiated from (null for
    // ad-hoc workouts). `plan` carries that day's prescription as a read overlay.
    programDayId: string | null
    programWeek: number | null
    plan?: ProgramDayView
    exercises: {
      id: string
      wgerExerciseId: number
      name: string
      position: number
      // How the sets' weights read (total / ignored / added / assistance).
      loggingType: LoggingType
      sets: { setNumber: number; reps: number | null; weight: number | null; completed: boolean }[]
      estimated1RM: number | null
      // Additive rep-fallback readout: the best set's rep count when nothing
      // is load-scorable (BW type without a stored bodyweight, or no weights
      // logged) — estimated1RM stays null in that case.
      bestReps?: number
    }[]
  }
}

/**
 * Projects a `WorkoutDetail` into the agent-facing payload: weights rendered in
 * the user's unit, ISO `startedAt`, and a per-exercise estimated 1RM. Shared by
 * the `get_workout` tool and the `workout://{id}` resource so both emit the exact
 * same shape from one source of truth.
 */
export function buildWorkoutPayload(
  workout: WorkoutDetail,
  resolved: string,
  unit: WeightUnit,
  bodyweightKg: number | null,
  programDay?: ProgramDayDetail,
): WorkoutPayload {
  return {
    userId: resolved,
    unit,
    workout: {
      id: workout.id,
      name: workout.name,
      startedAt: workout.startedAt.toISOString(),
      programDayId: workout.programDayId,
      programWeek: workout.programWeek,
      ...(programDay ? { plan: buildProgramDayView(programDay, unit) } : {}),
      exercises: workout.exercises.map((exercise) => ({
        id: exercise.id,
        wgerExerciseId: exercise.wgerExerciseId,
        name: exercise.name,
        position: exercise.position,
        loggingType: exercise.loggingType,
        sets: exercise.sets.map((s) => ({
          setNumber: s.setNumber,
          reps: s.reps,
          weight: s.weight === null ? null : kgToDisplay(s.weight, unit),
          completed: s.completed,
        })),
        ...scoreExercise(exercise.sets, exercise.loggingType, bodyweightKg, unit),
      })),
    },
  }
}

/**
 * Best-set scoring for one exercise, in the user's unit. e1rm winners keep the
 * historical shape (`estimated1RM`, null otherwise); the rep fallback — no
 * load-scorable set — adds `bestReps` so the agent still sees a top set.
 */
function scoreExercise(
  sets: readonly { reps: number | null; weight: number | null }[],
  loggingType: LoggingType,
  bodyweightKg: number | null,
  unit: WeightUnit,
): { estimated1RM: number | null; bestReps?: number } {
  const best = bestScoredSet(sets, loggingType, bodyweightKg)
  if (best === null) return { estimated1RM: null }
  return best.kind === 'e1rm'
    ? { estimated1RM: kgToDisplay(best.e1rm, unit) }
    : { estimated1RM: null, bestReps: best.reps }
}
