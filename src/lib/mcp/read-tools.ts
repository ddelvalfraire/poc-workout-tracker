import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { resolveUserId } from './resolve-user'
import { jsonResult, errorResult } from './result'
import { ToolError } from './errors'
import { assertWorkoutIdShape } from './workout-id'
import { assertProgramIdShape } from './program-id'
import {
  listWorkoutSummaries,
  getWorkoutDetail,
  getLastPerformance,
  type WorkoutDetail,
} from '@/db/workouts'
import { getProgramDayDetail, type ProgramDayDetail } from '@/db/programs'
import { getProgramStats, type ProgramStats } from '@/db/program-stats'
import { getWeightUnit, getBodyweightKg } from '@/db/preferences'
import { searchExercises } from '@/lib/wger'
import { kgToDisplay, type WeightUnit } from '@/lib/units'
import { bestScoredSet } from '@/lib/one-rep-max'
import type { LoggingType } from '@/lib/workout-input'
import { buildProgramDayView, type ProgramDayView } from './program-tools'

/**
 * Registers the read tools — the agent's read-only window into a user's
 * training, program stats, and the exercise catalog.
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
          // 'wger' pinned until the tool grows a source arg (custom-exercises
          // Phase 4) — MCP callers can't reference customs here yet anyway.
          getLastPerformance(resolved, 'wger', wgerExerciseId, excludeWorkoutId),
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
    'get_program_stats',
    {
      title: 'Get Program Stats',
      description:
        "Per-week adherence (started/completed days vs planned), volume (completed sets + tonnage), and per-exercise progression and PRs (first-week baseline vs best est. 1RM) for one program — the same numbers the app's stats page shows. Weights are in the user's unit. Only workouts started from the program's days count. Use to answer \"how's my program going?\".",
      inputSchema: { programId: z.string(), userId: z.string().optional() },
    },
    async ({ programId, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        // Resolve the stats first; only fetch the unit once we know the
        // program exists, matching get_workout's not-found economy.
        const stats = await getProgramStats(resolved, programId)
        if (!stats) {
          return errorResult(new ToolError(`Program ${programId} not found for user ${resolved}`))
        }
        const unit = await getWeightUnit(resolved)
        return jsonResult(buildProgramStatsPayload(stats, resolved, unit))
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
 * Projects `ProgramStats` (kg-domain) into the agent-facing payload: every
 * weight through `kgToDisplay`, counts/weeks/reps verbatim. `tonnageKg` is
 * renamed `tonnage` because the value is no longer kg for lb users, and the
 * per-set `index` inside ScoredBestSet is dropped — it addresses an internal
 * list the agent never sees.
 */
function buildProgramStatsPayload(stats: ProgramStats, resolved: string, unit: WeightUnit) {
  return {
    userId: resolved,
    unit,
    program: stats.program,
    currentWeek: stats.currentWeek,
    weeks: stats.weeks.map(({ tonnageKg, ...week }) => ({
      ...week,
      tonnage: kgToDisplay(tonnageKg, unit),
    })),
    exercises: stats.exercises.map((exercise) => ({
      wgerExerciseId: exercise.wgerExerciseId,
      source: exercise.source,
      name: exercise.name,
      loggingType: exercise.loggingType,
      weeks: exercise.weeks.map((point) => ({
        week: point.week,
        completedSets: point.completedSets,
        best:
          point.best === null
            ? null
            : point.best.kind === 'e1rm'
              ? {
                  kind: 'e1rm' as const,
                  reps: point.best.reps,
                  // The EFFECTIVE load (bodyweight-aware), not the stored column.
                  weight: kgToDisplay(point.best.weightKg, unit),
                  e1rm: kgToDisplay(point.best.e1rm, unit),
                }
              : { kind: 'reps' as const, reps: point.best.reps },
      })),
      pr:
        exercise.pr === null
          ? null
          : {
              baseline: convertPRPoint(exercise.pr.baseline, unit),
              best: convertPRPoint(exercise.pr.best, unit),
            },
    })),
  }
}

function convertPRPoint(
  point: { week: number; reps: number; e1rm: number },
  unit: WeightUnit,
): { week: number; reps: number; e1rm: number } {
  return { week: point.week, reps: point.reps, e1rm: kgToDisplay(point.e1rm, unit) }
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
