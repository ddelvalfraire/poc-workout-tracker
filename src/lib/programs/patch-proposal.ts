import { z } from 'zod'
import { setTypeSchema, metricModeSchema, techniqueSchema, dietPhaseSchema } from '@/lib/programs/program-input'
import { MAX_WEIGHT } from '@/lib/workout/workout-input'
import { kgToDisplay, type WeightUnit } from '@/lib/units'

/**
 * The batch-patch proposal envelope (proposals plan §3): a grouped set of
 * EXISTING patch ops an agent proposes against an ACTIVE program, stored as
 * ONE `program_patch_proposals` row and applied atomically on the owner's
 * single combined confirm. Deliberately NOT a third entity and NOT a
 * normalized patch-list table: the patches ride as one validated jsonb array
 * whose members are shaped exactly like the MCP patch-tool inputs (minus
 * `programId`/`userId`), so `describeToolCall` renders each one as the same
 * approval-card sentence the chat flow uses, and confirm-time application maps
 * 1:1 onto the event-logged functions in db/program-patches.ts.
 *
 * Stored values are CANONICAL KG (`unit` may only say 'kg'): the propose tool
 * converts at the boundary, so a proposal can never drift when the owner flips
 * their display unit between propose and confirm. Bounds mirror the MCP arg
 * schemas; `strictObject` rejects junk keys so an unknown field can't smuggle
 * past confirm-time re-validation.
 */

/** Every op a batch proposal may carry — the set-level + TM ops volume
 *  progression needs; extend deliberately, never implicitly. */
export const PROPOSABLE_PATCH_TOOLS = [
  'add_program_set',
  'update_program_set',
  'remove_program_set',
  'set_program_set_override',
  'remove_program_set_override',
  'set_training_max',
  // Program-level phase context — lets the coach (or a staleness trigger)
  // propose ending/affirming a cut; applied via the same event-logged op
  // as the direct MCP tool.
  'set_program_diet_phase',
] as const

export type ProposablePatchTool = (typeof PROPOSABLE_PATCH_TOOLS)[number]

/** One proposal holds at most this many patches — a "batch", not a rewrite. */
export const MAX_PROPOSAL_PATCHES = 20
/** The one-line summary shown on the approval card. */
export const MAX_PROPOSAL_SUMMARY = 500

const positionField = z.number().int().min(0).max(999)
const setNumberField = z.number().int().min(1).max(999)
const weekField = z.number().int().min(1).max(99)
const repField = z.number().int().min(0).max(10_000).nullable().optional()
const rirField = z.number().int().min(0).max(20).nullable().optional()
const rpeField = z.number().min(0).max(10).nullable().optional()
const tempoField = z.string().max(20).nullable().optional()
const durationField = z.number().int().min(0).nullable().optional()
const distanceField = z.number().min(0).max(9_999_999.99).nullable().optional()
const restField = z.number().int().min(0).max(3600).nullable().optional()
/** Loads are stored in kg (converted at the propose boundary). */
const loadKgField = z.number().min(0).max(MAX_WEIGHT).nullable().optional()
/** Stored args are kg-canonical; the literal keeps describeToolCall honest. */
const kgUnitField = z.literal('kg').optional()

/** The planned-set target fields shared by add/update/override patches. */
const setTargetFields = {
  setType: setTypeSchema.optional(),
  metricMode: metricModeSchema.optional(),
  repMin: repField,
  repMax: repField,
  rir: rirField,
  rpe: rpeField,
  suggestedLoad: loadKgField,
  tempo: tempoField,
  durationSec: durationField,
  distanceM: distanceField,
  restSec: restField,
  technique: techniqueSchema.nullable().optional(),
  unit: kgUnitField,
}

/** The target keys that count as "a change" for the empty-patch guards. */
const TARGET_KEYS = [
  'setType',
  'metricMode',
  'repMin',
  'repMax',
  'rir',
  'rpe',
  'suggestedLoad',
  'tempo',
  'durationSec',
  'distanceM',
  'restSec',
  'technique',
] as const

function hasTargetField(args: Record<string, unknown>): boolean {
  return TARGET_KEYS.some((key) => args[key] !== undefined)
}

export const proposalPatchSchema = z.discriminatedUnion('tool', [
  z.object({
    tool: z.literal('add_program_set'),
    args: z.strictObject({
      dayPosition: positionField,
      exercisePosition: positionField,
      ...setTargetFields,
    }),
  }),
  z.object({
    tool: z.literal('update_program_set'),
    args: z
      .strictObject({
        dayPosition: positionField,
        exercisePosition: positionField,
        setNumber: setNumberField,
        ...setTargetFields,
      })
      .refine(hasTargetField, { message: 'update_program_set needs at least one field to change' }),
  }),
  z.object({
    tool: z.literal('remove_program_set'),
    args: z.strictObject({
      dayPosition: positionField,
      exercisePosition: positionField,
      setNumber: setNumberField,
    }),
  }),
  z.object({
    tool: z.literal('set_program_set_override'),
    args: z
      .strictObject({
        dayPosition: positionField,
        exercisePosition: positionField,
        setNumber: setNumberField,
        week: weekField,
        ...setTargetFields,
      })
      .refine(hasTargetField, {
        message: 'set_program_set_override needs at least one field to pin',
      }),
  }),
  z.object({
    tool: z.literal('remove_program_set_override'),
    args: z.strictObject({
      dayPosition: positionField,
      exercisePosition: positionField,
      setNumber: setNumberField,
      week: weekField,
    }),
  }),
  z.object({
    tool: z.literal('set_training_max'),
    args: z.strictObject({
      dayPosition: positionField,
      exercisePosition: positionField,
      trainingMax: z.number().min(0).max(MAX_WEIGHT),
      unit: kgUnitField,
    }),
  }),
  z.object({
    tool: z.literal('set_program_diet_phase'),
    // Program-level (no position address); null clears the phase. No unit —
    // nothing here is a load.
    args: z.strictObject({ phase: dietPhaseSchema.nullable() }),
  }),
])

export const proposalPatchesSchema = z
  .array(proposalPatchSchema)
  .min(1)
  .max(MAX_PROPOSAL_PATCHES)

export type ProposalPatch = z.infer<typeof proposalPatchSchema>

/**
 * The stored kg-canonical patch re-expressed in a display unit, for the
 * approval card's sentence diffs only (`describeToolCall` echoes the `unit`
 * arg). Never written back — the stored row stays kg. A 'kg' viewer gets the
 * patch untouched.
 */
export function patchForDisplay(patch: ProposalPatch, unit: WeightUnit): ProposalPatch {
  if (unit === 'kg') return patch
  // Loadless program-level ops have nothing to convert (and no unit key to echo).
  if (patch.tool === 'set_program_diet_phase') return patch
  const args: Record<string, unknown> = { ...patch.args, unit }
  if (typeof args.suggestedLoad === 'number') {
    args.suggestedLoad = kgToDisplay(args.suggestedLoad, unit)
  }
  if (typeof args.trainingMax === 'number') {
    args.trainingMax = kgToDisplay(args.trainingMax, unit)
  }
  return { ...patch, args } as ProposalPatch
}
