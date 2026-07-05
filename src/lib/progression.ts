import type { Progression, Technique } from './program-input'
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
  technique: Technique | null
  derivedFrom: 'template' | 'scheme' | 'deload' | 'override'
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
  if (override.suggestedLoadKg !== null) overridden.loadKg = override.suggestedLoadKg
  if (override.tempo !== null) overridden.tempo = override.tempo
  if (override.durationSec !== null) overridden.durationSec = override.durationSec
  if (override.distanceM !== null) overridden.distanceM = override.distanceM
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
    return cap != null ? Math.min(raised, cap) : raised
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
 * untouched; working/backoff/amrap sets get scheme-derived loads; the deload
 * week then scales loads by `DELOAD_LOAD_FACTOR` and the working-set count by
 * `DELOAD_SET_FACTOR` (ceil, min 1). Weeks beyond the mesocycle clamp to the
 * last week; `setNumber`s are renumbered 1-based contiguous at the end.
 * Per-week overrides are merged by the caller ON TOP of this result.
 */
export function deriveWeekSets(args: {
  sets: ProgramSetRowLike[]
  progression: Progression | null
  week: number
  mesocycleWeeks: number
  deloadWeek: number | null
  history: ExerciseHistoryInput
}): DerivedSet[] {
  const { sets, progression, mesocycleWeeks, deloadWeek, history } = args
  const week = Math.min(Math.max(1, args.week), Math.max(1, mesocycleWeeks))
  const weeks = nonDeloadWeeks(Math.max(1, mesocycleWeeks), deloadWeek)
  const isDeload = deloadWeek !== null && week === deloadWeek

  let derived: DerivedSet[] = sets.map((set, sourceIndex) => {
    const applies = progression !== null && isProgressed(set.setType)
    const { loadKg, rpe } = applies
      ? schemeLoad(set, progression, week, weeks, history)
      : { loadKg: set.suggestedLoadKg, rpe: set.rpe }
    // Rep progression bumps targets on non-deload weeks; the deload reverts to
    // template reps/duration (halved sets at inflated targets would fight the
    // deload's whole point).
    const targets =
      applies && progression.scheme === 'rep-progression' && !isDeload
        ? schemeTargets(set, progression, week, weeks)
        : { repMin: set.repMin, repMax: set.repMax, durationSec: set.durationSec }
    return {
      setNumber: set.setNumber,
      setType: set.setType,
      metricMode: set.metricMode,
      repMin: targets.repMin,
      repMax: targets.repMax,
      rir: set.rir,
      rpe,
      loadKg: clampLoad(loadKg),
      tempo: set.tempo,
      durationSec: targets.durationSec,
      distanceM: set.distanceM,
      technique: set.technique,
      derivedFrom: applies ? 'scheme' : 'template',
      sourceIndex,
    }
  })

  // weekly-volume adjusts the working-set count on non-deload weeks.
  if (progression?.scheme === 'weekly-volume' && !isDeload) {
    derived = resizeWorkingSets(derived, volumeSetCount(progression, week, weeks))
  }

  if (isDeload) {
    const workingCount = derived.filter((s) => s.setType === 'working').length
    const target = Math.max(1, Math.ceil(workingCount * DELOAD_SET_FACTOR))
    derived = resizeWorkingSets(derived, target).map((s) =>
      isProgressed(s.setType)
        ? {
            ...s,
            loadKg: clampLoad(s.loadKg === null ? null : s.loadKg * DELOAD_LOAD_FACTOR),
            derivedFrom: 'deload' as const,
          }
        : s,
    )
  }

  return derived.map((s, i) => ({ ...s, setNumber: i + 1 }))
}
