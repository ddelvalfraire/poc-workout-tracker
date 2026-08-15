import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { resolveUserId, resolveActor } from './resolve-user'
import { jsonResult, errorResult } from './result'
import { ToolError } from './errors'
import { assertProgramIdShape } from './program-id'
import {
  ProgramPatchError,
  setProgramSetOverride,
  removeProgramSetOverride,
  setProgramAutoregulation,
  setProgramDeloadPolicy,
  setProgramDietPhase,
  setProgramPlanSync,
  setTrainingMax,
  addProgramDay,
  updateProgramDay,
  removeProgramDay,
  moveProgramDay,
  addProgramExercise,
  updateProgramExercise,
  substituteProgramExercise,
  removeProgramExercise,
  moveProgramExercise,
  addProgramSet,
  updateProgramSet,
  removeProgramSet,
  moveProgramSet,
  type ProgramSetPatch,
  type ProgramSetOverridePatch,
} from '@/db/program-patches'
import { createPatchProposal } from '@/db/patch-proposals'
import { PatchProposalError } from '@/db/program-errors'
import {
  PROPOSABLE_PATCH_TOOLS,
  MAX_PROPOSAL_PATCHES,
  MAX_PROPOSAL_SUMMARY,
} from '@/lib/patch-proposal'
import { getWeightUnit } from '@/db/preferences'
import { displayToKg, kgToDisplay, type WeightUnit } from '@/lib/units'
import { MAX_WEIGHT as MAX_WEIGHT_KG } from '@/lib/workout-input'
import {
  setTypeSchema,
  metricModeSchema,
  techniqueSchema,
  progressionSchema,
  deloadPolicySchema,
  dietPhaseSchema,
} from '@/lib/program-input'

/** Optional explicit unit override; absent → the user's stored unit. */
const unitArg = z.enum(['kg', 'lb']).optional()
/** Names are required columns — non-blank, trimmed (mirrors programDaySchema/programExerciseSchema). */
const nameArg = z.string().trim().min(1).max(200)
const notesArg = z.string().max(2000).nullable().optional()
/** Scalar set-target args mirror programSetSchema's bounds; null clears, omitted = unchanged. */
const repArg = z.number().int().min(0).max(10_000).nullable().optional()
const rirArg = z.number().int().min(0).max(20).nullable().optional()
const rpeArg = z.number().min(0).max(10).nullable().optional()
const tempoArg = z.string().max(20).nullable().optional()
const durationArg = z.number().int().min(0).nullable().optional()
const distanceArg = z.number().min(0).max(9_999_999.99).nullable().optional() // meters, never converted
/** Rest AFTER the set, seconds (0..3600, mirrors programSetSchema) — unit-less,
 *  never converted; null clears. Distinct from the technique JSONB's intra-set restSec. */
const restArg = z.number().int().min(0).max(3600).nullable().optional()
/** suggestedLoad in the display unit; bounded in kg after conversion. */
const loadArg = z.number().nullable().optional()

/** 0-based position addressing (matches get_program's `position` fields). */
const positionArg = z.number().int().min(0)
/** 1-based set numbers (matches get_program's `setNumber`). */
const setNumberArg = z.number().int().min(1)
/** 1-based mesocycle week an override pins. */
const weekArg = z.number().int().min(1)

/** The shared planned-set target args (add_program_set + update_program_set). */
const setPatchArgs = {
  setType: setTypeSchema.optional(),
  metricMode: metricModeSchema.optional(),
  repMin: repArg,
  repMax: repArg,
  rir: rirArg,
  rpe: rpeArg,
  suggestedLoad: loadArg,
  tempo: tempoArg,
  durationSec: durationArg,
  distanceM: distanceArg,
  restSec: restArg,
  technique: techniqueSchema.nullable().optional(), // kg, passthrough (Phase-2 policy)
}
interface SetPatchArgs {
  setType?: z.infer<typeof setTypeSchema>
  metricMode?: z.infer<typeof metricModeSchema>
  repMin?: number | null
  repMax?: number | null
  rir?: number | null
  rpe?: number | null
  suggestedLoad?: number | null
  tempo?: string | null
  durationSec?: number | null
  distanceM?: number | null
  restSec?: number | null
  technique?: z.infer<typeof techniqueSchema> | null
}

/**
 * Converts a single display-unit suggested load to canonical kg, bounding it
 * with a message in the agent's unit — the program twin of `toKgWeight` in
 * `patch-tools.ts`. Only called with a real number.
 */
function toKgLoad(load: number, unit: WeightUnit): number {
  const kg = displayToKg(load, unit)
  if (kg < 0 || kg > MAX_WEIGHT_KG) {
    const maxDisplay = kgToDisplay(MAX_WEIGHT_KG, unit)
    throw new ToolError(
      `suggestedLoad must be a number between 0 and ${maxDisplay} ${unit}, or null`,
    )
  }
  return kg
}

/**
 * Runs a patch op, re-throwing its validation channel (`ProgramPatchError`) as a
 * `ToolError` so the real message reaches the agent instead of being genericized
 * by `errorResult`. Real DB failures fall through untouched.
 */
async function runOp<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (error: unknown) {
    if (error instanceof ProgramPatchError) throw new ToolError(error.message)
    throw error
  }
}

/** runOp's twin for the proposal layer: `PatchProposalError` (invalid batch /
 *  non-active program) surfaces verbatim instead of being genericized. */
async function runProposalOp<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (error: unknown) {
    if (error instanceof PatchProposalError) throw new ToolError(error.message)
    throw error
  }
}

/**
 * Assembles the kg-canonical `ProgramSetPatch` from the tool args, resolving the
 * unit LAZILY — only when `suggestedLoad` is a real number — and returning the
 * resolved unit (if any) so the handler can echo it. Omitted args stay omitted
 * (unchanged); explicit nulls pass through (clear).
 */
async function buildSetPatch(
  args: SetPatchArgs,
  resolved: string,
  unit: WeightUnit | undefined,
): Promise<{ patch: ProgramSetPatch; basis: WeightUnit | undefined }> {
  const patch: ProgramSetPatch = {}
  if (args.setType !== undefined) patch.setType = args.setType
  if (args.metricMode !== undefined) patch.metricMode = args.metricMode
  if (args.repMin !== undefined) patch.repMin = args.repMin
  if (args.repMax !== undefined) patch.repMax = args.repMax
  if (args.rir !== undefined) patch.rir = args.rir
  if (args.rpe !== undefined) patch.rpe = args.rpe
  if (args.tempo !== undefined) patch.tempo = args.tempo
  if (args.durationSec !== undefined) patch.durationSec = args.durationSec
  if (args.distanceM !== undefined) patch.distanceM = args.distanceM
  if (args.restSec !== undefined) patch.restSec = args.restSec
  if (args.technique !== undefined) patch.technique = args.technique
  let basis: WeightUnit | undefined
  if (args.suggestedLoad !== undefined) {
    if (args.suggestedLoad === null) {
      patch.suggestedLoadKg = null
    } else {
      basis = unit ?? (await getWeightUnit(resolved))
      patch.suggestedLoadKg = toKgLoad(args.suggestedLoad, basis)
    }
  }
  return { patch, basis }
}

/** True when every value is undefined — the empty-patch guard for the update tools. */
function isEmptyPatch(values: Record<string, unknown>): boolean {
  return Object.values(values).every((value) => value === undefined)
}

/**
 * Registers the Phase 4 granular program patch tools — targeted edits so an agent
 * can "swap day 2's incline press" or "bump set 3's target" without resending the
 * whole program (`upsert_program` remains for wholesale rewrites). Four ops (add/
 * update/remove/move) at each of three levels (day/exercise/set), addressed by
 * `programId` + 0-based `dayPosition`/`exercisePosition` + 1-based `setNumber` —
 * exactly the positions `get_program` returns.
 *
 * Update tools take named scalar args: omitted = unchanged, `null` = clear (like
 * `update_set`). `suggestedLoad` is in the user's display unit (or the `unit` arg)
 * and converted to kg lazily; `technique`/`progression` JSONB are in kg. Ownership
 * is enforced in the DB ops via the join chain to `programs.user_id`; not-found
 * surfaces as a `ToolError`, and the ops' `ProgramPatchError` (invalid edit) is
 * re-thrown with its message verbatim.
 */
export function registerProgramPatchTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // Program tools
  // -------------------------------------------------------------------------

  server.registerTool(
    'set_program_autoregulation',
    {
      title: 'Set Program Auto-Regulation',
      description:
        "Turns a program's auto-regulation on or off without touching its days/exercises/sets. When on (the default), week previews and instantiated sessions propose stall-reactive load adjustments (repeat after one stalled session, ~10% back-off after two) with a visible reason; explicit per-week overrides always win. Optional `stallPolicy` sets the fixed-mode stall rule alongside the toggle: 'all-sets' (the default — any working set missing its rep floor stalls the session) or 'first-set' (only the first working set decides; its miss stalls, other sets' misses don't). Omitting `stallPolicy` preserves the stored policy. Errors if the program isn't found or owned.",
      inputSchema: {
        programId: z.string(),
        enabled: z.boolean(),
        stallPolicy: z.enum(['all-sets', 'first-set']).optional(),
        userId: z.string().optional(),
      },
    },
    async ({ programId, enabled, stallPolicy, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await setProgramAutoregulation(
          resolved,
          programId,
          enabled,
          resolveActor(extra),
          stallPolicy,
        )
        if (!result) throw new ToolError(`Program ${programId} not found for user ${resolved}`)
        return jsonResult({
          userId: resolved,
          programId,
          autoregulation: enabled,
          ...(stallPolicy !== undefined ? { autoregStallPolicy: stallPolicy } : {}),
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'set_program_deload_policy',
    {
      title: 'Set Program Deload Policy',
      description:
        "Sets (or clears, with `policy: null`) a program's deload policy without touching its days/exercises/sets. `policy.mode`: 'none' (the deload week — if any — derives as a normal training week and the early-deload suggestion is suppressed), 'reactive' (no scheduled back-off; deload only when the stall-driven early-deload flag suggests it), or 'scheduled' with a `shape` ({ loadFactor 0–1 default 0.85, setFactor 0–1 default 0.5, rpeCap 5–10 or null }) applied to the deload week's progressed sets. `deloadWeek` still shapes the progression axis in every mode. Clearing (null) restores the legacy behavior: a set deloadWeek backs off at the historical factors, none otherwise. Errors if the program isn't found or owned.",
      inputSchema: {
        programId: z.string(),
        policy: deloadPolicySchema.nullable(),
        userId: z.string().optional(),
      },
    },
    async ({ programId, policy, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await runOp(() =>
          setProgramDeloadPolicy(resolved, programId, policy, resolveActor(extra)),
        )
        if (!result) throw new ToolError(`Program ${programId} not found for user ${resolved}`)
        return jsonResult({ userId: resolved, programId, deloadPolicy: policy })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'set_program_diet_phase',
    {
      title: 'Set Program Diet Phase',
      description:
        "Sets (or clears, with `phase: null`) a program's diet-phase context: 'cutting' | 'maintaining' | 'bulking'. Null means no phase — the engine behaves exactly as if the field never existed. 'cutting' never changes loads or suppresses signals; it reframes three-stall verdicts (stalls are expected in a deficit — holding is the win) and routes the automatic three-stall back-off through an owner-confirmable proposal instead of applying it (declining holds). 'maintaining'/'bulking' are stored context only. Every explicit set — including a clear — stamps dietPhaseSetAt (exposed by get_program as the staleness signal). Errors if the program isn't found or owned.",
      inputSchema: {
        programId: z.string(),
        phase: dietPhaseSchema.nullable(),
        userId: z.string().optional(),
      },
    },
    async ({ programId, phase, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await runOp(() =>
          setProgramDietPhase(resolved, programId, phase, resolveActor(extra)),
        )
        if (!result) throw new ToolError(`Program ${programId} not found for user ${resolved}`)
        return jsonResult({ userId: resolved, programId, dietPhase: phase })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'set_program_plan_sync',
    {
      title: 'Set Program Plan Sync',
      description:
        "Turns a program's performance→plan auto-sync on or off without touching its days/exercises/sets. When on (the default), finishing a session that outperformed the plan's suggested loads writes the performed loads back into the plan (each change appears in the program change log). Turn off for deliberate-percentage programs (5/3/1-style waves) where lifting past the listed number is by design. Errors if the program isn't found or owned.",
      inputSchema: {
        programId: z.string(),
        enabled: z.boolean(),
        userId: z.string().optional(),
      },
    },
    async ({ programId, enabled, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await setProgramPlanSync(resolved, programId, enabled, resolveActor(extra))
        if (!result) throw new ToolError(`Program ${programId} not found for user ${resolved}`)
        return jsonResult({ userId: resolved, programId, planSync: enabled })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'set_training_max',
    {
      title: 'Set Training Max',
      description:
        "Sets the training max on a percent-1rm or amrap-cycle exercise (by programId + 0-based dayPosition/exercisePosition) — the single sanctioned path for every TM change, logged in the change log with its reason. `trainingMax` is in the user's unit (or the `unit` arg). `reason` defaults to 'manual'; 'reset' marks a deliberate back-down (e.g. after repeated stalls), 'cycle-end'/'block-restart' are the engine/restart bumps. Only the TM moves — wave and percent structure are untouched. Errors for other progression schemes, or if the exercise isn't found or owned.",
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        exercisePosition: positionArg,
        trainingMax: z.number(),
        reason: z.enum(['cycle-end', 'reset', 'manual', 'block-restart']).optional(),
        unit: unitArg,
        userId: z.string().optional(),
      },
    },
    async (
      { programId, dayPosition, exercisePosition, trainingMax, reason, unit, userId },
      extra,
    ) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const basis = unit ?? (await getWeightUnit(resolved))
        const trainingMaxKg = toKgLoad(trainingMax, basis)
        const result = await runOp(() =>
          setTrainingMax(
            resolved,
            programId,
            dayPosition,
            exercisePosition,
            trainingMaxKg,
            reason ?? 'manual',
            resolveActor(extra),
          ),
        )
        if (!result) {
          throw new ToolError(
            `Exercise ${exercisePosition} of day ${dayPosition} in program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({
          userId: resolved,
          unit: basis,
          programId,
          dayPosition,
          exercisePosition,
          trainingMax: kgToDisplay(result.trainingMaxKg, basis),
          reason: reason ?? 'manual',
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  // -------------------------------------------------------------------------
  // Day tools
  // -------------------------------------------------------------------------

  server.registerTool(
    'add_program_day',
    {
      title: 'Add Program Day',
      description:
        "Appends a training day to a program (after the current last day). Returns the new 0-based dayPosition. Errors if the program isn't found or owned.",
      inputSchema: {
        programId: z.string(),
        name: nameArg,
        notes: notesArg,
        userId: z.string().optional(),
      },
    },
    async ({ programId, name, notes, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await addProgramDay(resolved, programId, { name, notes }, resolveActor(extra))
        if (!result) throw new ToolError(`Program ${programId} not found for user ${resolved}`)
        return jsonResult({ userId: resolved, programId, dayPosition: result.position })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'update_program_day',
    {
      title: 'Update Program Day',
      description:
        "Renames a program day and/or edits its notes (by programId + 0-based dayPosition). Only the named fields change; pass notes: null to clear them. Errors if the day isn't found or owned.",
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        name: nameArg.optional(),
        notes: notesArg,
        userId: z.string().optional(),
      },
    },
    async ({ programId, dayPosition, name, notes, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        if (isEmptyPatch({ name, notes })) {
          throw new ToolError('update_program_day needs at least one of name or notes')
        }
        const result = await updateProgramDay(
          resolved,
          programId,
          dayPosition,
          { name, notes },
          resolveActor(extra),
        )
        if (!result) {
          throw new ToolError(
            `Day ${dayPosition} of program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({ userId: resolved, programId, dayPosition })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'remove_program_day',
    {
      title: 'Remove Program Day',
      description:
        "Removes a program day (and its exercises/sets), renumbering the later days down so positions stay contiguous. Errors if the day isn't found or owned.",
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        userId: z.string().optional(),
      },
    },
    async ({ programId, dayPosition, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await removeProgramDay(resolved, programId, dayPosition, resolveActor(extra))
        if (!result) {
          throw new ToolError(
            `Day ${dayPosition} of program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({ userId: resolved, programId, removedDayPosition: dayPosition })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'move_program_day',
    {
      title: 'Move Program Day',
      description:
        "Moves a program day from one 0-based position to another; the days between shift by one so positions stay contiguous. Errors if either position has no day or the program isn't owned.",
      inputSchema: {
        programId: z.string(),
        from: positionArg,
        to: positionArg,
        userId: z.string().optional(),
      },
    },
    async ({ programId, from, to, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await moveProgramDay(resolved, programId, from, to, resolveActor(extra))
        if (!result) {
          throw new ToolError(
            `Day ${from} or ${to} of program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({ userId: resolved, programId, from, to })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  // -------------------------------------------------------------------------
  // Exercise tools
  // -------------------------------------------------------------------------

  server.registerTool(
    'add_program_exercise',
    {
      title: 'Add Program Exercise',
      description:
        "Appends an exercise to a program day (by programId + 0-based dayPosition), seeded with one blank working set. Exercise identity is the composite (source, wgerExerciseId); `source` defaults to 'wger', pass 'custom' for custom exercises — flesh it out with update_program_set/add_program_set. `progression` JSONB is in kg. Returns the new 0-based exercisePosition. Errors if the day isn't found or owned.",
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        wgerExerciseId: z.number().int(),
        // Composite identity: absent = 'wger', pass 'custom' for custom exercises.
        source: z.enum(['wger', 'custom']).optional(),
        name: nameArg,
        progression: progressionSchema.nullable().optional(),
        userId: z.string().optional(),
      },
    },
    async ({ programId, dayPosition, wgerExerciseId, source, name, progression, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await runOp(() =>
          addProgramExercise(
            resolved,
            programId,
            dayPosition,
            { wgerExerciseId, source, name, progression },
            resolveActor(extra),
          ),
        )
        if (!result) {
          throw new ToolError(
            `Day ${dayPosition} of program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({
          userId: resolved,
          programId,
          dayPosition,
          exercisePosition: result.position,
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'update_program_exercise',
    {
      title: 'Update Program Exercise',
      description:
        "Updates an exercise's identity (wgerExerciseId and/or source — the composite key; changing either re-derives muscle tags), name, progression, and/or supersetGroup (by programId + 0-based dayPosition + 0-based exercisePosition). Identity changes here are load-PRESERVING relabels — for fixing a mislabeled exercise while keeping its suggested loads and progression; to swap one movement for another, use substitute_program_exercise instead so the old movement's loads don't carry over. Only the named fields change; pass progression: null to clear it (`progression` JSONB is in kg) or supersetGroup: null to ungroup (same non-null group within a day = superset). Errors if the exercise isn't found or owned.",
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        exercisePosition: positionArg,
        wgerExerciseId: z.number().int().optional(),
        // The other identity half; changing either re-derives the muscle tags
        // from the effective (source, id).
        source: z.enum(['wger', 'custom']).optional(),
        name: nameArg.optional(),
        progression: progressionSchema.nullable().optional(),
        supersetGroup: z.number().int().min(0).nullable().optional(),
        userId: z.string().optional(),
      },
    },
    async (
      {
        programId,
        dayPosition,
        exercisePosition,
        wgerExerciseId,
        source,
        name,
        progression,
        supersetGroup,
        userId,
      },
      extra,
    ) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        if (isEmptyPatch({ wgerExerciseId, source, name, progression, supersetGroup })) {
          throw new ToolError(
            'update_program_exercise needs at least one of wgerExerciseId, source, name, progression, or supersetGroup',
          )
        }
        const result = await runOp(() =>
          updateProgramExercise(
            resolved,
            programId,
            dayPosition,
            exercisePosition,
            { wgerExerciseId, source, name, progression, supersetGroup },
            resolveActor(extra),
          ),
        )
        if (!result) {
          throw new ToolError(
            `Exercise ${exercisePosition} of day ${dayPosition} in program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({ userId: resolved, programId, dayPosition, exercisePosition })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'substitute_program_exercise',
    {
      title: 'Substitute Program Exercise',
      description:
        "Swaps a slot's movement for a different exercise (by programId + 0-based dayPosition + 0-based exercisePosition). Use THIS tool to swap a movement: it clears the old movement's suggested loads (template and per-week overrides) and drops a TM-based progression so the plan re-derives loads for the substitute — rep ranges, RIR/RPE, rest, tempo, and technique survive, and muscle tags re-derive from the new identity. For a load-preserving relabel of a mislabeled exercise, use update_program_exercise instead. `source` defaults to 'wger'; pass 'custom' for custom exercises. Errors if the exercise isn't found or owned.",
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        exercisePosition: positionArg,
        wgerExerciseId: z.number().int(),
        // Composite identity: absent = 'wger', pass 'custom' for custom exercises.
        source: z.enum(['wger', 'custom']).optional(),
        name: nameArg,
        userId: z.string().optional(),
      },
    },
    async (
      { programId, dayPosition, exercisePosition, wgerExerciseId, source, name, userId },
      extra,
    ) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await runOp(() =>
          substituteProgramExercise(
            resolved,
            programId,
            dayPosition,
            exercisePosition,
            { wgerExerciseId, source: source ?? 'wger', name },
            resolveActor(extra),
          ),
        )
        if (!result) {
          throw new ToolError(
            `Exercise ${exercisePosition} of day ${dayPosition} in program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({ userId: resolved, programId, dayPosition, exercisePosition })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'remove_program_exercise',
    {
      title: 'Remove Program Exercise',
      description:
        "Removes an exercise (and its sets) from a program day, renumbering the later exercises down so positions stay contiguous. Errors if the exercise isn't found or owned.",
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        exercisePosition: positionArg,
        userId: z.string().optional(),
      },
    },
    async ({ programId, dayPosition, exercisePosition, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await removeProgramExercise(
          resolved,
          programId,
          dayPosition,
          exercisePosition,
          resolveActor(extra),
        )
        if (!result) {
          throw new ToolError(
            `Exercise ${exercisePosition} of day ${dayPosition} in program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({
          userId: resolved,
          programId,
          dayPosition,
          removedExercisePosition: exercisePosition,
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'move_program_exercise',
    {
      title: 'Move Program Exercise',
      description:
        "Moves an exercise to another 0-based position within its day (cross-day moves: remove then add). The exercises between shift by one so positions stay contiguous. Errors if either position has no exercise or the program isn't owned.",
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        from: positionArg,
        to: positionArg,
        userId: z.string().optional(),
      },
    },
    async ({ programId, dayPosition, from, to, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await moveProgramExercise(
          resolved,
          programId,
          dayPosition,
          from,
          to,
          resolveActor(extra),
        )
        if (!result) {
          throw new ToolError(
            `Exercise ${from} or ${to} of day ${dayPosition} in program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({ userId: resolved, programId, dayPosition, from, to })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  // -------------------------------------------------------------------------
  // Set tools
  // -------------------------------------------------------------------------

  server.registerTool(
    'add_program_set',
    {
      title: 'Add Program Set',
      description:
        "Appends a planned set to a program exercise (by programId + 0-based dayPosition/exercisePosition), numbered after the current last set. Defaults to a blank working reps_weight set; `suggestedLoad` is in the user's unit (or the `unit` arg), `technique` JSONB in kg. Returns the new 1-based setNumber. Errors if the exercise isn't found or owned.",
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        exercisePosition: positionArg,
        ...setPatchArgs,
        unit: unitArg,
        userId: z.string().optional(),
      },
    },
    async ({ programId, dayPosition, exercisePosition, unit, userId, ...targets }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const { patch, basis } = await buildSetPatch(targets, resolved, unit)
        const result = await runOp(() =>
          addProgramSet(resolved, programId, dayPosition, exercisePosition, patch, resolveActor(extra)),
        )
        if (!result) {
          throw new ToolError(
            `Exercise ${exercisePosition} of day ${dayPosition} in program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({
          userId: resolved,
          ...(basis ? { unit: basis } : {}),
          programId,
          dayPosition,
          exercisePosition,
          setNumber: result.setNumber,
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'update_program_set',
    {
      title: 'Update Program Set',
      description:
        "Updates a planned set's targets (by programId + 0-based dayPosition/exercisePosition + 1-based setNumber). Only the named fields change; pass null to clear one — the merged set must stay valid (e.g. a duration metricMode needs durationSec). `suggestedLoad` is in the user's unit (or the `unit` arg), `technique` JSONB in kg. Errors if the set isn't found or owned.",
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        exercisePosition: positionArg,
        setNumber: setNumberArg,
        ...setPatchArgs,
        unit: unitArg,
        userId: z.string().optional(),
      },
    },
    async (
      { programId, dayPosition, exercisePosition, setNumber, unit, userId, ...targets },
      extra,
    ) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        // Reject an all-undefined patch BEFORE resolving the unit.
        if (isEmptyPatch(targets)) {
          throw new ToolError('update_program_set needs at least one field to change')
        }
        const { patch, basis } = await buildSetPatch(targets, resolved, unit)
        const result = await runOp(() =>
          updateProgramSet(
            resolved,
            programId,
            dayPosition,
            exercisePosition,
            setNumber,
            patch,
            resolveActor(extra),
          ),
        )
        if (!result) {
          throw new ToolError(
            `Set ${setNumber} of exercise ${exercisePosition} (day ${dayPosition}) in program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({
          userId: resolved,
          ...(basis ? { unit: basis } : {}),
          programId,
          dayPosition,
          exercisePosition,
          setNumber,
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'remove_program_set',
    {
      title: 'Remove Program Set',
      description:
        "Removes one planned set and renumbers the higher sets down so the order stays contiguous. An exercise keeps at least one set — removing the last one errors (remove the exercise instead). Errors if the set isn't found or owned.",
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        exercisePosition: positionArg,
        setNumber: setNumberArg,
        userId: z.string().optional(),
      },
    },
    async ({ programId, dayPosition, exercisePosition, setNumber, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await runOp(() =>
          removeProgramSet(
            resolved,
            programId,
            dayPosition,
            exercisePosition,
            setNumber,
            resolveActor(extra),
          ),
        )
        if (!result) {
          throw new ToolError(
            `Set ${setNumber} of exercise ${exercisePosition} (day ${dayPosition}) in program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({
          userId: resolved,
          programId,
          dayPosition,
          exercisePosition,
          removedSetNumber: setNumber,
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'move_program_set',
    {
      title: 'Move Program Set',
      description:
        "Moves a planned set from one 1-based setNumber to another within its exercise; the sets between shift by one so numbering stays contiguous. Errors if either number has no set or the program isn't owned.",
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        exercisePosition: positionArg,
        from: setNumberArg,
        to: setNumberArg,
        userId: z.string().optional(),
      },
    },
    async ({ programId, dayPosition, exercisePosition, from, to, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await moveProgramSet(
          resolved,
          programId,
          dayPosition,
          exercisePosition,
          from,
          to,
          resolveActor(extra),
        )
        if (!result) {
          throw new ToolError(
            `Set ${from} or ${to} of exercise ${exercisePosition} (day ${dayPosition}) in program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({ userId: resolved, programId, dayPosition, exercisePosition, from, to })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  // -------------------------------------------------------------------------
  // Per-week override tools (Phase 5)
  // -------------------------------------------------------------------------

  server.registerTool(
    'set_program_set_override',
    {
      title: 'Set Program Set Override',
      description:
        "Pins explicit targets for ONE planned set on ONE mesocycle week (by programId + 0-based dayPosition/exercisePosition + 1-based setNumber + week) — the escape hatch for block/undulating weeks the progression engine can't derive. A pinned field wins over the engine AND the deload modifier for that week; other weeks are untouched (use update_program_set to change the set itself). Repeat calls merge; pass null to unpin a field (reverting it to the engine); unpinning every field removes the override. `suggestedLoad` is in the user's unit (or the `unit` arg), `technique` JSONB in kg. Errors if the set isn't found or owned.",
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        exercisePosition: positionArg,
        setNumber: setNumberArg,
        week: weekArg,
        repMin: repArg,
        repMax: repArg,
        rir: rirArg,
        rpe: rpeArg,
        suggestedLoad: loadArg,
        tempo: tempoArg,
        durationSec: durationArg,
        distanceM: distanceArg,
        restSec: restArg,
        technique: techniqueSchema.nullable().optional(), // kg, passthrough
        unit: unitArg,
        userId: z.string().optional(),
      },
    },
    async (
      { programId, dayPosition, exercisePosition, setNumber, week, unit, userId, ...targets },
      extra,
    ) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        // Reject an all-undefined patch BEFORE resolving the unit.
        if (isEmptyPatch(targets)) {
          throw new ToolError('set_program_set_override needs at least one field to pin (or null to unpin)')
        }
        const patch: ProgramSetOverridePatch = {}
        if (targets.repMin !== undefined) patch.repMin = targets.repMin
        if (targets.repMax !== undefined) patch.repMax = targets.repMax
        if (targets.rir !== undefined) patch.rir = targets.rir
        if (targets.rpe !== undefined) patch.rpe = targets.rpe
        if (targets.tempo !== undefined) patch.tempo = targets.tempo
        if (targets.durationSec !== undefined) patch.durationSec = targets.durationSec
        if (targets.distanceM !== undefined) patch.distanceM = targets.distanceM
        if (targets.restSec !== undefined) patch.restSec = targets.restSec
        if (targets.technique !== undefined) patch.technique = targets.technique
        let basis: WeightUnit | undefined
        if (targets.suggestedLoad !== undefined) {
          if (targets.suggestedLoad === null) {
            patch.suggestedLoadKg = null
          } else {
            basis = unit ?? (await getWeightUnit(resolved))
            patch.suggestedLoadKg = toKgLoad(targets.suggestedLoad, basis)
          }
        }
        const result = await runOp(() =>
          setProgramSetOverride(
            resolved,
            programId,
            dayPosition,
            exercisePosition,
            setNumber,
            week,
            patch,
            resolveActor(extra),
          ),
        )
        if (!result) {
          throw new ToolError(
            `Set ${setNumber} of exercise ${exercisePosition} (day ${dayPosition}) in program ${programId} not found for user ${resolved}`,
          )
        }
        return jsonResult({
          userId: resolved,
          ...(basis ? { unit: basis } : {}),
          programId,
          dayPosition,
          exercisePosition,
          setNumber,
          week,
          cleared: result.cleared,
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'remove_program_set_override',
    {
      title: 'Remove Program Set Override',
      description:
        'Removes the per-week override for one planned set (by programId + 0-based dayPosition/exercisePosition + 1-based setNumber + week), reverting that week to the engine-derived targets. Errors if no override exists there or the set isn\'t found or owned.',
      inputSchema: {
        programId: z.string(),
        dayPosition: positionArg,
        exercisePosition: positionArg,
        setNumber: setNumberArg,
        week: weekArg,
        userId: z.string().optional(),
      },
    },
    async ({ programId, dayPosition, exercisePosition, setNumber, week, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const result = await removeProgramSetOverride(
          resolved,
          programId,
          dayPosition,
          exercisePosition,
          setNumber,
          week,
          resolveActor(extra),
        )
        if (!result) {
          throw new ToolError(
            `No week-${week} override on set ${setNumber} of exercise ${exercisePosition} (day ${dayPosition}) in program ${programId} for user ${resolved}`,
          )
        }
        return jsonResult({
          userId: resolved,
          programId,
          dayPosition,
          exercisePosition,
          setNumber,
          removedWeek: week,
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'propose_program_patches',
    {
      title: 'Propose Program Patches',
      description:
        "Proposes a BATCH of program changes against an ACTIVE program as ONE pending proposal the owner reviews and confirms (or declines) in the app — nothing is applied by this call. Use for grouped suggestions (e.g. volume progression: \"add a set to Chest — Bench +1\"); for single immediate edits use the individual patch tools. `patches` is an array of the corresponding patch-tool payloads WITHOUT programId/userId: add_program_set, update_program_set, remove_program_set, set_program_set_override, remove_program_set_override, set_training_max, set_program_diet_phase (program-level: `{phase}`, null clears). Loads (`suggestedLoad`, `trainingMax`) are in the user's unit (or the `unit` arg) and stored canonically in kg. `summary` is the one-line explanation the owner sees. Errors if the program isn't found, owned, or active, or any patch is invalid.",
      inputSchema: {
        programId: z.string(),
        summary: z.string().trim().min(1).max(MAX_PROPOSAL_SUMMARY),
        patches: z
          .array(
            z.object({
              tool: z.enum(PROPOSABLE_PATCH_TOOLS),
              args: z.record(z.string(), z.unknown()),
            }),
          )
          .min(1)
          .max(MAX_PROPOSAL_PATCHES),
        unit: unitArg,
        userId: z.string().optional(),
      },
    },
    async ({ programId, summary, patches, unit, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        // Resolve the unit lazily — only when some patch actually carries a
        // load-bearing number (same laziness as buildSetPatch).
        const needsUnit = patches.some(
          (p) =>
            typeof p.args.suggestedLoad === 'number' || typeof p.args.trainingMax === 'number',
        )
        const basis = needsUnit ? (unit ?? (await getWeightUnit(resolved))) : undefined
        // kg-canonical storage: convert the load-bearing fields at this
        // boundary and stamp unit:'kg', so the stored proposal can never
        // drift when the owner flips display units before confirming.
        const normalized = patches.map((p) => {
          const args: Record<string, unknown> = { ...p.args }
          delete args.unit
          if (typeof args.suggestedLoad === 'number' && basis) {
            args.suggestedLoad = toKgLoad(args.suggestedLoad, basis)
            args.unit = 'kg'
          }
          if (typeof args.trainingMax === 'number' && basis) {
            args.trainingMax = toKgLoad(args.trainingMax, basis)
            args.unit = 'kg'
          }
          return { tool: p.tool, args }
        })
        const result = await runProposalOp(() =>
          createPatchProposal(
            resolved,
            programId,
            { summary, patches: normalized },
            resolveActor(extra),
          ),
        )
        if (!result) throw new ToolError(`Program ${programId} not found for user ${resolved}`)
        return jsonResult({
          userId: resolved,
          ...(basis ? { unit: basis } : {}),
          programId,
          proposalId: result.id,
          patchCount: patches.length,
          status: 'pending',
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )
}
