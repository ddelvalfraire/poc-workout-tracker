import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { resolveUserId } from './resolve-user'
import { jsonResult, errorResult } from './result'
import { ToolError } from './errors'
import { assertProgramIdShape, assertProgramDayIdShape } from './program-id'
import {
  metricModeSchema,
  setTypeSchema,
  statusSchema,
  techniqueSchema,
  progressionSchema,
  parseProgramInput,
  type ProgramInput,
} from '@/lib/program-input'
import { MAX_WEIGHT as MAX_WEIGHT_KG } from '@/lib/workout-input'
import { displayToKg, kgToDisplay, type WeightUnit } from '@/lib/units'
import {
  saveProgram,
  updateProgram,
  deleteProgram,
  setProgramStatus,
  listPrograms,
  getProgramDetail,
  instantiateProgramDay,
  type ProgramDetail,
  type ProgramDayDetail,
} from '@/db/programs'
import { getWeightUnit } from '@/db/preferences'

/** Optional explicit unit override; absent → the user's stored unit. */
const unitArg = z.enum(['kg', 'lb']).optional()

/**
 * Display-unit set shape the authoring tool accepts. `suggestedLoad` is in the
 * user's unit (converted to `suggestedLoadKg` before persist); everything else
 * stays optional/permissive here because `parseProgramInput` applies the defaults
 * and the cross-field refines. `technique`/`progression` JSONB pass through as kg.
 */
const toolSetSchema = z.object({
  setType: setTypeSchema.optional(),
  metricMode: metricModeSchema.optional(),
  repMin: z.number().int().nullable().optional(),
  repMax: z.number().int().nullable().optional(),
  rir: z.number().int().nullable().optional(),
  rpe: z.number().nullable().optional(),
  suggestedLoad: z.number().nullable().optional(), // display unit → kg before persist
  tempo: z.string().nullable().optional(),
  durationSec: z.number().int().nullable().optional(),
  distanceM: z.number().nullable().optional(), // meters, not weight — never converted
  technique: techniqueSchema.nullable().optional(), // kg, passthrough
})
const toolExerciseSchema = z.object({
  wgerExerciseId: z.number().int(),
  name: z.string(),
  progression: progressionSchema.nullable().optional(), // kg, passthrough
  sets: z.array(toolSetSchema),
})
const toolDaySchema = z.object({
  name: z.string(),
  notes: z.string().nullable().optional(),
  exercises: z.array(toolExerciseSchema),
})

/** The program body (display units), reused as the upsert input shape minus id/unit/userId. */
const rawProgramSchema = z.object({
  name: z.string(),
  status: statusSchema.optional(),
  mesocycleWeeks: z.number().int().optional(),
  deloadWeek: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
  days: z.array(toolDaySchema),
})
type RawProgram = z.infer<typeof rawProgramSchema>

/**
 * Range-checks the display-unit loads (converted to kg) and, on any out-of-range
 * value, throws a `ToolError` stating the bound in the agent's *display* unit —
 * the program twin of `assertWeightsInRange`. The numeric test is on the kg value
 * so it agrees with `parseProgramInput`'s kg backstop; only the message differs.
 */
function assertLoadsInRange(raw: RawProgram, unit: WeightUnit): void {
  const outOfRange = raw.days.some((d) =>
    d.exercises.some((e) =>
      e.sets.some((s) => {
        if (s.suggestedLoad == null) return false
        const kg = displayToKg(s.suggestedLoad, unit)
        return kg < 0 || kg > MAX_WEIGHT_KG
      }),
    ),
  )
  if (!outOfRange) return
  const max = kgToDisplay(MAX_WEIGHT_KG, unit)
  throw new ToolError(`suggestedLoad must be a number between 0 and ${max} ${unit}, or null`)
}

/**
 * Builds the kg-canonical object `parseProgramInput` expects: `suggestedLoad`
 * (display) becomes `suggestedLoadKg`; `technique`/`progression` and the meters
 * `distanceM` pass through untouched. Only non-null loads are converted.
 */
function toKgProgram(raw: RawProgram, unit: WeightUnit): unknown {
  return {
    name: raw.name,
    status: raw.status,
    mesocycleWeeks: raw.mesocycleWeeks,
    deloadWeek: raw.deloadWeek,
    notes: raw.notes,
    days: raw.days.map((d) => ({
      name: d.name,
      notes: d.notes,
      exercises: d.exercises.map((e) => ({
        wgerExerciseId: e.wgerExerciseId,
        name: e.name,
        progression: e.progression,
        sets: e.sets.map((s) => ({
          setType: s.setType,
          metricMode: s.metricMode,
          repMin: s.repMin,
          repMax: s.repMax,
          rir: s.rir,
          rpe: s.rpe,
          suggestedLoadKg: s.suggestedLoad == null ? s.suggestedLoad : displayToKg(s.suggestedLoad, unit),
          tempo: s.tempo,
          durationSec: s.durationSec,
          distanceM: s.distanceM,
          technique: s.technique,
        })),
      })),
    })),
  }
}

/** A ZodError → a concise, agent-readable ToolError (first issue, path-prefixed). */
function toolErrorFromZod(error: unknown): ToolError {
  if (error instanceof z.ZodError) {
    const first = error.issues[0]
    const path = first?.path.length ? `${first.path.join('.')}: ` : ''
    return new ToolError(`${path}${first?.message ?? 'invalid program input'}`)
  }
  return new ToolError(error instanceof Error ? error.message : 'invalid program input')
}

/**
 * Range-checks then converts then validates. The load bound is checked first so
 * the message is in the agent's unit; the structural checks fall to
 * `parseProgramInput`, whose `ZodError` is reshaped into a concise `ToolError`
 * (so the real message reaches the agent instead of `errorResult`'s generic one).
 */
function validateProgram(raw: RawProgram, unit: WeightUnit): ProgramInput {
  assertLoadsInRange(raw, unit)
  try {
    return parseProgramInput(toKgProgram(raw, unit))
  } catch (error: unknown) {
    throw toolErrorFromZod(error)
  }
}

/**
 * The agent-facing shape of one program — what `get_program` and the
 * `program://{id}` resource both return. `suggestedLoad` is in the user's display
 * unit; `technique`/`progression` are returned verbatim (kg); dates are ISO.
 */
export interface ProgramPayload {
  userId: string
  unit: WeightUnit
  program: {
    id: string
    name: string
    status: string
    mesocycleWeeks: number
    deloadWeek: number | null
    notes: string | null
    createdAt: string
    updatedAt: string
    days: {
      id: string
      name: string
      position: number
      notes: string | null
      exercises: {
        id: string
        wgerExerciseId: number
        name: string
        position: number
        progression: unknown | null
        sets: {
          setNumber: number
          setType: string
          metricMode: string
          repMin: number | null
          repMax: number | null
          rir: number | null
          rpe: number | null
          suggestedLoad: number | null
          tempo: string | null
          durationSec: number | null
          distanceM: number | null
          technique: unknown | null
        }[]
      }[]
    }[]
  }
}

/** A program set row (all columns), as loaded by getProgramDetail/getProgramDayDetail. */
type ProgramSetRow = ProgramDetail['days'][number]['exercises'][number]['sets'][number]

/**
 * Projects one planned set into display units: `suggestedLoadKg` → the user's
 * unit, `technique` verbatim (kg), `distanceM` (meters) untouched. The single
 * source of the per-set view shared by `buildProgramPayload` (get_program) and
 * `buildProgramDayView` (the get_workout plan overlay), so the two never drift.
 */
function buildProgramSetView(s: ProgramSetRow, unit: WeightUnit) {
  return {
    setNumber: s.setNumber,
    setType: s.setType,
    metricMode: s.metricMode,
    repMin: s.repMin,
    repMax: s.repMax,
    rir: s.rir,
    rpe: s.rpe,
    suggestedLoad: s.suggestedLoadKg === null ? null : kgToDisplay(s.suggestedLoadKg, unit),
    tempo: s.tempo,
    durationSec: s.durationSec,
    distanceM: s.distanceM,
    technique: s.technique,
  }
}

/**
 * The plan overlay for one program day — the prescription a `get_workout` (or the
 * workout resource) attaches when the workout was instantiated from this day. The
 * agent correlates it to the live sets by `position`/`setNumber`.
 */
export interface ProgramDayView {
  programDayId: string
  name: string
  exercises: {
    position: number
    wgerExerciseId: number
    name: string
    progression: unknown | null
    sets: ReturnType<typeof buildProgramSetView>[]
  }[]
}

/** Projects a `ProgramDayDetail` into the plan overlay (loads in the user's unit). */
export function buildProgramDayView(day: ProgramDayDetail, unit: WeightUnit): ProgramDayView {
  return {
    programDayId: day.id,
    name: day.name,
    exercises: day.exercises.map((e) => ({
      position: e.position,
      wgerExerciseId: e.wgerExerciseId,
      name: e.name,
      progression: e.progression,
      sets: e.sets.map((s) => buildProgramSetView(s, unit)),
    })),
  }
}

/**
 * Projects a `ProgramDetail` into the agent-facing payload: loads rendered in the
 * user's unit, ISO dates, JSONB tail verbatim. Shared by the `get_program` tool
 * and the `program://{id}` resource so both emit the exact same shape.
 */
export function buildProgramPayload(
  program: ProgramDetail,
  resolved: string,
  unit: WeightUnit,
): ProgramPayload {
  return {
    userId: resolved,
    unit,
    program: {
      id: program.id,
      name: program.name,
      status: program.status,
      mesocycleWeeks: program.mesocycleWeeks,
      deloadWeek: program.deloadWeek,
      notes: program.notes,
      createdAt: program.createdAt.toISOString(),
      updatedAt: program.updatedAt.toISOString(),
      days: program.days.map((day) => ({
        id: day.id,
        name: day.name,
        position: day.position,
        notes: day.notes,
        exercises: day.exercises.map((exercise) => ({
          id: exercise.id,
          wgerExerciseId: exercise.wgerExerciseId,
          name: exercise.name,
          position: exercise.position,
          progression: exercise.progression,
          sets: exercise.sets.map((s) => buildProgramSetView(s, unit)),
        })),
      })),
    },
  }
}

/**
 * Registers the Phase 2 program tools — the agent's ability to author and read a
 * whole training program. The program twin of `registerWriteTools` +
 * `registerReadTools`: every handler funnels `userId` through `resolveUserId` (the
 * MCP authorization boundary) and echoes the resolved id. Loads are supplied/returned
 * in the user's display unit and converted to/from canonical kg at this boundary;
 * the `technique`/`progression` JSONB tail is passed through as kg. Validation and
 * not-owned conditions surface as `ToolError`; real DB failures fall through to
 * `errorResult`, which logs and genericizes them.
 */
export function registerProgramTools(server: McpServer): void {
  server.registerTool(
    'upsert_program',
    {
      title: 'Upsert Program',
      description:
        "Creates a training program, or fully replaces one when `id` is given (coarse create/replace, not a partial edit). `suggestedLoad` is in the user's unit (or the `unit` arg) and stored as kg; `technique`/`progression` JSONB are in kg. Returns the programId. Errors if a given id isn't found or owned.",
      inputSchema: {
        id: z.string().optional(),
        ...rawProgramSchema.shape,
        unit: unitArg,
        userId: z.string().optional(),
      },
    },
    async ({ id, name, status, mesocycleWeeks, deloadWeek, notes, days, unit, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        // Guard the id shape before any DB call or body validation (mirrors
        // update_workout): a malformed id can't own anything, so fail fast with a
        // clean not-found instead of querying the unit and validating the body first.
        if (id !== undefined) assertProgramIdShape(id)
        const basis = unit ?? (await getWeightUnit(resolved))
        const parsed = validateProgram(
          { name, status, mesocycleWeeks, deloadWeek, notes, days },
          basis,
        )
        if (id !== undefined) {
          const result = await updateProgram(resolved, id, parsed)
          if (!result) throw new ToolError(`Program ${id} not found for user ${resolved}`)
          return jsonResult({ userId: resolved, unit: basis, programId: result.id })
        }
        const { id: newId } = await saveProgram(resolved, parsed)
        return jsonResult({ userId: resolved, unit: basis, programId: newId })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'get_program',
    {
      title: 'Get Program',
      description:
        "Returns one program (owned by the user) with its days, exercises, and sets — suggested loads in the user's unit, technique/progression JSONB in kg.",
      inputSchema: { id: z.string(), userId: z.string().optional() },
    },
    async ({ id, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(id)
        const program = await getProgramDetail(resolved, id)
        if (!program) {
          return errorResult(new ToolError(`Program ${id} not found for user ${resolved}`))
        }
        const unit = await getWeightUnit(resolved)
        return jsonResult(buildProgramPayload(program, resolved, unit))
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'list_programs',
    {
      title: 'List Programs',
      description:
        "Lists the user's programs (most recently updated first) with status and mesocycle length. Use to review programs before drilling into one with get_program.",
      inputSchema: { userId: z.string().optional() },
    },
    async ({ userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        const rows = await listPrograms(resolved)
        return jsonResult({
          userId: resolved,
          programs: rows.map((r) => ({
            id: r.id,
            name: r.name,
            status: r.status,
            mesocycleWeeks: r.mesocycleWeeks,
            deloadWeek: r.deloadWeek,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          })),
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'delete_program',
    {
      title: 'Delete Program',
      description:
        'Deletes a program (owned by the user) and its days/exercises/sets. Logged workouts instantiated from it are kept (their program link is cleared). Errors if not found or not owned.',
      inputSchema: { id: z.string(), userId: z.string().optional() },
    },
    async ({ id, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(id)
        const [deleted] = await deleteProgram(resolved, id)
        if (!deleted) throw new ToolError(`Program ${id} not found for user ${resolved}`)
        return jsonResult({ userId: resolved, programId: deleted.id, deleted: true })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'set_program_status',
    {
      title: 'Set Program Status',
      description:
        "Sets a program's lifecycle status ('draft', 'active', or 'archived') without touching its days/exercises/sets. Errors if not found or not owned.",
      inputSchema: { id: z.string(), status: statusSchema, userId: z.string().optional() },
    },
    async ({ id, status, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(id)
        const result = await setProgramStatus(resolved, id, status)
        if (!result) throw new ToolError(`Program ${id} not found for user ${resolved}`)
        return jsonResult({ userId: resolved, programId: result.id, status })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'instantiate_program_day',
    {
      title: 'Instantiate Program Day',
      description:
        "Starts a dated workout from a program day: seeds each set with its suggested load (reps/durations left blank for you to log) and stamps the program and week. Pass `week` (default 1). Returns the new workoutId — log it with update_set/add_set, then read it with get_workout to see the plan targets. Errors if the program day isn't found or owned.",
      inputSchema: {
        programDayId: z.string(),
        week: z.number().int().positive().optional(),
        userId: z.string().optional(),
      },
    },
    async ({ programDayId, week, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramDayIdShape(programDayId)
        const programWeek = week ?? 1
        const result = await instantiateProgramDay(resolved, programDayId, programWeek)
        if (!result) {
          throw new ToolError(`Program day ${programDayId} not found for user ${resolved}`)
        }
        return jsonResult({ userId: resolved, workoutId: result.id, programDayId, programWeek })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )
}
