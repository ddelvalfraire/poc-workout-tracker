import { and, desc, eq, isNull } from 'drizzle-orm'
import type { DeloadPolicy, DietPhase, Progression } from '@/lib/program-input'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import {
  deriveWeekSets,
  applyOverride,
  amrapBankableWaves,
  isExplicitNoDeloadPolicy,
  resolveDeloadPolicy,
  type DerivedSet,
  type ExerciseHistoryInput,
  type ProgramSetRowLike,
  type SetOverrideLike,
} from '@/lib/progression'
import { setTrainingMax } from './program-patches'
import { rollingE1rm } from '@/lib/rolling-e1rm'
import { expandTechniqueStages } from '@/lib/technique'
import { quantizeAdjustedLoadKg, quantizeSetLoads } from '@/lib/load-quantize'
import type { WeightUnit } from '@/lib/units'
import { getWeightUnit } from './preferences'
import { applyEffortToAdjustment, sustainedUndershoot } from '@/lib/effort-gate'
import {
  autoregulate,
  autoregulateRange,
  autoregulateAnchor,
  autoregulateEarlyDeload,
  applyAutoregToSets,
  applyDietPhaseToAdjustment,
  stampAppliedLoad,
  AUTOREG_DEFAULT_STEP_KG,
  type AutoregAdjustment,
  type AutoregRangeRow,
  type AutoregSession,
  type AutoregStallPolicy,
} from '@/lib/autoregulate'
import { resolveOvershootPolicy, type OvershootPolicy } from '@/lib/overshoot-policy'
import { getRecentTrainedSessions } from './autoreg-history'
import { db } from './index'
import { ProposedProgramError } from './program-errors'
import type { ProgramEventActor } from './program-events'
import { getLastPerformance, getExerciseHistoryBefore } from './workouts'
import { catalogKey, getProgramDayDetail, nextProgramWeek } from './programs'
import { workouts, workoutExercises, sets } from './schema'

/**
 * The training engine's IO shell, extracted from `db/programs.ts`: the week-N
 * prescription derivation (`deriveDayPrescription`) and its author→log bridge
 * (`instantiateProgramDay`). Program CRUD and the sharing lifecycle stay in
 * `db/programs.ts`; this module owns only the read-history → derive → seed
 * pipeline. The authorization boundary is unchanged — every entry point here
 * either takes an ownership-checked slice (`DayForDerivation`) or does its own
 * userId-scoped read via `getProgramDayDetail`.
 *
 * THE LOAD-WRITERS MAP — every mechanism that can change a future load, and
 * where it acts. Two layers, different in kind.
 *
 * Derive-time composition (per call, enforced ONCE in deriveDayPrescription's
 * exercise loop; precedence as stated in lib/progression.ts):
 *   1. template row        — the authored base (program_sets).
 *   2. progression SCHEME  — deriveWeekSets' week-N math, deload modifier
 *                            included (override > deload > scheme > template
 *                            inside the pure engine).
 *   3. autoreg ADJUSTMENT  — Layer 1 verdicts between scheme and override:
 *                            fixed stall step/decrement, range rules,
 *                            performed-load anchors, the advisory early-deload
 *                            flag; the diet-phase gate and then the effort
 *                            gate may hold (annotate) a verdict but never add
 *                            a load change of their own. Applied via
 *                            applyAutoregToSets, then the anti-fixed-point
 *                            re-quantization (quantizeAdjustedSet).
 *   4. per-week OVERRIDE   — applyOverride LAST: the owner's explicit number
 *                            outranks every adjustment and is never rounded.
 *
 * Plan writers (mutate the STORED plan between derivations — they surface as
 * the next derivation's scheme inputs, never as a bypass of the order above):
 *   - TM banking at start  — instantiateProgramDay's wave-boundary persist
 *                            (setTrainingMax 'cycle-end', tmBumpTiming-gated)
 *                            and cloneProgram's block-restart carry-forward
 *                            ('block-restart', db/programs.ts).
 *   - plan-sync            — autoSyncPlanToPerformance silently adopts
 *                            performed loads into the plan after an
 *                            outperforming completed session
 *                            (programs.planSync gate, change-logged;
 *                            lib/auto-plan-sync.ts).
 *   - accepted proposals   — reactive-deload / effort-step
 *                            (db/reactive-deload.ts) and volume
 *                            (db/volume-progression.ts) create patch
 *                            PROPOSALS; loads change only at the owner's
 *                            confirm (db/patch-proposals.ts), never
 *                            auto-applied.
 *   - owner edits          — the program-patches setters (training max, set
 *                            rows, per-week overrides): the plain authoring
 *                            path every mechanism above is audited against.
 *
 * Prescriptions themselves are snapshotted facts: what a set was seeded with
 * (prescribed load / rep-min / rir / rpe) is stamped at instantiation and
 * never re-derived — the writers above change the FUTURE, never the record.
 */

/**
 * The engine-derived week-N prescription for every exercise of a loaded day,
 * in exercise order: history reads (batched all-time rows for e1RM; last
 * performance only for double-progression exercises), `deriveWeekSets`, then
 * per-set overrides merged on top (override > deload > scheme > template).
 * Shared by `instantiateProgramDay` and `preview_program_week` so what the
 * preview shows is exactly what instantiation seeds.
 */
/** The slice of a loaded day the prescription derivation needs — satisfied by
 *  both `getProgramDayDetail` (instantiation) and a `getProgramDetail` day
 *  paired with its program row (preview). */
export interface DayForDerivation {
  exercises: {
    wgerExerciseId: number
    source: ExerciseSource
    progression: Progression | null
    /** Per-exercise overshoot-policy override (program_exercises.overshoot_policy)
     *  — optional so hand-built slices stay valid; omitted/null = inherit. */
    overshootPolicy?: OvershootPolicy | null
    sets: (ProgramSetRowLike & { overrides: (SetOverrideLike & { week: number })[] })[]
  }[]
  program: {
    id: string
    mesocycleWeeks: number
    deloadWeek: number | null
    /** Program-level switch: false skips the stall rules (and their history
     *  reads) entirely — schemes derive exactly as before autoreg existed. */
    autoregulation: boolean
    /** Fixed-mode stall policy (programs.autoreg_stall_policy) — threaded
     *  into `autoregulate` and `autoregulateEarlyDeload`; range/anchor modes
     *  ignore it. Required so every caller reads the program row's policy. */
    autoregStallPolicy: AutoregStallPolicy
    /** Raw programs.deload_policy column (null = pre-policy program) —
     *  resolved ONCE per derivation via resolveDeloadPolicy. Required so
     *  every caller reads the program row's policy, like the stall policy. */
    deloadPolicy: DeloadPolicy | null
    /** Raw programs.diet_phase column (null = no phase — byte-identical
     *  derivation). Required so every caller reads the program row's phase,
     *  like the policies above; only 'cutting' has any effect, and only as
     *  a verdict ANNOTATION/hold (applyDietPhaseToAdjustment) — never a
     *  load change. */
    dietPhase: DietPhase | null
    /** Raw programs.overshoot_policy column (null = per-scheme default) —
     *  resolved per exercise via resolveOvershootPolicy (exercise override >
     *  program > scheme default). Required so every caller reads the program
     *  row's policy, like the policies above. */
    overshootPolicy: OvershootPolicy | null
  }
}

/** One exercise's week-N prescription plus its Layer 1 verdict (null = no
 *  adjustment). The adjustment is structured — surfaces format the reason
 *  line themselves via `autoregReason` in the user's display unit. */
export interface ExercisePrescription {
  sets: DerivedSet[]
  autoreg: AutoregAdjustment | null
  /** Sustained-undershoot signal (RPE plan slice 4): the ε-comparable top
   *  load two consecutive easy sessions worked, or null. Consumed by the
   *  effort-step proposal trigger — NEVER auto-applied. */
  effortStepLoadKg: number | null
}

/** Which Layer 1 rule set an exercise gets (see lib/autoregulate.ts's scope
 *  note): FIXED (v1 stall rules), RANGE (v2 double progression), ANCHOR
 *  (performed-load anchoring only, for schemes that can prescribe load-less
 *  sets), or DELOAD-FLAG (M4: advisory early-deload only, for schemes that
 *  own their loads). */
type AutoregPlan =
  | { mode: 'fixed'; incrementKg: number }
  | { mode: 'range'; stepKg: number; topForWorkingRow: (row: DerivedSet) => number | null }
  | { mode: 'anchor' }
  | { mode: 'deload-flag' }

/** True when a working template row carries a real rep range. A LINEAR
 *  exercise runs the range rules when ANY working set is ranged (H3): ranged
 *  rows are scored by fill/hold, fixed rows join floor scoring only — a
 *  mixed shape no longer collapses the whole exercise to v1 fixed rules.
 *
 *  SNAPSHOT NOTE (why there is no prescribed_rep_max column): the range top
 *  is the goal the lifter is climbing toward — a plan PARAMETER read at
 *  derive time, like the increment v1 already reads live — not a fact about
 *  what happened. The facts a verdict scores (prescribed loads, logged reps)
 *  stay snapshot-only; editing repMax today legitimately moves the goalposts
 *  for the NEXT verdict, exactly as editing incrementKg always has. */
function isRangedRow(row: { repMin: number | null; repMax: number | null }): boolean {
  return row.repMin !== null && row.repMax !== null && row.repMax > row.repMin
}

function autoregPlan(exercise: DayForDerivation['exercises'][number]): AutoregPlan | null {
  const progression = exercise.progression
  if (progression?.scheme === 'linear') {
    const workingRows = exercise.sets.filter((s) => s.setType === 'working')
    if (workingRows.length === 0 || !workingRows.some(isRangedRow)) {
      return { mode: 'fixed', incrementKg: progression.incrementKg }
    }
    return {
      mode: 'range',
      // A configured increment is reused as the step; a zero increment falls
      // back to the smallest sensible total-load step (WEIGHT_STEP's 2.5 kg).
      stepKg: progression.incrementKg > 0 ? progression.incrementKg : AUTOREG_DEFAULT_STEP_KG,
      // Per-row top from the DERIVED row itself — null marks a fixed row in a
      // mixed template (floor scoring only, H3).
      topForWorkingRow: (row) => (isRangedRow(row) ? row.repMax : null),
    }
  }
  if (progression?.scheme === 'double-progression') {
    if (!exercise.sets.some((s) => s.setType === 'working')) return null
    // The scheme's own exercise-level repMax IS the range top for every
    // working set — that is the contract its advancement already uses.
    return {
      mode: 'range',
      stepKg: progression.incrementKg > 0 ? progression.incrementKg : AUTOREG_DEFAULT_STEP_KG,
      topForWorkingRow: () => progression.repMax,
    }
  }
  // Schemes that can legitimately prescribe LOAD-LESS sets (rpe-target before
  // an e1RM exists; weekly-volume / rep-progression with a null base) get the
  // anchor-only rules: a completed working load on a null-load prescription
  // becomes the next prescription — the weight ghost those exercises never
  // had.
  if (
    progression?.scheme === 'rpe-target' ||
    progression?.scheme === 'weekly-volume' ||
    progression?.scheme === 'rep-progression'
  ) {
    return { mode: 'anchor' }
  }
  // percent-1rm / amrap-cycle own their loads (static training max / wave):
  // floor scoring drives the advisory early-deload flag ONLY (M4) — never a
  // load adjustment.
  if (progression?.scheme === 'percent-1rm' || progression?.scheme === 'amrap-cycle') {
    return { mode: 'deload-flag' }
  }
  return null
}

/** Quantizes a set touched by an INTENDED load change (step/decrement):
 *  autoreg-adjusted sets quantize against their pre-adjustment scheme load
 *  via `quantizeAdjustedLoadKg` (the anti-fixed-point rule); untouched sets
 *  quantize plainly. */
function quantizeAdjustedSet(set: DerivedSet, unit: WeightUnit): DerivedSet {
  if (set.derivedFrom !== 'autoreg' || set.loadKg == null || set.schemeLoadKg == null) {
    return quantizeSetLoads(set, unit)
  }
  const loadKg = quantizeAdjustedLoadKg(set.loadKg, set.schemeLoadKg, unit)
  // schemeLoadKg was quantized before the adjustment ran — idempotent here.
  return loadKg === set.loadKg ? set : { ...set, loadKg }
}

export async function deriveDayPrescription(
  userId: string,
  day: DayForDerivation,
  week: number,
  options?: {
    excludeWorkoutId?: string
    /** Quantization grid override (#226) — callers previewing in a non-stored
     *  unit (MCP `preview_program_week`'s `unit` arg) pass it so loads land
     *  on the grid the reader will actually see. Default: the stored unit. */
    unit?: WeightUnit
  },
): Promise<ExercisePrescription[]> {
  // The history query stays id-based (see getExerciseHistoryBefore); rows are
  // matched back onto the composite (source, id) below.
  const ids = [...new Set(day.exercises.map((e) => e.wgerExerciseId))]
  const historyRows = ids.length > 0 ? await getExerciseHistoryBefore(userId, ids, new Date()) : []

  // Suggested loads quantize to the display unit's loadable grid (#226) —
  // round-at-derivation, so ghosts, previews, and the prescribed snapshots
  // stamped at instantiation compare like with like. An explicit override
  // wins (unit-parameterized previews); otherwise the request-memoized read.
  const unit = options?.unit ?? (await getWeightUnit(userId))

  const keys = [...new Set(day.exercises.map((e) => catalogKey(e.source, e.wgerExerciseId)))]
  const e1rmByKey = new Map<string, number | null>()
  for (const key of keys) {
    // weight_reps rows only: for BW-type rows `weight` is added/assisted
    // load, not total — feeding it to the estimator would deflate the e1RM
    // the prescription math anchors on. Program prescriptions are absolute
    // loads, so only absolute-load history is admissible.
    const rows = historyRows.filter(
      (r) => catalogKey(r.source, r.wgerExerciseId) === key && r.loggingType === 'weight_reps',
    )
    // ROLLING e1RM (RPE plan §3.3), replacing the all-time bestSet: the
    // windowed per-session-top average lets a bad stretch actually lower
    // next week's rpe-target load — best-ever was monotonic, so a stale PR
    // prescribed forever. Only the rpe-target scheme consumes e1rmKg.
    e1rmByKey.set(
      key,
      rollingE1rm(
        rows.map((r) => ({
          workoutId: r.workoutId,
          startedAtMs: r.startedAt.getTime(),
          reps: r.reps,
          weightKg: r.weight,
          rir: r.rir,
          setType: r.setType,
          completed: r.completed,
        })),
      ),
    )
  }

  // Only double-progression needs the LAST session's sets specifically.
  const lastSetsByKey = new Map<string, ExerciseHistoryInput['lastSets']>()
  for (const exercise of day.exercises) {
    const key = catalogKey(exercise.source, exercise.wgerExerciseId)
    if (exercise.progression?.scheme === 'double-progression' && !lastSetsByKey.has(key)) {
      const perf = await getLastPerformance(userId, exercise.source, exercise.wgerExerciseId)
      lastSetsByKey.set(key, perf?.sets.map((s) => ({ reps: s.reps, weightKg: s.weight })) ?? null)
    }
  }

  // The deload check mirrors deriveWeekSets' internal clamp so an out-of-range
  // caller week lands on the same verdict the derivation itself will use.
  // Policy-gated like the engine's modifier: under 'none'/'reactive' the
  // deload week is a NORMAL training week, so autoreg runs on it as usual.
  const deloadPolicy = resolveDeloadPolicy(day.program.deloadPolicy, day.program.deloadWeek)
  const clampedWeek = Math.min(Math.max(1, week), Math.max(1, day.program.mesocycleWeeks))
  const isDeloadWeek =
    day.program.deloadWeek !== null &&
    clampedWeek === day.program.deloadWeek &&
    deloadPolicy.mode === 'scheduled'

  const results: ExercisePrescription[] = []
  // Autoreg verdict cache: a day that repeats an exercise derives ONCE per
  // composite key (first slot) and reuses it — no re-query, and slot-1
  // actuals are never scored against a later slot's templates.
  const adjustmentByKey = new Map<string, AutoregAdjustment | null>()
  const effortStepByKey = new Map<string, number | null>()
  for (const exercise of day.exercises) {
    const key = catalogKey(exercise.source, exercise.wgerExerciseId)
    const history: ExerciseHistoryInput = {
      e1rmKg: e1rmByKey.get(key) ?? null,
      lastSets: lastSetsByKey.get(key) ?? null,
    }

    // The scheme derives FIRST: range mode reads today's scheme-derived
    // working rows (load + top) as its load-keyed plan parameters (C2 — no
    // positional keys survive between history and today's plan).
    // Quantized immediately so range-mode plan params (rangeRows) and the
    // final prescription share one grid.
    const scheme = deriveWeekSets({
      sets: exercise.sets,
      progression: exercise.progression,
      week,
      mesocycleWeeks: day.program.mesocycleWeeks,
      deloadWeek: day.program.deloadWeek,
      history,
      deloadPolicy,
    }).map((s) => quantizeSetLoads(s, unit))

    // Layer 1 auto-regulation (program-gated; fixed-rep linear gets the v1
    // stall rules, ranged/mixed linear + double-progression the v2 double-
    // progression rules, load-less-capable schemes the anchor-only rules,
    // percent-1rm/amrap-cycle the advisory early-deload flag (M4); never on
    // the deload week — its whole point is the planned back-off).
    const rawPlan = day.program.autoregulation ? autoregPlan(exercise) : null
    // M4 gating: an EXPLICIT policy of 'none' says "this program does not
    // deload" — suppressing the advisory early-deload flag with it.
    // 'reactive' and 'scheduled' keep the suggestion (reactive IS the flag's
    // whole point), and so does the LEGACY resolution to 'none' (a
    // pre-policy program never asked for silence — byte-identity).
    const plan =
      rawPlan?.mode === 'deload-flag' && isExplicitNoDeloadPolicy(day.program.deloadPolicy)
        ? null
        : rawPlan
    let adjustment: AutoregAdjustment | null = null
    if (plan !== null && !isDeloadWeek) {
      if (adjustmentByKey.has(key)) {
        adjustment = adjustmentByKey.get(key) ?? null
      } else {
        const trained = await getRecentTrainedSessions(
          userId,
          day.program.id,
          exercise.source,
          exercise.wgerExerciseId,
          {
            excludeWorkoutId: options?.excludeWorkoutId,
            deloadWeek: day.program.deloadWeek,
          },
        )
        // Prescribed targets come from the per-set snapshots stamped at
        // instantiation (prescribed_load_kg/prescribed_rep_min) — immutable
        // facts, never a re-derivation of today's (editable) plan. Rows
        // without snapshots (all pre-snapshot history, ad-hoc adds) carry
        // nulls and are unscorable: the engine stays silent until enough
        // post-snapshot sessions accrue — the cold start is by design.
        // `startedAtMs` carries the ordering contract (H6): the engine
        // re-sorts defensively instead of trusting array order.
        const sessions: AutoregSession[] = trained.map((s) => ({
          startedAtMs: s.startedAt.getTime(),
          prescribed: s.sets.map((r) => ({
            setNumber: r.setNumber,
            repMin: r.prescribedRepMin,
            loadKg: r.prescribedLoadKg,
            setType: r.setType,
            rir: r.prescribedRir,
            rpe: r.prescribedRpe,
          })),
          actual: s.sets.map((r) => ({
            setNumber: r.setNumber,
            reps: r.reps,
            weightKg: r.weightKg,
            completed: r.completed,
            setType: r.setType,
            rir: r.rir,
            rpe: r.rpe,
          })),
        }))
        const rangeRows: AutoregRangeRow[] =
          plan.mode === 'range'
            ? scheme
                .filter((s) => s.setType === 'working')
                .map((s) => ({ loadKg: s.loadKg, repMax: plan.topForWorkingRow(s) }))
            : []
        // The unit rides into the engine so evidence matching can bridge
        // pre-quantization snapshots onto today's quantized grid (#226).
        // Overshoot policy (#227): exercise override > program > per-scheme
        // default, resolved ONCE per exercise. Crediting happens inside the
        // engine against the SNAPSHOTTED prescriptions — anchor mode carries
        // no goal scoring, so the policy has nothing to credit there.
        const overshootPolicy = resolveOvershootPolicy(
          day.program.overshootPolicy,
          exercise.overshootPolicy ?? null,
          exercise.progression?.scheme ?? null,
        )
        adjustment =
          plan.mode === 'fixed'
            ? autoregulate(
                plan.incrementKg,
                sessions,
                day.program.autoregStallPolicy,
                unit,
                overshootPolicy,
              )
            : plan.mode === 'range'
              ? autoregulateRange(plan.stepKg, sessions, rangeRows, unit, overshootPolicy)
              : plan.mode === 'anchor'
                ? autoregulateAnchor(sessions, unit)
                : autoregulateEarlyDeload(
                    sessions,
                    day.program.autoregStallPolicy,
                    overshootPolicy,
                  )
        // Diet-phase gate (Part A): verdict math above is phase-blind; only
        // now does a 'cutting' program annotate the verdict (and hold an H2
        // auto-backoff behind a confirmable proposal). A null phase returns
        // the identical object — byte-identity for phase-less programs.
        adjustment = applyDietPhaseToAdjustment(adjustment, day.program.dietPhase)
        // Effort gate (RPE plan slice 3), strictly AFTER the diet gate — a
        // cutting hold is never reopened. `===` passthrough without effort
        // logs keeps non-RPE lifters byte-identical.
        adjustment = applyEffortToAdjustment(adjustment, sessions, plan.mode)
        adjustmentByKey.set(key, adjustment)
        // Sustained-undershoot detection (slice 4) — fixed/range only, the
        // same restriction as the gate: self-correcting schemes step
        // through their own math, not through proposals.
        if (plan.mode === 'fixed' || plan.mode === 'range') {
          effortStepByKey.set(key, sustainedUndershoot(sessions, unit)?.loadKg ?? null)
        }
      }
    }

    // Precedence: scheme → autoreg (BEFORE overrides) → override on top, so
    // an explicit per-week override always outranks the adjustment.
    // Re-quantized after autoreg: a step adds a raw kg increment that can
    // land off-grid in lb. INTENDED changes (step/decrement) quantize against
    // their pre-adjustment baseline so a light-load backoff can never round
    // back to the load it claims to change (the 5 lb fixed point) — repeats
    // and anchors re-prescribe the same number by design and quantize
    // plainly. Overrides apply AFTER — an explicit per-week override is the
    // owner's number and is never rounded.
    const adjusted = adjustment
      ? applyAutoregToSets(scheme, adjustment, unit).map((s) =>
          adjustment.action === 'step' || adjustment.action === 'decrement'
            ? quantizeAdjustedSet(s, unit)
            : quantizeSetLoads(s, unit),
        )
      : scheme
    results.push({
      sets: adjusted.map((s) =>
        applyOverride(
          s,
          exercise.sets[s.sourceIndex]?.overrides.find((o) => o.week === week),
        ),
      ),
      // A decrement's reason must name the load the application actually
      // produced (#228 review): stamp the EVIDENCE bucket's applied working
      // load onto the verdict (lib/autoregulate.ts `stampAppliedLoad`) — per
      // exercise instance, never back into the shared cache.
      autoreg:
        adjustment !== null && adjustment.action === 'decrement'
          ? stampAppliedLoad(adjustment, adjusted, unit)
          : adjustment,
      effortStepLoadKg: effortStepByKey.get(key) ?? null,
    })
  }
  return results
}

/**
 * Instantiates a program day into a new dated workout for the user — the
 * author→log bridge. The workout is stamped with provenance (`programDayId`,
 * `programWeek`) and its sets are seeded from the ENGINE-DERIVED week-N
 * prescription (`deriveDayPrescription`), not the raw template: the derived
 * load goes into `weight` (only for `reps_weight` sets), while reps/duration/
 * distance are left blank for the user to log. Planned targets stay on the
 * program and are read back via the `get_workout` plan overlay.
 *
 * `week` omitted/null → auto-derived via `nextProgramWeek` (`weekDerived: true`
 * in the result). Returns null when the day isn't found or owned.
 * The day + history are read first, then the whole tree is seeded in one
 * transaction, mirroring `saveWorkout`.
 */
export async function instantiateProgramDay(
  userId: string,
  programDayId: string,
  week: number | null | undefined,
  // WHO triggered the start — threaded into the wave-boundary TM persist's
  // change-log event below, so a bump reads "You"/"Claude" like any edit.
  actor: ProgramEventActor,
): Promise<{ id: string; week: number; weekDerived: boolean; resumed: boolean } | null> {
  const day = await getProgramDayDetail(userId, programDayId)
  if (!day) return null

  // Forced-confirm guard: a 'proposed' program derives and instantiates
  // NOTHING — no code path may train a plan the owner hasn't adopted.
  if (day.program.status === 'proposed') throw new ProposedProgramError(day.program.id)

  // An explicit week must live on the block's axis: callers are the program
  // page's selected week and the MCP tool's argument, both caller-supplied
  // POST data. Without this backstop a forged week (999999) becomes permanent
  // provenance and poisons nextProgramWeek's max(programWeek) read.
  if (week != null && (week < 1 || week > Math.max(1, day.program.mesocycleWeeks))) {
    throw new Error(
      `week ${week} is out of range for a ${day.program.mesocycleWeeks}-week program`,
    )
  }

  const weekDerived = week == null
  const targetWeek = weekDerived
    ? await nextProgramWeek(userId, day.program.id, day.program.mesocycleWeeks)
    : week

  // One live instantiation per (day, week). A stale abandoned session (past
  // the banner TTL, so the conflict dialog no longer intercepts) would
  // otherwise let the hero re-offer the day and mint a duplicate row.
  // Provenance is a fact, not an editable opinion — resuming the existing
  // row keeps it exact; a fresh start is one explicit Discard away in the
  // logger. Freshest first in case historical duplicates already exist.
  const [existing] = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(
      and(
        eq(workouts.userId, userId),
        eq(workouts.programDayId, programDayId),
        eq(workouts.programWeek, targetWeek),
        isNull(workouts.completedAt),
      ),
    )
    .orderBy(desc(workouts.startedAt))
    .limit(1)
  // `resumed` is analytics provenance (workout_started's is_resumed bit) —
  // callers' behavior is unchanged by it.
  if (existing) return { id: existing.id, week: targetWeek, weekDerived, resumed: true }

  // Wave-boundary TM persist (TM lifecycle §1): starting a week whose
  // completed-wave count exceeds the banked count folds the earned
  // increment(s) into the stored trainingMaxKg via setTrainingMax
  // (reason 'cycle-end') — the classic Wendler bump becomes a visible
  // change-log fact instead of invisible derive-time arithmetic.
  // `bankedWaves` records how many waves the new TM absorbs, so derive's
  // wave math stops re-adding them; the stale in-memory `progression`
  // read below therefore prescribes IDENTICAL loads (old TM + n·inc ==
  // new TM + 0·inc) and no re-read is needed. Static waves
  // (incrementKg 0) never bank — a "TM 100 → 100" event would be noise.
  // tmBumpTiming gate: starting an 'after-deload' config's SCHEDULED deload
  // week must not bank the just-finished wave — the deload derives off the
  // OLD TM and the bump banks when the first post-deload week starts. Same
  // arithmetic as the engine's wave math (amrapBankableWaves), so the
  // persisted and virtual TMs can never drift.
  const startPolicy = resolveDeloadPolicy(day.program.deloadPolicy, day.program.deloadWeek)
  const startIsScheduledDeload =
    day.program.deloadWeek !== null &&
    targetWeek === day.program.deloadWeek &&
    startPolicy.mode === 'scheduled'
  for (const [position, exercise] of day.exercises.entries()) {
    const progression = exercise.progression
    if (progression?.scheme !== 'amrap-cycle' || progression.incrementKg <= 0) continue
    const completed = amrapBankableWaves(
      targetWeek,
      day.program.mesocycleWeeks,
      day.program.deloadWeek,
      progression.wave.length,
      { tmBumpTiming: progression.tmBumpTiming, isScheduledDeload: startIsScheduledDeload },
    )
    const banked = progression.bankedWaves ?? 0
    if (completed <= banked) continue
    await setTrainingMax(
      userId,
      day.program.id,
      day.position,
      position,
      progression.trainingMaxKg + progression.incrementKg * (completed - banked),
      'cycle-end',
      actor,
      { bankedWaves: completed },
    )
  }

  const prescription = await deriveDayPrescription(userId, day, targetWeek)

  // Read-then-seed: the ownership read is outside the transaction. In the narrow
  // window before the insert, a concurrent delete_program would make the workout
  // insert fail the program_day_id FK (surfacing as a generic error, not a clean
  // not-found). Accepted for this single-user POC; revisit with a tx-scoped read +
  // row lock if concurrent program editing becomes real.
  return db.transaction(async (tx) => {
    const [workout] = await tx
      .insert(workouts)
      .values({ userId, name: day.name, programDayId, programWeek: targetWeek })
      .returning({ id: workouts.id })

    for (const [position, exercise] of day.exercises.entries()) {
      const [we] = await tx
        .insert(workoutExercises)
        .values({
          workoutId: workout.id,
          wgerExerciseId: exercise.wgerExerciseId,
          // Identity is (source, id): a programmed custom must accrue history
          // under 'custom', not the column default.
          source: exercise.source,
          name: exercise.name,
          position,
        })
        .returning({ id: workoutExercises.id })

      // Technique expansion (lib/technique.ts, Model A): a prescribed
      // drop-set / rest-pause / myo-reps / cluster set becomes N grouped
      // ROWS — one per stage — so the lifter logs what actually happened
      // and every row-reading consumer stays correct. Technique-free
      // exercises pass through unchanged.
      const derived = expandTechniqueStages(prescription[position].sets)
      if (derived.length > 0) {
        await tx.insert(sets).values(
          derived.map((s) => ({
            workoutExerciseId: we.id,
            setNumber: s.setNumber,
            reps: null,
            // Derived load is a mutable starting suggestion; only reps_weight
            // sets carry a load. The achievement fields stay blank until logged.
            weight: s.metricMode === 'reps_weight' ? s.loadKg : null,
            // The prescription's set role travels with the row — a backoff or
            // amrap set must never masquerade as 'working' (the DB default)
            // to the auto-regulation stall rules.
            setType: s.setType,
            // Prescribed-at-instantiation snapshot: the immutable facts the
            // autoreg engine later scores actuals against. No edit path may
            // ever update these two columns.
            prescribedLoadKg: s.metricMode === 'reps_weight' ? s.loadKg : null,
            prescribedRepMin: s.repMin,
            // Effort targets snapshot under the same contract: the derived
            // rir/rpe (template through overrides) this set was seeded with.
            prescribedRir: s.rir,
            prescribedRpe: s.rpe,
            metricMode: s.metricMode,
            durationSec: null,
            distanceM: null,
            completed: false,
            // Technique grouping travels with the row; null on every
            // ordinary set (the columns' default reading).
            techniqueKind: s.techniqueStage?.kind ?? null,
            techniqueGroup: s.techniqueStage?.group ?? null,
            stageIndex: s.techniqueStage?.index ?? null,
          })),
        )
      }
    }

    return { id: workout.id, week: targetWeek, weekDerived, resumed: false }
  })
}
