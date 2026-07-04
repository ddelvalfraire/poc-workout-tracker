/**
 * Validation boundary for training Programs — the Zod equivalent of
 * `workout-input.ts`'s hand-rolled `parseWorkoutInput`. One schema is the single
 * source of truth for three consumers: it validates untrusted input
 * (`parseProgramInput`), types the narrow JSONB columns (`Technique`,
 * `Progression` via `$type<>()` in `schema.ts`), and will back the MCP tool
 * contract in Phase 2.
 *
 * Like `parseWorkoutInput`: weights are canonical kg (display↔kg conversion is
 * the MCP layer's job, Phase 2), names are trimmed, and the parse returns a
 * fresh, normalized object — the caller's input is never mutated.
 *
 * The `technique`/`progression` JSONB tail is deliberately NARROW and versioned:
 * Phase 1 fixes the shape (discriminator + `version` + minimal params); the
 * progression engine that consumes these — and the exhaustive per-variant params
 * — is Phase 5.
 */
import { z } from 'zod'
import { MAX_WEIGHT } from './workout-input'

// Mirror the bounds in `workout-input.ts` (they aren't exported there).
const MAX_NAME = 200
const MAX_REPS = 10_000
// distance_m is numeric(9,2) in the schema → 9_999_999.99 column ceiling.
const MAX_DISTANCE_M = 9_999_999.99

/** Set classification within a prescription. */
export const setTypeSchema = z.enum(['warmup', 'working', 'backoff', 'amrap'])
/** How a set is measured/logged. `estimated1RM` applies only to `reps_weight`. */
export const metricModeSchema = z.enum(['reps_weight', 'duration', 'duration_distance'])
/** Program lifecycle state. */
export const statusSchema = z.enum(['draft', 'active', 'archived'])

/**
 * Intensity-technique tail (narrow JSONB on `program_sets`). One unified
 * `stages[]` shape covers drop-set / rest-pause / myo-reps / cluster. `version`
 * discriminates future shape migrations (tolerant-parse risk mitigation).
 */
export const techniqueSchema = z
  .object({
    version: z.literal(1).default(1),
    kind: z.enum(['drop-set', 'rest-pause', 'myo-reps', 'cluster']),
    stages: z
      .array(
        z.object({
          loadKg: z.number().min(0).max(MAX_WEIGHT).nullable().optional(),
          reps: z.number().int().min(0).max(MAX_REPS).nullable().optional(),
          restSec: z.number().int().min(0).optional(),
        }),
      )
      .min(1),
  })
  .strict()

/**
 * Per-exercise progression tail (narrow JSONB on `program_exercises`). The
 * `scheme` discriminator names the rule; params are minimal here — Phase 5's
 * engine tightens each variant and computes week-N targets from them.
 */
export const progressionSchema = z
  .discriminatedUnion('scheme', [
    z.object({ scheme: z.literal('linear'), incrementKg: z.number().min(0).max(MAX_WEIGHT) }),
    z.object({
      scheme: z.literal('double-progression'),
      repMin: z.number().int().min(0).max(MAX_REPS),
      repMax: z.number().int().min(0).max(MAX_REPS),
      incrementKg: z.number().min(0).max(MAX_WEIGHT),
    }),
    z.object({
      scheme: z.literal('percent-1rm'),
      trainingMaxKg: z.number().min(0).max(MAX_WEIGHT),
      // Fractions of the training max (2 allows planned overreach singles).
      weekPercents: z.array(z.number().min(0).max(2)).min(1).max(52),
    }),
    z.object({ scheme: z.literal('rpe-target'), targetRpe: z.number().min(0).max(10) }),
    z.object({
      scheme: z.literal('weekly-volume'),
      mevSets: z.number().int().min(0).max(100),
      mrvSets: z.number().int().min(0).max(100),
    }),
  ])
  // Cross-field rules live at the union level: discriminatedUnion members must
  // stay plain ZodObjects, so per-member .refine isn't an option.
  .superRefine((p, ctx) => {
    if (p.scheme === 'double-progression' && p.repMin > p.repMax) {
      ctx.addIssue({
        code: 'custom',
        message: 'repMin must be less than or equal to repMax',
        path: ['repMin'],
      })
    }
    if (p.scheme === 'weekly-volume' && p.mevSets > p.mrvSets) {
      ctx.addIssue({
        code: 'custom',
        message: 'mevSets must be less than or equal to mrvSets',
        path: ['mevSets'],
      })
    }
  })

/**
 * The cross-field rules a planned-set row must satisfy, shared verbatim by
 * `programSetSchema`'s refinement and the patch layer's merge revalidation
 * (`db/program-patches.ts`), which checks rows assembled outside Zod's reach.
 * Returns the first violation (message + the field to blame), or null when the
 * row is coherent.
 */
export function programSetIntegrityViolation(row: {
  metricMode: string
  durationSec?: number | null
  repMin?: number | null
  repMax?: number | null
}): { path: 'durationSec' | 'repMin'; message: string } | null {
  // metric_mode integrity: a timed set needs a planned duration to be meaningful.
  if (row.metricMode !== 'reps_weight' && row.durationSec == null) {
    return {
      path: 'durationSec',
      message: 'durationSec is required when metricMode is duration or duration_distance',
    }
  }
  // A rep range must be ordered.
  if (row.repMin != null && row.repMax != null && row.repMin > row.repMax) {
    return { path: 'repMin', message: 'repMin must be less than or equal to repMax' }
  }
  return null
}

/**
 * A single planned set. Targets are typed columns (the planned-vs-actual core);
 * only `technique` is JSONB. Timed sets (`duration`/`duration_distance`) must
 * carry a planned `durationSec`.
 */
export const programSetSchema = z
  .object({
    setType: setTypeSchema.default('working'),
    metricMode: metricModeSchema.default('reps_weight'),
    repMin: z.number().int().min(0).max(MAX_REPS).nullable().optional(),
    repMax: z.number().int().min(0).max(MAX_REPS).nullable().optional(),
    rir: z.number().int().min(0).max(20).nullable().optional(),
    rpe: z.number().min(0).max(10).nullable().optional(),
    suggestedLoadKg: z.number().min(0).max(MAX_WEIGHT).nullable().optional(),
    tempo: z.string().max(20).nullable().optional(),
    durationSec: z.number().int().min(0).nullable().optional(),
    distanceM: z.number().min(0).max(MAX_DISTANCE_M).nullable().optional(),
    technique: techniqueSchema.nullable().optional(),
  })
  .superRefine((s, ctx) => {
    const violation = programSetIntegrityViolation(s)
    if (violation) {
      ctx.addIssue({ code: 'custom', message: violation.message, path: [violation.path] })
    }
  })

/**
 * A per-week override of one planned set's TARGET fields (Phase 5's escape
 * hatch for block/undulating models). Strict and shape-preserving: no
 * `setType`/`metricMode` — changing a set's shape is an edit, not an override.
 * Explicit null clears an overridden field; omitted = not overridden. The
 * cross-field rules run against the MERGED (base ⊕ override) row in the DB
 * layer, which is the only place both halves are visible.
 */
export const setOverrideSchema = z
  .object({
    repMin: z.number().int().min(0).max(MAX_REPS).nullable().optional(),
    repMax: z.number().int().min(0).max(MAX_REPS).nullable().optional(),
    rir: z.number().int().min(0).max(20).nullable().optional(),
    rpe: z.number().min(0).max(10).nullable().optional(),
    suggestedLoadKg: z.number().min(0).max(MAX_WEIGHT).nullable().optional(),
    tempo: z.string().max(20).nullable().optional(),
    durationSec: z.number().int().min(0).nullable().optional(),
    distanceM: z.number().min(0).max(MAX_DISTANCE_M).nullable().optional(),
    technique: techniqueSchema.nullable().optional(),
  })
  .strict()

/** One exercise slot within a program day, with its planned sets + progression. */
export const programExerciseSchema = z.object({
  wgerExerciseId: z.number().int(),
  name: z.string().trim().min(1).max(MAX_NAME),
  progression: progressionSchema.nullable().optional(),
  sets: z.array(programSetSchema).min(1),
})

/** One training day (e.g. "Push") — an ordered list of exercises. */
export const programDaySchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME),
  notes: z.string().max(2000).nullable().optional(),
  exercises: z.array(programExerciseSchema).min(1),
})

/** A full program ready to persist. `position`/`setNumber` are assigned at insert. */
export const programInputSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME),
    status: statusSchema.default('draft'),
    mesocycleWeeks: z.number().int().min(1).max(52).default(1),
    deloadWeek: z.number().int().min(1).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    days: z.array(programDaySchema).min(1),
  })
  // A deload can only fall within the mesocycle (defaults applied before this runs).
  .refine((p) => p.deloadWeek == null || p.deloadWeek <= p.mesocycleWeeks, {
    message: 'deloadWeek must not exceed mesocycleWeeks',
    path: ['deloadWeek'],
  })

export type SetType = z.infer<typeof setTypeSchema>
export type MetricMode = z.infer<typeof metricModeSchema>
export type Technique = z.infer<typeof techniqueSchema>
export type Progression = z.infer<typeof progressionSchema>
export type SetOverrideInput = z.infer<typeof setOverrideSchema>
export type ProgramSetInput = z.infer<typeof programSetSchema>
export type ProgramExerciseInput = z.infer<typeof programExerciseSchema>
export type ProgramDayInput = z.infer<typeof programDaySchema>
export type ProgramInput = z.infer<typeof programInputSchema>

/**
 * Validates untrusted input into a normalized `ProgramInput`, throwing a
 * `ZodError` on any malformed field. Returns a fresh object — the caller's input
 * is never mutated.
 */
export function parseProgramInput(input: unknown): ProgramInput {
  return programInputSchema.parse(input)
}
