import {
  deloadPolicySchema,
  type DeloadPolicy,
  type Progression,
  type Technique,
} from './program-input'
import { MAX_RELIABLE_REPS } from './one-rep-max'

/**
 * The Phase 5 progression engine — pure functions only (no IO, no db imports).
 * Given an exercise's week-1 template sets, its `progression` JSONB, and the
 * program's week geometry, `deriveWeekSets` computes the week-N prescription
 * that instantiation seeds and `preview_program_week` displays.
 *
 * Precedence (stated once, applied across layers): per-week OVERRIDE (merged by
 * the caller, not here) > DELOAD modifier > progression SCHEME > template row.
 * All loads are canonical kg, full precision — display rounding happens at the
 * MCP boundary like everywhere else.
 */

/** Deload week: derived loads are multiplied by this. */
export const DELOAD_LOAD_FACTOR = 0.85
/** Deload week: the working-set count is scaled by this (ceil, min 1). */
export const DELOAD_SET_FACTOR = 0.5

/** A deload policy after read-time resolution — never null: legacy programs
 *  resolve to the regime they always had. Same shape as `DeloadPolicy` with
 *  the scheduled shape's defaults applied. */
export type ResolvedDeloadPolicy = DeloadPolicy

/**
 * Resolves the `programs.deload_policy` column into the policy the engine
 * applies — THE one code path between the stored JSON and behavior (silence
 * over corruption: an invalid blob degrades to legacy, never throws, never
 * half-applies). A valid stored policy wins; null/absent/invalid resolves to
 * the LEGACY regime: `deloadWeek` set → 'scheduled' at the historical
 * factors (byte-for-byte today's behavior), no deload week → 'none'.
 */
export function resolveDeloadPolicy(
  policyJson: unknown,
  deloadWeek: number | null,
): ResolvedDeloadPolicy {
  const parsed = deloadPolicySchema.safeParse(policyJson)
  if (parsed.success) return parsed.data
  return deloadWeek !== null
    ? {
        mode: 'scheduled',
        shape: { loadFactor: DELOAD_LOAD_FACTOR, setFactor: DELOAD_SET_FACTOR, rpeCap: null },
      }
    : { mode: 'none' }
}

/**
 * True only when the STORED policy is a valid, explicit `{mode:'none'}` —
 * the one case that suppresses the M4 early-deload suggestion. Deliberately
 * NOT the resolver's 'none': a pre-policy program without a deload week also
 * RESOLVES to 'none', but it never asked for silence, and the byte-identity
 * guarantee keeps its advisory flag exactly as it is today.
 */
export function isExplicitNoDeloadPolicy(policyJson: unknown): boolean {
  const parsed = deloadPolicySchema.safeParse(policyJson)
  return parsed.success && parsed.data.mode === 'none'
}

/**
 * Rep-max %1RM curve underlying the RTS chart. Index i (0-based) = percent of
 * 1RM for an (i+1)-rep max. The published chart is this curve read on the
 * reps+RIR diagonal: "5 reps @ RPE 8" (2 in reserve) sits at the 7RM percent.
 * Entries 13-20 back the low-RPE corner of the chart (e.g. 12 reps @ RPE 6).
 */
const REP_MAX_PERCENTS = [
  1.0, 0.955, 0.922, 0.892, 0.863, 0.837, 0.811, 0.786, 0.762, 0.739, 0.707, 0.68, 0.667, 0.653,
  0.64, 0.626, 0.613, 0.599, 0.586, 0.574,
]

/**
 * RTS-chart %1RM for `reps` performed at `rpe`. Whole-RIR points read the curve
 * directly; half-step RPEs interpolate between the adjacent points. RPE is
 * snapped DOWN to the nearest 0.5. Returns null outside the reliable range
 * (reps must be an integer 1–12, rpe 6–10) — callers treat null as "no answer",
 * mirroring `estimate1RM`.
 */
export function percentOf1RM(reps: number, rpe: number): number | null {
  if (!Number.isInteger(reps) || reps < 1 || reps > MAX_RELIABLE_REPS) return null
  if (!Number.isFinite(rpe) || rpe < 6 || rpe > 10) return null
  const halfSteps = Math.floor(rpe * 2) // snap down to 0.5 increments
  // Reps-in-reserve expressed in half steps; RPE 10 = 0 in reserve.
  const rirHalfSteps = 20 - halfSteps
  const lowerIdx = reps - 1 + Math.floor(rirHalfSteps / 2)
  const lower = REP_MAX_PERCENTS[lowerIdx]
  if (lower === undefined) return null
  if (rirHalfSteps % 2 === 0) return lower
  const upper = REP_MAX_PERCENTS[lowerIdx + 1]
  if (upper === undefined) return null
  return (lower + upper) / 2
}

/** The program-set fields the engine reads — matches the `program_sets` row shape. */
export interface ProgramSetRowLike {
  setNumber: number
  setType: 'warmup' | 'working' | 'backoff' | 'amrap'
  metricMode: 'reps_weight' | 'duration' | 'duration_distance'
  repMin: number | null
  repMax: number | null
  rir: number | null
  rpe: number | null
  suggestedLoadKg: number | null
  tempo: string | null
  durationSec: number | null
  distanceM: number | null
  /** Prescribed rest AFTER this set, seconds (between-set; the technique
   *  JSONB's restSec is intra-set and never flows through here). */
  restSec: number | null
  technique: Technique | null
}

/** History inputs the CALLER computes (the engine does no IO): e1RM via
 *  `bestSet`/`estimate1RM`, lastSets from `getLastPerformance`. */
export interface ExerciseHistoryInput {
  e1rmKg: number | null
  lastSets: { reps: number | null; weightKg: number | null }[] | null
}

/** A week-N prescription for one set. `loadKg` replaces `suggestedLoadKg`. */
export interface DerivedSet {
  setNumber: number
  setType: ProgramSetRowLike['setType']
  metricMode: ProgramSetRowLike['metricMode']
  repMin: number | null
  repMax: number | null
  rir: number | null
  rpe: number | null
  loadKg: number | null
  tempo: string | null
  durationSec: number | null
  distanceM: number | null
  /** Rest after this set, seconds — template passthrough. No scheme or deload
   *  modifier touches it: rest isn't load-periodized here; only a per-week
   *  override can change a week's rest. */
  restSec: number | null
  technique: Technique | null
  derivedFrom: 'template' | 'scheme' | 'deload' | 'override' | 'autoreg'
  /** The pre-autoreg scheme load, stamped only on autoreg-adjusted sets so
   *  surfaces can offer "use plan as written" (the unadjusted value). */
  schemeLoadKg?: number | null
  /** Index into the input `sets` array this row derives from — clones inherit
   *  their source's index. Callers use it to match per-set overrides after
   *  resizing/renumbering has broken the setNumber correspondence. */
  sourceIndex: number
}

/** The target columns of a `program_set_overrides` row (null = not overridden). */
export interface SetOverrideLike {
  repMin: number | null
  repMax: number | null
  rir: number | null
  rpe: number | null
  suggestedLoadKg: number | null
  tempo: string | null
  durationSec: number | null
  distanceM: number | null
  restSec: number | null
  technique: Technique | null
}

/**
 * Merges a per-week override onto a derived set: every NON-NULL override field
 * wins (over the scheme AND the deload modifier — the top of the precedence
 * chain). A missing or all-null override leaves the set untouched. Pure and
 * shared so instantiation and `preview_program_week` can never disagree.
 */
export function applyOverride(
  set: DerivedSet,
  override: SetOverrideLike | undefined | null,
): DerivedSet {
  if (!override) return set
  const overridden: Partial<DerivedSet> = {}
  if (override.repMin !== null) overridden.repMin = override.repMin
  if (override.repMax !== null) overridden.repMax = override.repMax
  if (override.rir !== null) overridden.rir = override.rir
  if (override.rpe !== null) overridden.rpe = override.rpe
  // Metric-mode guard (cardio v1): a load override is meaningless on a timed
  // row — the derivation guard keeps loadKg null there, and a stray/legacy
  // per-week suggestedLoadKg must not resurrect a load onto a duration set.
  // Every other override field still applies.
  if (override.suggestedLoadKg !== null && set.metricMode === 'reps_weight')
    overridden.loadKg = override.suggestedLoadKg
  if (override.tempo !== null) overridden.tempo = override.tempo
  if (override.durationSec !== null) overridden.durationSec = override.durationSec
  if (override.distanceM !== null) overridden.distanceM = override.distanceM
  if (override.restSec !== null) overridden.restSec = override.restSec
  if (override.technique !== null) overridden.technique = override.technique
  if (Object.keys(overridden).length === 0) return set
  return { ...set, ...overridden, derivedFrom: 'override' }
}

/** Weeks 1..mesocycleWeeks with the deload week removed, in order. */
function nonDeloadWeeks(mesocycleWeeks: number, deloadWeek: number | null): number[] {
  const weeks: number[] = []
  for (let w = 1; w <= mesocycleWeeks; w++) {
    if (w !== deloadWeek) weeks.push(w)
  }
  return weeks
}

/** Never prescribe a negative load; keep null as "no prescription". */
function clampLoad(loadKg: number | null): number | null {
  if (loadKg === null) return null
  return Math.max(0, loadKg)
}

/** True for the set types progression schemes act on (warmups pass through). */
function isProgressed(setType: ProgramSetRowLike['setType']): boolean {
  return setType !== 'warmup'
}

/** True when the last logged performance hit `repMax` on every counted set. */
function hitTopOfRange(lastSets: ExerciseHistoryInput['lastSets'], repMax: number): boolean {
  if (!lastSets || lastSets.length === 0) return false
  const counted = lastSets.filter((s): s is { reps: number; weightKg: number | null } => s.reps !== null)
  if (counted.length === 0) return false
  return counted.every((s) => s.reps >= repMax)
}

/** The scheme's load for one set at the (clamped) week, or the base when the
 *  scheme doesn't apply. Also returns any rpe stamp (rpe-target). */
function schemeLoad(
  set: ProgramSetRowLike,
  progression: Progression,
  week: number,
  weeks: number[],
  history: ExerciseHistoryInput,
): { loadKg: number | null; rpe: number | null } {
  const base = set.suggestedLoadKg
  switch (progression.scheme) {
    case 'linear': {
      if (base === null) return { loadKg: null, rpe: set.rpe }
      const steps = weeks.filter((w) => w < week).length
      return { loadKg: base + progression.incrementKg * steps, rpe: set.rpe }
    }
    case 'double-progression': {
      if (base === null) return { loadKg: null, rpe: set.rpe }
      const advance = hitTopOfRange(history.lastSets, progression.repMax)
      return { loadKg: advance ? base + progression.incrementKg : base, rpe: set.rpe }
    }
    case 'percent-1rm': {
      const idx = Math.min(week, progression.weekPercents.length) - 1
      return { loadKg: progression.trainingMaxKg * progression.weekPercents[idx], rpe: set.rpe }
    }
    case 'rpe-target': {
      const reps = set.repMax ?? set.repMin ?? MAX_RELIABLE_REPS
      const percent = percentOf1RM(reps, progression.targetRpe)
      const loadKg = history.e1rmKg !== null && percent !== null ? history.e1rmKg * percent : null
      return { loadKg, rpe: progression.targetRpe }
    }
    case 'weekly-volume':
      // Volume changes set COUNT (handled by the caller), not loads.
      return { loadKg: base, rpe: set.rpe }
    case 'rep-progression':
      // Rep progression changes TARGETS (handled by the caller), not loads.
      return { loadKg: base, rpe: set.rpe }
    case 'amrap-cycle':
      // Wave cycling derives per-set loads (handled by the caller).
      return { loadKg: base, rpe: set.rpe }
  }
}

/** Completed amrap-cycle waves BEFORE `week`, on the non-deload week axis —
 *  the wave-boundary count instantiation banks a TM bump against (and the
 *  same arithmetic `amrapCycleTargets` cycles on, so the two can't drift). */
export function amrapCompletedWaves(
  week: number,
  mesocycleWeeks: number,
  deloadWeek: number | null,
  waveLength: number,
): number {
  if (waveLength < 1) return 0
  const clamped = Math.min(Math.max(1, week), Math.max(1, mesocycleWeeks))
  const weeks = nonDeloadWeeks(Math.max(1, mesocycleWeeks), deloadWeek)
  const steps = weeks.filter((w) => w < clamped).length
  return Math.floor(steps / waveLength)
}

/**
 * The completed-wave count the wave-boundary TM PERSIST may bank when
 * starting `week` — `amrapCompletedWaves` gated by `tmBumpTiming`: starting
 * the scheduled-deload week of an 'after-deload' config withholds the
 * just-finished wave (the deload derives off the OLD TM; the bump banks when
 * the first post-deload week starts). Instantiation and `deriveWeekSets`'s
 * wave math share this arithmetic so the persisted TM and the derive-time
 * virtual TM can never drift.
 */
export function amrapBankableWaves(
  week: number,
  mesocycleWeeks: number,
  deloadWeek: number | null,
  waveLength: number,
  options: {
    tmBumpTiming: 'before-deload' | 'after-deload' | undefined
    /** True only when the RESOLVED deload policy is 'scheduled' and `week`
     *  is the deload week — under 'none'/'reactive' the week is a normal
     *  training week and the bump lands on schedule. */
    isScheduledDeload: boolean
  },
): number {
  if (waveLength < 1) return 0
  const oldTm =
    options.isScheduledDeload && (options.tmBumpTiming ?? 'before-deload') === 'after-deload'
  if (!oldTm) return amrapCompletedWaves(week, mesocycleWeeks, deloadWeek, waveLength)
  const clamped = Math.min(Math.max(1, week), Math.max(1, mesocycleWeeks))
  const weeks = nonDeloadWeeks(Math.max(1, mesocycleWeeks), deloadWeek)
  const steps = weeks.filter((w) => w < clamped).length
  return Math.floor(Math.max(0, steps - 1) / waveLength)
}

/** True when the deload week must derive off the OLD training max: the
 *  scheduled-deload week of an 'after-deload' config (Wendler canon — the
 *  wave's bump becomes effective only from the first non-deload week after).
 *  Absent timing on a STORED row means the row predates the field and was
 *  migration-stamped 'before-deload'; the fallback keeps that legacy meaning
 *  for any row the migration could not have seen. */
function usesOldTmOnDeload(
  progression: Extract<Progression, { scheme: 'amrap-cycle' }>,
  isScheduledDeload: boolean,
): boolean {
  return isScheduledDeload && (progression.tmBumpTiming ?? 'before-deload') === 'after-deload'
}

/** Completed-wave count the TM math uses for a week that sits `steps`
 *  non-deload weeks into the block. `oldTm` (the 'after-deload' deload week)
 *  reads the count as of the LAST non-deload week before it — the just-
 *  finished wave's bump is withheld until the deload has passed. */
function tmWaves(steps: number, waveLength: number, oldTm: boolean): number {
  return Math.floor((oldTm ? Math.max(0, steps - 1) : steps) / waveLength)
}

/** The effective amrap-cycle training max at `steps`: stored TM + one
 *  increment per completed-but-unbanked wave (see `bankedWaves` in
 *  program-input.ts — max(0) so re-deriving an EARLIER week after a bank
 *  never subtracts). */
function amrapEffectiveTmKg(
  progression: Extract<Progression, { scheme: 'amrap-cycle' }>,
  steps: number,
  oldTm: boolean,
): number {
  const completedWaves = tmWaves(steps, progression.wave.length, oldTm)
  const unbankedWaves = Math.max(0, completedWaves - (progression.bankedWaves ?? 0))
  return progression.trainingMaxKg + progression.incrementKg * unbankedWaves
}

/** The amrap-cycle prescription for one progressed set: load = effective TM
 *  (base + one increment per completed wave NOT yet banked into the stored
 *  trainingMaxKg — see `bankedWaves` in program-input.ts) × this set's
 *  percent in the current wave row; reps come from the matching `waveReps`
 *  cell when the scheme prescribes them, else the template. Rows shorter
 *  than the day's set count clamp to their last entry. */
function amrapCycleTargets(
  set: ProgramSetRowLike,
  progressedIdx: number,
  progression: Extract<Progression, { scheme: 'amrap-cycle' }>,
  week: number,
  weeks: number[],
  isScheduledDeload: boolean,
): { repMin: number | null; repMax: number | null; loadKg: number | null } {
  const steps = weeks.filter((w) => w < week).length
  const waveIdx = steps % progression.wave.length
  const percents = progression.wave[waveIdx]
  const percent = percents[Math.min(progressedIdx, percents.length - 1)]
  const trainingMax = amrapEffectiveTmKg(
    progression,
    steps,
    usesOldTmOnDeload(progression, isScheduledDeload),
  )
  const reps = progression.waveReps?.[waveIdx]
  const rep = reps ? reps[Math.min(progressedIdx, reps.length - 1)] : null
  return {
    loadKg: trainingMax * percent,
    repMin: rep ?? set.repMin,
    repMax: rep !== null ? null : set.repMax,
  }
}

/** The rep-progression targets for one set: reps/duration bumped once per
 *  prior non-deload week, clamped to the optional caps. Null targets stay
 *  null — there is nothing to progress. */
function schemeTargets(
  set: ProgramSetRowLike,
  progression: Extract<Progression, { scheme: 'rep-progression' }>,
  week: number,
  weeks: number[],
): { repMin: number | null; repMax: number | null; durationSec: number | null } {
  const steps = weeks.filter((w) => w < week).length
  const bump = (value: number | null, increment: number, cap: number | null | undefined) => {
    if (value === null || increment <= 0) return value
    const raised = value + increment * steps
    // The cap halts the climb; it must never shrink a template target below
    // its starting value (a cap under the template would otherwise do so).
    return cap != null ? Math.min(raised, Math.max(cap, value)) : raised
  }
  return {
    repMin: bump(set.repMin, progression.incrementReps, progression.maxReps),
    repMax: bump(set.repMax, progression.incrementReps, progression.maxReps),
    durationSec: bump(set.durationSec, progression.incrementSec, progression.maxSec),
  }
}

/** The weekly-volume working-set count for the (clamped, non-deload) week. */
function volumeSetCount(
  progression: Extract<Progression, { scheme: 'weekly-volume' }>,
  week: number,
  weeks: number[],
): number {
  const idx = Math.max(0, weeks.indexOf(week))
  if (weeks.length <= 1) return progression.mevSets
  const span = progression.mrvSets - progression.mevSets
  return Math.round(progression.mevSets + (span * idx) / (weeks.length - 1))
}

/** Resizes the working-set portion of the list to `target`, cloning the last
 *  working set to grow and dropping working sets from the end to shrink.
 *  Non-working sets (warmup/backoff/amrap) are preserved in place. */
function resizeWorkingSets(sets: DerivedSet[], target: number): DerivedSet[] {
  const workingCount = sets.filter((s) => s.setType === 'working').length
  if (workingCount === 0 || target === workingCount) return sets
  if (target < workingCount) {
    let toDrop = workingCount - target
    const kept: DerivedSet[] = []
    for (let i = sets.length - 1; i >= 0; i--) {
      if (toDrop > 0 && sets[i].setType === 'working') {
        toDrop--
        continue
      }
      kept.unshift(sets[i])
    }
    return kept
  }
  const lastWorkingIdx = sets.map((s) => s.setType).lastIndexOf('working')
  const clones = Array.from({ length: target - workingCount }, () => ({
    ...sets[lastWorkingIdx],
  }))
  return [...sets.slice(0, lastWorkingIdx + 1), ...clones, ...sets.slice(lastWorkingIdx + 1)]
}

/**
 * Derives the week-N prescription for one exercise. Warmups pass through
 * untouched; working/backoff/amrap sets get scheme-derived loads; when the
 * RESOLVED deload policy is 'scheduled', the deload week then scales loads by
 * the shape's `loadFactor` and the working-set count by its `setFactor`
 * (ceil, min 1; the historical DELOAD_LOAD_FACTOR/DELOAD_SET_FACTOR are the
 * shape defaults), clamps derived RPE stamps to `rpeCap`, and — for an
 * amrap-cycle with a `deloadRow` — EMITS that row off the effective TM
 * instead of scale-shaping. Under 'none'/'reactive' the deload week derives
 * as a NORMAL week (no modifier, no 'deload' stamp) while `deloadWeek` still
 * shapes the week AXIS (progression steps skip it — geometry is not the
 * policy's to change). `deloadPolicy` omitted resolves the legacy regime
 * from `deloadWeek` (byte-for-byte the pre-policy behavior). Weeks beyond
 * the mesocycle clamp to the last week; `setNumber`s are renumbered 1-based
 * contiguous at the end. Per-week overrides are merged by the caller ON TOP
 * of this result.
 */
export function deriveWeekSets(args: {
  sets: ProgramSetRowLike[]
  progression: Progression | null
  week: number
  mesocycleWeeks: number
  deloadWeek: number | null
  history: ExerciseHistoryInput
  /** The READ-TIME resolved policy (resolveDeloadPolicy). Omitted = resolve
   *  the legacy regime from `deloadWeek` — the ONE code path either way. */
  deloadPolicy?: ResolvedDeloadPolicy
}): DerivedSet[] {
  const { sets, progression, mesocycleWeeks, deloadWeek, history } = args
  const week = Math.min(Math.max(1, args.week), Math.max(1, mesocycleWeeks))
  const weeks = nonDeloadWeeks(Math.max(1, mesocycleWeeks), deloadWeek)
  const policy = args.deloadPolicy ?? resolveDeloadPolicy(null, deloadWeek)
  // The MODIFIER gate: geometry (the week axis above) always honors
  // deloadWeek; whether that week gets the deload treatment is the policy's.
  const isDeload = deloadWeek !== null && week === deloadWeek && policy.mode === 'scheduled'

  // The 0-based index of each set among the progressed LIFTING sets —
  // amrap-cycle percents address reps_weight working/backoff/amrap sets in
  // order. Warmups AND timed rows are skipped: the metric-mode guard no-ops
  // the scheme on a timed set, so letting one consume a wave-percent slot
  // would shift the lifting rows onto the WRONG percents (75/85 instead of
  // 65/75) — a wrong prescription, not a no-op.
  let progressedCount = 0
  const progressedIdx = sets.map((s) =>
    isProgressed(s.setType) && s.metricMode === 'reps_weight' ? progressedCount++ : -1,
  )

  let derived: DerivedSet[] = sets.map((set, sourceIndex) => {
    // Metric-mode guard (cardio v1): load-anchored schemes are meaningless
    // on duration/duration_distance sets — every scheme except
    // rep-progression (which legitimately bumps seconds) no-ops on them, per
    // SET, so a mixed exercise still progresses its lifting rows. Enforced
    // here, at the derivation layer, so every consumer (instantiation,
    // previews, ghosts) inherits the guard. Inline (not a helper) so the
    // `applies` alias keeps narrowing `progression` below.
    const applies =
      progression !== null &&
      isProgressed(set.setType) &&
      (set.metricMode === 'reps_weight' || progression.scheme === 'rep-progression')
    const { loadKg: schemeLoadKg, rpe } = applies
      ? schemeLoad(set, progression, week, weeks, history)
      : { loadKg: set.suggestedLoadKg, rpe: set.rpe }
    // Rep progression bumps targets on non-deload weeks; the deload reverts to
    // template reps/duration (halved sets at inflated targets would fight the
    // deload's whole point). Amrap-cycle derives per-set loads AND reps from
    // its wave (the deload factor then applies on top like any scheme load).
    const cycle =
      applies && progression.scheme === 'amrap-cycle'
        ? amrapCycleTargets(set, progressedIdx[sourceIndex], progression, week, weeks, isDeload)
        : null
    const targets =
      applies && progression.scheme === 'rep-progression' && !isDeload
        ? schemeTargets(set, progression, week, weeks)
        : {
            repMin: cycle ? cycle.repMin : set.repMin,
            repMax: cycle ? cycle.repMax : set.repMax,
            durationSec: set.durationSec,
          }
    return {
      setNumber: set.setNumber,
      setType: set.setType,
      metricMode: set.metricMode,
      repMin: targets.repMin,
      repMax: targets.repMax,
      rir: set.rir,
      rpe,
      loadKg: clampLoad(cycle ? cycle.loadKg : schemeLoadKg),
      tempo: set.tempo,
      durationSec: targets.durationSec,
      distanceM: set.distanceM,
      restSec: set.restSec,
      technique: set.technique,
      derivedFrom: applies ? 'scheme' : 'template',
      sourceIndex,
    }
  })

  // weekly-volume adjusts the working-set count on non-deload weeks — but
  // never on an exercise carrying timed working sets (same guard as above,
  // lifted to the exercise level because resizing is a whole-list operation).
  const hasTimedProgressedSet = sets.some(
    (s) => isProgressed(s.setType) && s.metricMode !== 'reps_weight',
  )
  if (progression?.scheme === 'weekly-volume' && !isDeload && !hasTimedProgressedSet) {
    derived = resizeWorkingSets(derived, volumeSetCount(progression, week, weeks))
  }

  if (isDeload && policy.mode === 'scheduled') {
    const shape = policy.shape
    const deloadRow = progression?.scheme === 'amrap-cycle' ? progression.deloadRow : undefined
    const chassis = derived.filter((s) => isProgressed(s.setType))
    if (
      progression?.scheme === 'amrap-cycle' &&
      deloadRow &&
      chassis.length > 0 &&
      // The emit REPLACES the chassis with reps_weight rows — never over a
      // timed chassis (metric-mode guard); such exercises scale-shape instead.
      chassis.every((s) => s.metricMode === 'reps_weight')
    ) {
      // Wendler-canon deload row: EMIT percents × effective TM at `reps`,
      // replacing the scale-shape derivation. Warmups still pass through;
      // each emitted row borrows its chassis (rest/tempo/technique,
      // sourceIndex for override matching) from the progressed set at its
      // position, clamped to the last one.
      const steps = weeks.filter((w) => w < week).length
      const trainingMax = amrapEffectiveTmKg(
        progression,
        steps,
        usesOldTmOnDeload(progression, true),
      )
      const emitted = deloadRow.percents.map((percent, i) => {
        const base = chassis[Math.min(i, chassis.length - 1)]
        return {
          ...base,
          setType: 'working' as const,
          metricMode: 'reps_weight' as const,
          repMin: deloadRow.reps,
          repMax: null,
          rir: null,
          rpe: null,
          loadKg: clampLoad(trainingMax * percent),
          durationSec: null,
          distanceM: null,
          derivedFrom: 'deload' as const,
        }
      })
      derived = [...derived.filter((s) => !isProgressed(s.setType)), ...emitted]
    } else {
      const workingCount = derived.filter((s) => s.setType === 'working').length
      const target = Math.max(1, Math.ceil(workingCount * shape.setFactor))
      derived = resizeWorkingSets(derived, target).map((s) =>
        isProgressed(s.setType)
          ? {
              ...s,
              loadKg: clampLoad(s.loadKg === null ? null : s.loadKg * shape.loadFactor),
              // The cap clamps derived effort stamps only — a null RPE stays
              // an un-prescribed effort, never an invented one.
              rpe: shape.rpeCap !== null && s.rpe !== null ? Math.min(s.rpe, shape.rpeCap) : s.rpe,
              derivedFrom: 'deload' as const,
            }
          : s,
      )
    }
  }

  return derived.map((s, i) => ({ ...s, setNumber: i + 1 }))
}
