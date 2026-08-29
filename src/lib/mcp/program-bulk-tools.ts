import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { resolveUserId, resolveActor } from './resolve-user'
import { jsonResult, errorResult } from './result'
import { ToolError } from './errors'
import { assertProgramIdShape } from './program-id'
import {
  duplicateProgramDay,
  duplicateProgramWeek,
  fillProgramSetsDown,
  fillProgramWeeksRight,
  applyProgramSetScheme,
  applyProgressionToScope,
  type SchemeSetRow,
} from '@/db/program-bulk'
import { ProgramPatchError } from '@/db/program-ownership'
import { parseSetScheme, MAX_SCHEME_SETS, type SchemeSet } from '@/lib/set-scheme'
import { displayToKg } from '@/lib/units'
import { MAX_WEIGHT as MAX_WEIGHT_KG } from '@/lib/workout/workout-input'

/**
 * BULK authoring tools — the coach-facing surface for db/program-bulk.ts.
 *
 * WHY THEY EXIST AS TOOLS. Each of these otherwise requires the agent to loop
 * the granular patch tools: duplicating a day is one `add_program_day` plus an
 * `add_program_exercise` and N `add_program_set` calls per exercise, and a batch
 * proposal caps at MAX_PROPOSAL_PATCHES (20, lib/patch-proposal.ts). A
 * six-exercise day cannot be duplicated inside that ceiling at all. Each tool
 * here is ONE op — one transaction, one `program_events` row — so the ceiling
 * stops being the binding constraint on what a coach can offer.
 *
 * Conventions are `registerProgramPatchTools`' verbatim: addressing by
 * `programId` + 0-based positions (+ 1-based `setNumber`/`week`), ownership
 * enforced in the DB layer through the join chain to `programs.user_id`,
 * not-found surfacing as a `ToolError`, and a `ProgramPatchError` (invalid
 * edit) re-thrown with its message intact.
 */

const positionArg = z.number().int().min(0)
const setNumberArg = z.number().int().min(1)
const weekArg = z.number().int().min(1)

/** Re-throws the DB layer's validation channel as a `ToolError` so the real
 *  message reaches the agent (mirrors `runOp` in program-patch-tools.ts). */
async function runOp<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (error: unknown) {
    if (error instanceof ProgramPatchError) throw new ToolError(error.message)
    throw error
  }
}

/**
 * Converts one parsed scheme set's load to canonical kg. The parser REQUIRES an
 * explicit unit on a load (`100kg` / `225lb`), so there is nothing to infer
 * here — the unit is whatever the author typed, never the account default
 * silently applied to an ambiguous number.
 */
function toSchemeRow(set: SchemeSet): SchemeSetRow {
  let suggestedLoadKg: number | null = null
  if (set.load !== null) {
    suggestedLoadKg = displayToKg(set.load.value, set.load.unit)
    if (suggestedLoadKg < 0 || suggestedLoadKg > MAX_WEIGHT_KG) {
      throw new ToolError(`load ${set.load.value}${set.load.unit} is out of range`)
    }
  }
  return {
    repMin: set.repMin,
    repMax: set.repMax,
    rir: set.rir,
    rpe: set.rpe,
    suggestedLoadKg,
  }
}

export function registerProgramBulkTools(server: McpServer): void {
  server.registerTool(
    'duplicate_program_day',
    {
      title: 'Duplicate Program Day',
      description:
        'Duplicates a whole program day — its exercises (superset groups, progression rules, per-exercise overshoot policy, muscle tags), their sets, and the per-week target overrides on those sets — inserting the copy immediately AFTER the source and renumbering the later days so positions stay contiguous. Per-week overrides ARE copied at their original week numbers: a duplicate that dropped them would look identical in the builder and train differently from week 2 onward. Pass `name` to name the copy (default: the source name plus " (copy)"). One atomic op, one change-log entry. Errors if the day is not found or owned.',
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        name: z.string().trim().min(1).max(200).optional(),
        userId: z.string().optional(),
      },
    },
    async ({ programId, dayPosition, name, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await runOp(() =>
          duplicateProgramDay(resolved, programId, dayPosition, resolveActor(extra), { name }),
        )
        if (!result) {
          throw new ToolError(
            `Day ${dayPosition} of program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({
          userId: resolved,
          programId,
          sourceDayPosition: dayPosition,
          dayPosition: result.position,
          overridesCopied: result.overridesCopied,
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'duplicate_program_week',
    {
      title: 'Duplicate Program Week',
      description:
        'Makes one mesocycle week look like another, across the WHOLE program. A week is not a stored entity — a program stores a week COUNT plus per-(set, week) target overrides — so this copies every override at `fromWeek` onto `toWeek` and REPLACES whatever `toWeek` held (a merge would leave stragglers, so the two weeks would still differ). It deliberately does NOT freeze the source week\'s derived prescription: sets with no override at `fromWeek` keep deferring to the progression engine at `toWeek`, which is what keeps the copied week tracking the lifter instead of going stale. Both weeks must be within the program\'s mesocycle, and a week cannot be copied onto itself. Errors if the program is not found or owned.',
      inputSchema: {
        programId: z.string(),
        fromWeek: weekArg,
        toWeek: weekArg,
        userId: z.string().optional(),
      },
    },
    async ({ programId, fromWeek, toWeek, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await runOp(() =>
          duplicateProgramWeek(resolved, programId, fromWeek, toWeek, resolveActor(extra)),
        )
        if (!result) throw new ToolError(`Program ${programId} not found for user ${resolved}`)
        return jsonResult({ userId: resolved, programId, fromWeek, toWeek, ...result })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'fill_program_sets',
    {
      title: 'Fill Program Sets Down',
      description:
        'Copies one set\'s targets (reps, RIR/RPE, suggested load, tempo, duration, distance, rest, technique) onto the other sets of the same exercise — the "fill down" bulk edit, as one atomic op. `scope: "below"` (the default) fills the sets after the source; `scope: "all"` fills every other set. Set SHAPE never travels: setType and metricMode are untouched, so a warm-up row stays a warm-up. Pass `fields` to fill only some targets (e.g. ["rpe"]). If any resulting set would be invalid (a timed set left without a duration, an inverted rep range) NOTHING is written. Errors if the exercise or set is not found or owned.',
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        exercisePosition: positionArg,
        fromSetNumber: setNumberArg,
        scope: z.enum(['below', 'all']).optional(),
        fields: z
          .array(
            z.enum([
              'repMin',
              'repMax',
              'rir',
              'rpe',
              'suggestedLoadKg',
              'tempo',
              'durationSec',
              'distanceM',
              'restSec',
              'technique',
            ]),
          )
          .min(1)
          .optional(),
        userId: z.string().optional(),
      },
    },
    async (
      { programId, dayPosition, exercisePosition, fromSetNumber, scope, fields, userId },
      extra,
    ) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await runOp(() =>
          fillProgramSetsDown(
            resolved,
            programId,
            dayPosition,
            exercisePosition,
            fromSetNumber,
            resolveActor(extra),
            { scope, fields },
          ),
        )
        if (!result) {
          throw new ToolError(
            `Set ${fromSetNumber} of exercise ${exercisePosition}, day ${dayPosition} in program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({ userId: resolved, programId, fromSetNumber, ...result })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'fill_program_weeks',
    {
      title: 'Fill Program Weeks Right',
      description:
        'Copies one exercise\'s week-`fromWeek` target overrides onto every week from fromWeek+1 through `throughWeek` — the "fill right" bulk edit, scoped to a single exercise (use duplicate_program_week for the whole program). Replaces whatever those weeks held. Like duplicate_program_week it copies DEVIATIONS only: sets with no override at the source week keep deferring to the progression engine in the filled weeks. `throughWeek` must be later than `fromWeek` and inside the program\'s mesocycle. Errors if the exercise is not found or owned.',
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        exercisePosition: positionArg,
        fromWeek: weekArg,
        throughWeek: weekArg,
        userId: z.string().optional(),
      },
    },
    async ({ programId, dayPosition, exercisePosition, fromWeek, throughWeek, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await runOp(() =>
          fillProgramWeeksRight(
            resolved,
            programId,
            dayPosition,
            exercisePosition,
            fromWeek,
            throughWeek,
            resolveActor(extra),
          ),
        )
        if (!result) {
          throw new ToolError(
            `Exercise ${exercisePosition} of day ${dayPosition} in program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({ userId: resolved, programId, fromWeek, ...result })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'apply_set_scheme',
    {
      title: 'Apply Set Scheme',
      description: `Rewrites one exercise's sets from a shorthand scheme, in one atomic op: sets are updated in place, extra sets appended, and any tail beyond the scheme removed. Accepted shapes: a comma list of rep targets ("5,5,3,3,1"), a count×reps multiplier ("3x8", "3x8-12"), or a mix ("5,5,3x3"). One scheme-wide qualifier group may follow: an effort (either "@7RPE" or "@2RIR", never both — same axis) and/or an absolute load with an explicit unit ("@100kg", "@225lb"). Percentages are NOT accepted — a percentage of a training max comes from the exercise's progression config, not from a scheme string. Malformed input is refused with the offending token named, never partially applied. At most ${MAX_SCHEME_SETS} sets. Targets the scheme does not mention are cleared rather than left stale, and set SHAPE (setType/metricMode) is preserved on surviving sets. Errors if the exercise is not found or owned.`,
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        exercisePosition: positionArg,
        scheme: z.string(),
        userId: z.string().optional(),
      },
    },
    async ({ programId, dayPosition, exercisePosition, scheme, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const parsed = parseSetScheme(scheme)
        if (!parsed.ok) {
          // The parser's own message, plus the token it blamed — the agent
          // needs to see WHICH fragment was rejected in order to fix it.
          throw new ToolError(
            parsed.error.token === undefined
              ? `Could not read the set scheme: ${parsed.error.message}`
              : `Could not read "${parsed.error.token}" in the set scheme: ${parsed.error.message}`,
          )
        }
        const rows = parsed.sets.map(toSchemeRow)
        const result = await runOp(() =>
          applyProgramSetScheme(
            resolved,
            programId,
            dayPosition,
            exercisePosition,
            rows,
            resolveActor(extra),
            { summary: `Set scheme "${scheme.trim()}" (Day ${dayPosition + 1})` },
          ),
        )
        if (!result) {
          throw new ToolError(
            `Exercise ${exercisePosition} of day ${dayPosition} in program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({ userId: resolved, programId, setCount: rows.length, ...result })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'apply_progression_scope',
    {
      title: 'Apply Progression To Scope',
      description:
        'Copies one exercise\'s progression rule onto its siblings — the "also apply to" bulk edit. `scope: "day"` reaches the other exercises in the same day; `scope: "program"` reaches every other exercise in the program. The source exercise is untouched. TM-anchored schemes (percent-1rm, amrap-cycle) are REFUSED: their training max belongs to one lift, so broadcasting it would prescribe the bench\'s training max to the squat — set those per exercise with set_training_max instead. One atomic op, one change-log entry. Errors if the exercise is not found or owned.',
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        exercisePosition: positionArg,
        scope: z.enum(['day', 'program']),
        userId: z.string().optional(),
      },
    },
    async ({ programId, dayPosition, exercisePosition, scope, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await runOp(() =>
          applyProgressionToScope(
            resolved,
            programId,
            dayPosition,
            exercisePosition,
            scope,
            resolveActor(extra),
          ),
        )
        if (!result) {
          throw new ToolError(
            `Exercise ${exercisePosition} of day ${dayPosition} in program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({ userId: resolved, programId, scope, ...result })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )
}
