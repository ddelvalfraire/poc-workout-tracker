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
import { exerciseSourceSchema } from './custom-exercise-input'
import { overshootPolicySchema } from './overshoot-policy'

// Mirror the bounds in `workout-input.ts` (they aren't exported there).
const MAX_NAME = 200
const MAX_REPS = 10_000
// distance_m is numeric(9,2) in the schema → 9_999_999.99 column ceiling.
const MAX_DISTANCE_M = 9_999_999.99
// Between-set rest ceiling: an hour of rest after one set is already absurd;
// anything past it is a typo, not a prescription. Shared with the preferences
// action so the plan and the session default agree on what "valid" means.
export const MAX_REST_SEC = 3600

/** Set classification within a prescription. */
export const setTypeSchema = z.enum(['warmup', 'working', 'backoff', 'amrap'])
/** How a set is measured/logged. `estimated1RM` applies only to `reps_weight`. */
export const metricModeSchema = z.enum(['reps_weight', 'duration', 'duration_distance'])
/** Program lifecycle state SETTABLE through input. 'proposed' is deliberately
 *  absent: owner-authored rows never enter it, and nothing may promote INTO it
 *  through upsert/set_program_status — proposals are minted only by the coach
 *  bridge (Phase 2) and exit only via adoptProgram/declineProgram. */
export const statusSchema = z.enum(['draft', 'active', 'archived'])
/** Who can see a program from outside the owner's account (tier 1 of the
 *  social ladder): 'private' = owner only (the default forever), 'link' =
 *  read-only via a live share URL, 'public' = link behavior plus eligibility
 *  for a future browse surface (the field is the seam; no directory yet). */
export const visibilitySchema = z.enum(['private', 'link', 'public'])
/** Diet-phase context (programs.dietPhase, nullable text). NULL = "not a
 *  thing": the engine behaves byte-for-byte as before the column existed —
 *  no default assumption, no onboarding question, no nag. 'cutting' ANNOTATES
 *  stall verdicts (never suppresses, never changes a load — see
 *  applyDietPhaseToAdjustment in lib/autoregulate.ts); 'maintaining'/
 *  'bulking' are stored context only in v1 (zero engine effect). */
export const dietPhaseSchema = z.enum(['cutting', 'maintaining', 'bulking'])

// Article-metadata caps (PRD §3): the description is an article lead, the
// rest are short tokens/URLs.
export const MAX_DESCRIPTION = 4000
export const MAX_METADATA_TEXT = 500

/** Trimmed optional text: blank collapses to null (absent stays absent so the
 *  db layer's `?? null` keeps create/replace semantics identical to `notes`). */
function trimmedText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional()
}

/** Trimmed optional text that must additionally parse as an http(s) URL. */
function httpUrlText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .superRefine((value, ctx) => {
      if (value === null) return
      let parsed: URL
      try {
        parsed = new URL(value)
      } catch {
        ctx.addIssue({ code: 'custom', message: 'must be a valid http(s) URL' })
        return
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        ctx.addIssue({ code: 'custom', message: 'must be a valid http(s) URL' })
      }
    })
    .nullable()
    .optional()
}

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
 * The SHAPE of a scheduled deload — how hard the deload week backs off. All
 * fields default to the historical engine constants (progression.ts's
 * DELOAD_LOAD_FACTOR / DELOAD_SET_FACTOR), so `{}` parses to exactly today's
 * deload. `rpeCap` (5–10, null = no cap) additionally clamps any derived RPE
 * stamps on the deload week's progressed sets. `timedExercises` decides what
 * the deload does to duration/duration_distance rows: 'untouched' (the
 * default — a fully-timed exercise derives its deload week as a normal week;
 * a mixed exercise deloads its lifting rows only) or 'scaled' (the explicit
 * opt-in: setFactor resizes and 'deload' stamps apply to timed rows too —
 * durationSec is never multiplied by loadFactor either way). The default
 * covers legacy stored policies at resolve time — the adjudicated D3 call
 * ("creator decides"): stored scheduled policies no longer silently halve a
 * timed exercise's sets.
 */
export const deloadShapeSchema = z
  .object({
    loadFactor: z.number().min(0).max(1).default(0.85),
    setFactor: z.number().min(0).max(1).default(0.5),
    rpeCap: z.number().min(5).max(10).nullable().default(null),
    timedExercises: z.enum(['untouched', 'scaled']).default('untouched'),
  })
  .strict()

/**
 * Program-level deload policy (nullable JSONB on `programs`). The `mode`
 * discriminator picks the regime:
 * - 'none'      — the deload week (if any) derives as a NORMAL week: no load/
 *                 set modifier, no 'deload' stamp, and the M4 early-deload
 *                 suggestion is suppressed. `deloadWeek` still shapes the
 *                 week AXIS (progression steps skip it) — geometry is not
 *                 this policy's to change.
 * - 'reactive'  — no scheduled modifier either; deloads happen only when the
 *                 lifter reacts to the M4 early-deload flag (which stays on).
 * - 'scheduled' — the deload week applies `shape` (load/set factors + RPE
 *                 cap). With the default shape this is byte-for-byte the
 *                 legacy behavior.
 * A null/absent/invalid column resolves at READ time via
 * `resolveDeloadPolicy` (progression.ts) — never here — so every pre-policy
 * program keeps deriving exactly what it always has (silence over
 * corruption).
 */
export const deloadPolicySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }).strict(),
  z.object({ mode: z.literal('reactive') }).strict(),
  z.object({ mode: z.literal('scheduled'), shape: deloadShapeSchema }).strict(),
])

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
    // Progresses the TARGETS instead of the load: reps for rep_weight sets,
    // seconds for timed sets. The engine adds the increment once per prior
    // non-deload week (like `linear`), clamped to the optional caps; loads
    // pass through untouched. Built for bodyweight and timed movements.
    z.object({
      scheme: z.literal('rep-progression'),
      incrementReps: z.number().int().min(0).max(50).default(0),
      incrementSec: z.number().int().min(0).max(600).default(0),
      maxReps: z.number().int().min(1).max(MAX_REPS).nullable().optional(),
      maxSec: z.number().int().min(1).max(86_400).nullable().optional(),
    }),
    // 5/3/1-style wave cycling: `wave[weekIdx][setIdx]` is the fraction of the
    // training max for that set, the wave repeats as weeks advance, and the TM
    // grows by `incrementKg` once per completed wave (classic Wendler bumps
    // unconditionally; resetting a stalled TM is a deliberate edit, not
    // engine magic). Optional `waveReps` prescribes per-week reps the same
    // way (5/5/5 → 3/3/3 → 5/3/1). `incrementKg: 0` gives static wave loading.
    z.object({
      scheme: z.literal('amrap-cycle'),
      trainingMaxKg: z.number().min(0).max(MAX_WEIGHT),
      incrementKg: z.number().min(0).max(MAX_WEIGHT),
      // Completed waves whose bumps are already FOLDED INTO trainingMaxKg by
      // the wave-boundary persist (instantiation routes each completed wave's
      // increment through setTrainingMax so the bump is visible in the change
      // log). The engine adds increments only for completed waves BEYOND this
      // count, so a persisted bump and the derive-time wave math can never
      // double-count. Absent (all pre-persist programs) = 0: fully virtual.
      bankedWaves: z.number().int().min(0).max(1000).optional(),
      wave: z
        .array(z.array(z.number().min(0).max(2)).min(1).max(20))
        .min(1)
        .max(12),
      waveReps: z
        .array(z.array(z.number().int().min(0).max(MAX_REPS)).min(1).max(20))
        .min(1)
        .max(12)
        .optional(),
      // Wendler-canon deload row: when present AND the program's deload
      // policy is 'scheduled', the deload week EMITS these sets — one per
      // percent, at `reps` — off the effective TM, REPLACING the scale-shape
      // derivation (still stamped 'deload'). Absent = scale-shape as ever.
      deloadRow: z
        .object({
          percents: z.array(z.number().min(0.1).max(1)).min(1).max(20),
          reps: z.number().int().min(1).max(20),
        })
        .strict()
        .optional(),
      // Which TM the SCHEDULED deload week derives off. 'after-deload'
      // (Wendler canon, the default for NEW configs — materialized by the
      // transform below): the wave's earned bump becomes effective only from
      // the first non-deload week after the deload, so the deload derives
      // off the OLD TM. 'before-deload': the historical engine behavior (the
      // bump is visible to the deload week) — stamped onto every
      // pre-existing amrap-cycle config by migration 0037, and what the
      // engine assumes when the field is absent from a stored row.
      tmBumpTiming: z.enum(['before-deload', 'after-deload']).optional(),
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
    if (p.scheme === 'rep-progression' && p.incrementReps === 0 && p.incrementSec === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'rep-progression needs incrementReps or incrementSec greater than 0',
        path: ['incrementReps'],
      })
    }
    if (p.scheme === 'amrap-cycle' && p.waveReps && p.waveReps.length !== p.wave.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'waveReps must have one row per wave week',
        path: ['waveReps'],
      })
    }
  })
  // The zod-level default for `tmBumpTiming` — a transform instead of
  // `.default()` so the TYPE keeps the field optional: stored rows written
  // before the field existed (and migration-stamped ones) are read WITHOUT a
  // re-parse, so the engine's absent-field fallback ('before-deload', the
  // legacy behavior) must stay expressible. Every parse path (create,
  // replace, patch) materializes 'after-deload' onto NEW amrap-cycle configs.
  .transform((p) =>
    p.scheme === 'amrap-cycle' && p.tmBumpTiming === undefined
      ? { ...p, tmBumpTiming: 'after-deload' as const }
      : p,
  )

/** The mesocycle length ceiling — a year of weeks; past that it isn't a block. */
export const MAX_MESOCYCLE_WEEKS = 52
/** Body check-in cadence bounds, days: under 3 is nagging, over 90 isn't a cadence. */
export const MIN_CHECK_IN_DAYS = 3
export const MAX_CHECK_IN_DAYS = 90

/**
 * The one cross-field rule a program's own scalars must satisfy: a deload can
 * only fall WITHIN the mesocycle. Shared verbatim by `programInputSchema`'s
 * refinement (full replace) and the granular meta patch op (`updateProgramMeta`
 * in db/program-patches.ts), which checks the MERGED row — patch over stored —
 * outside Zod's reach. The set-level twin is `programSetIntegrityViolation`
 * below: same shape, same reason.
 */
export function programMesocycleViolation(row: {
  mesocycleWeeks: number
  deloadWeek?: number | null
}): { path: 'deloadWeek'; message: string } | null {
  if (row.deloadWeek != null && row.deloadWeek > row.mesocycleWeeks) {
    return { path: 'deloadWeek', message: 'deloadWeek must not exceed mesocycleWeeks' }
  }
  return null
}

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
    // Rest AFTER this set, seconds — per-set granularity (the requested
    // finest grain). Stored as given; between-set only (intra-set rest lives
    // in the technique stages).
    restSec: z.number().int().min(0).max(MAX_REST_SEC).nullable().optional(),
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
    // A non-null override rest wins for that week, like every field above.
    restSec: z.number().int().min(0).max(MAX_REST_SEC).nullable().optional(),
    technique: techniqueSchema.nullable().optional(),
  })
  .strict()

/** One exercise slot within a program day, with its planned sets + progression. */
export const programExerciseSchema = z
  .object({
    wgerExerciseId: z.number().int(),
    // Exercise identity is the composite (source, wgerExerciseId); defaulted so
    // every pre-existing caller keeps meaning the wger catalog.
    source: exerciseSourceSchema.default('wger'),
    name: z.string().trim().min(1).max(MAX_NAME),
    progression: progressionSchema.nullable().optional(),
    // Same non-null value within a day = perform as a superset. Carried through
    // the full-replace path so groupings survive upsert/edit round-trips.
    supersetGroup: z.number().int().min(0).nullable().optional(),
    // How a target beaten on a different axis is credited for THIS movement;
    // null falls back to the program policy, then the scheme's own default.
    // Carried on the full-replace path for the same reason supersetGroup is:
    // without it, every builder save silently cleared a policy the agent had
    // set, because the insert simply never wrote the column.
    overshootPolicy: overshootPolicySchema.nullable().optional(),
    sets: z.array(programSetSchema).min(1),
  })
  // Metric-mode × scheme integrity is enforced at the DERIVATION layer only
  // (deriveWeekSets no-ops load-anchored schemes on timed sets — silence over
  // corruption). Deliberately NOT re-validated here: MCP write tools accepted
  // timed-set + load-scheme combos before cardio v1, so a parse-time throw
  // would brick full-replace saves of any program storing that legacy shape.

/** One training day (e.g. "Push") — an ordered list of exercises. */
export const programDaySchema = z.object({
  // The day's DURABLE slot identity (program_days.slot_key), round-tripped by
  // whoever is editing so a full replace can carry provenance across the wipe:
  // a day whose key matches an existing slot keeps it, and the workouts logged
  // against that slot are re-attached to the re-inserted row. Omitted = a NEW
  // day (nothing to preserve) — never an error, since adapters that cannot
  // round-trip it must still be able to save. Unknown keys are treated the
  // same way: a key from another program can only fail to match.
  slotKey: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(MAX_NAME),
  notes: z.string().max(2000).nullable().optional(),
  // Weekday schedule (0–6, Sunday-first), normalized to a deduped ascending
  // list. Part of the day tree, so it full-replaces like `name` — omitted or
  // empty persists as unscheduled ('{}', the column default). The raw cap of 7
  // rejects padded input before dedupe can hide it.
  weekdays: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .transform((ws) => [...new Set(ws)].sort((a, b) => a - b))
    .optional(),
  exercises: z.array(programExerciseSchema).min(1),
})

/** A full program ready to persist. `position`/`setNumber` are assigned at insert. */
export const programInputSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME),
    // Lifecycle status. Genuinely OPTIONAL — no .default('draft'): a
    // materialized default would ride the full-replace update path and
    // silently reset a stored ACTIVE program to 'draft' (deactivating it)
    // whenever an upsert omits the field. Same preserve-on-omit discipline
    // as the switches below: saveProgram defaults omitted-on-create to
    // 'draft' (the coach path forces 'proposed' either way); updateProgram
    // preserves the stored status when omitted.
    status: statusSchema.optional(),
    mesocycleWeeks: z.number().int().min(1).max(MAX_MESOCYCLE_WEEKS).default(1),
    deloadWeek: z.number().int().min(1).nullable().optional(),
    // Auto-regulation switch (programs.autoregulation). Genuinely OPTIONAL —
    // no .default(true): a materialized default would ride the full-replace
    // update path and silently flip a user's stored OFF back ON whenever an
    // upsert omits the field. saveProgram defaults omitted-on-create to ON;
    // updateProgram preserves the stored value when omitted.
    autoregulation: z.boolean().optional(),
    // Fixed-mode stall policy (programs.autoregStallPolicy): 'all-sets'
    // (ANY working set under its floor stalls — C1) | 'first-set' (only the
    // lowest-setNumber working set governs). Same preserve-on-omit
    // discipline as autoregulation above: NO .default('all-sets'), or an
    // upsert that omits the field would silently flip a stored 'first-set'
    // back to the default. saveProgram lets the column default cover
    // omitted-on-create; updateProgram preserves when omitted.
    autoregStallPolicy: z.enum(['all-sets', 'first-set']).optional(),
    // Deload policy (programs.deloadPolicy, nullable JSONB — see
    // deloadPolicySchema above). Same preserve-on-omit discipline as the
    // switches: NO default, or an upsert that omits the field would wipe a
    // stored policy back to legacy. saveProgram treats omitted-on-create as
    // null (= legacy resolution); updateProgram preserves when omitted, and
    // an explicit null clears the policy back to legacy resolution.
    deloadPolicy: deloadPolicySchema.nullable().optional(),
    // The program-wide default for "what counts as beating a target", which
    // an exercise may override. Same preserve/clear discipline as
    // deloadPolicy: omitted leaves the stored value alone, explicit null
    // restores the per-scheme defaults.
    overshootPolicy: overshootPolicySchema.nullable().optional(),
    // Diet-phase context (programs.dietPhase — see dietPhaseSchema above).
    // Same preserve-on-omit discipline as the switches: NO default, or an
    // upsert that omits the field would wipe a stored phase. saveProgram
    // treats omitted-on-create as null (no phase); updateProgram preserves
    // when omitted, and an explicit null clears the phase (set_at still
    // bumps — clearing IS a change). Cloning/adopting NEVER carries it:
    // phases don't cross training blocks (db/programs.ts cloneProgram,
    // db/templates.ts, db/program-shares.ts).
    dietPhase: dietPhaseSchema.nullable().optional(),
    // Performance→plan auto-sync switch (programs.planSync). Same preserve-on-
    // omit discipline as autoregulation above: no .default(true), or an upsert
    // that omits the field would flip a stored OFF back ON. saveProgram
    // defaults omitted-on-create to ON; updateProgram preserves when omitted.
    planSync: z.boolean().optional(),
    // Program-suggested body check-in cadence, days (programs.checkInEveryDays).
    // Null = no suggestion; when set, 3–90 (under 3 is nagging, over 90 isn't a
    // cadence). Same preserve-on-omit discipline as the switches above: no
    // default, or an upsert that omits the field would wipe a stored cadence.
    // saveProgram treats omitted-on-create as null; updateProgram preserves
    // when omitted, and an explicit null clears the suggestion.
    checkInEveryDays: z
      .number()
      .int()
      .min(MIN_CHECK_IN_DAYS)
      .max(MAX_CHECK_IN_DAYS)
      .nullable()
      .optional(),
    // Sharing visibility (programs.visibility). Same preserve-on-omit
    // discipline as the switches above: no .default('private'), or an upsert
    // that omits the field would flip a shared program back to private (or a
    // materialized default would ride the update path). saveProgram treats
    // omitted-on-create as the column default ('private' — the default
    // forever); updateProgram preserves when omitted. Whitelist-only: nothing
    // outside the enum can ever reach the column.
    visibility: visibilitySchema.optional(),
    notes: z.string().max(2000).nullable().optional(),
    // Article metadata (PRD §3) — presentation only, all optional; blank
    // strings collapse to null so "cleared in a form" and "absent" persist
    // identically. URLs must be http(s) — they render as a hero image src
    // and an attribution href.
    description: trimmedText(MAX_DESCRIPTION),
    icon: trimmedText(MAX_METADATA_TEXT),
    heroImageUrl: httpUrlText(MAX_METADATA_TEXT),
    sourceUrl: httpUrlText(MAX_METADATA_TEXT),
    days: z.array(programDaySchema).min(1),
  })
  // A deload can only fall within the mesocycle (defaults applied before this
  // runs) — the shared rule, so the full replace and the granular meta patch
  // can never drift apart on it.
  .superRefine((p, ctx) => {
    const violation = programMesocycleViolation(p)
    if (violation) {
      ctx.addIssue({ code: 'custom', message: violation.message, path: [violation.path] })
    }
  })

/**
 * A PARTIAL edit of a program's own scalars — the granular twin of the
 * program-level half of `programInputSchema`, for `updateProgramMeta`
 * (db/program-patches.ts) and the `update_program_meta` MCP tool.
 *
 * Field-for-field the SAME builders as the full schema above (same bounds,
 * same trim/blank→null collapse, same http(s) URL rule), so the two paths can
 * never drift on what a valid value is. Two deliberate differences:
 *  - `mesocycleWeeks` carries NO `.default(1)` — on a patch, omitted must mean
 *    "unchanged", and a materialized default would silently re-scope a
 *    12-week block to 1 whenever a caller only wanted to fix a typo in the
 *    name. Every field here is preserve-on-omit.
 *  - No `deloadWeek ≤ mesocycleWeeks` refinement: a patch may legitimately
 *    carry only one half of that pair, so the rule can only be checked
 *    against the MERGED row (patch over stored) in the db layer, via the
 *    shared `programMesocycleViolation`.
 *
 * Deliberately EXCLUDED: `status` (set_program_status owns the lifecycle),
 * `visibility` (setProgramVisibility in db/program-shares.ts owns it — it is a
 * manage-gated outbound-sharing decision, refused on proposals, not
 * metadata), the five behavior policies (set_program_policy), and the day
 * tree (the add/update/remove/move ops).
 */
export const programMetaPatchSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME).optional(),
  mesocycleWeeks: z.number().int().min(1).max(MAX_MESOCYCLE_WEEKS).optional(),
  deloadWeek: z.number().int().min(1).nullable().optional(),
  checkInEveryDays: z
    .number()
    .int()
    .min(MIN_CHECK_IN_DAYS)
    .max(MAX_CHECK_IN_DAYS)
    .nullable()
    .optional(),
  notes: z.string().max(2000).nullable().optional(),
  description: trimmedText(MAX_DESCRIPTION),
  icon: trimmedText(MAX_METADATA_TEXT),
  heroImageUrl: httpUrlText(MAX_METADATA_TEXT),
  sourceUrl: httpUrlText(MAX_METADATA_TEXT),
})

export type SetType = z.infer<typeof setTypeSchema>
/** The concrete input-settable status union — for signatures that must not
 *  inherit the optionality `ProgramInput['status']` now carries. */
export type ProgramStatus = z.infer<typeof statusSchema>
export type ProgramVisibility = z.infer<typeof visibilitySchema>
export type MetricMode = z.infer<typeof metricModeSchema>
export type Technique = z.infer<typeof techniqueSchema>
export type DeloadShape = z.infer<typeof deloadShapeSchema>
export type DeloadPolicy = z.infer<typeof deloadPolicySchema>
export type DietPhase = z.infer<typeof dietPhaseSchema>
export type Progression = z.infer<typeof progressionSchema>
export type SetOverrideInput = z.infer<typeof setOverrideSchema>
export type ProgramSetInput = z.infer<typeof programSetSchema>
export type ProgramExerciseInput = z.infer<typeof programExerciseSchema>
export type ProgramDayInput = z.infer<typeof programDaySchema>
export type ProgramInput = z.infer<typeof programInputSchema>
/** A partial edit of the program's own scalars (see programMetaPatchSchema). */
export type ProgramMetaPatch = z.infer<typeof programMetaPatchSchema>
/** The PRE-parse shape (defaults like `source` not yet applied) — what lenient
 *  client mappers emit; `parseProgramInput` normalizes it server-side. */
export type ProgramInputUnparsed = z.input<typeof programInputSchema>

/**
 * Validates untrusted input into a normalized `ProgramInput`, throwing a
 * `ZodError` on any malformed field. Returns a fresh object — the caller's input
 * is never mutated.
 */
export function parseProgramInput(input: unknown): ProgramInput {
  return programInputSchema.parse(input)
}
