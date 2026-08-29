import { and, asc, desc, eq } from 'drizzle-orm'
import { MUSCLE_GROUPS } from '@/lib/exercises/muscle-groups'
import { db } from './index'
import { creditSetMuscles, type VolumeGroup } from './muscle-volume'
import { plannedTechniqueWeight } from '@/lib/workout/technique'
import {
  applyWeekOverrides,
  deriveWeekSets,
  resolveDeloadPolicy,
  type ProgramSetRowLike,
  type ResolvedDeloadPolicy,
  type SetOverrideLike,
} from '@/lib/programs/progression'
import { programWeekState } from './programs'
import type { Progression, Technique } from '@/lib/programs/program-input'
import {
  programs,
  programDays,
  programExercises,
  programExerciseMuscles,
  programSets,
  programSetOverrides,
} from './schema'

/**
 * Planned weekly volume — THE PROGRAM IS THE TARGET. Derived from the user's
 * active program: every planned set across ALL days (one full pass through
 * the rotation = the program's week, matching the app's trained-only week
 * model), credited per muscle via the denormalized program_exercise_muscles
 * rows — this module is that table's first reader. Credit discipline is
 * `creditSetMuscles` (db/muscle-volume.ts), shared with the performed side so
 * planned-vs-performed is apples-to-apples. Untagged exercises credit 'Other'
 * (tag rows are enrichment; honesty over silence).
 *
 * Set-type rule (the one place both sides reference): planned counts
 * reps_weight sets typed working/backoff/amrap and EXCLUDES 'warmup' — a
 * warm-up prescription is ramp-up, not training dose, so it must not inflate
 * the target. The performed side counts every COMPLETED reps_weight set with
 * no set_type filter (a completed warm-up is work that happened) — a known,
 * deliberate asymmetry that only ever flatters the lifter. Duration-mode
 * planned sets never count, mirroring the performed reps_weight rule.
 *
 * Planned is per program WEEK regardless of the /stats window mode: both the
 * rolling-7d and calendar windows compare against this same weekly figure
 * (the surface labels it "planned / week").
 *
 * THE TARGET IS THIS WEEK'S PRESCRIPTION, NOT THE STORED ROWS. `program_sets`
 * is the template, and three separate mechanisms change how many sets the
 * program actually prescribes in a given week: the deload policy's
 * `setFactor`, the weekly-volume ramp, and per-week overrides. Counting the
 * template ignored all three — most visibly on a deload week, where the
 * performed side halves and a target that never deloads manufactured a
 * shortfall the lifter did nothing to earn. So the count runs through the
 * SAME pure derivation instantiation uses (`deriveWeekSets` + `applyWeekOverrides`,
 * lib/progression.ts), at the program's current week: one code path, so the
 * target and the sets the lifter is actually handed can never disagree.
 *
 * Auto-regulation is deliberately NOT applied. It reads per-exercise history
 * (IO this aggregate has no business doing) and it adjusts a SESSION, not the
 * plan — a target that moved every time the engine backed a load off would
 * stop being a target. The plan plus its policies is what the lifter is
 * aiming at; autoreg is how a bad day is absorbed against it.
 */

/** One planned-set row AS DERIVED FOR THE COUNTED WEEK — the output of
 *  `deriveWeekSets` + `applyWeekOverrides`, not a raw `program_sets` row. Shape is
 *  unchanged from the stored row so the aggregation below is untouched. */
export interface PlannedSetRow {
  programExerciseId: string
  setType: string
  metricMode: string
  /** The technique tail, still nested here (the plan's grain — the derived
   *  rows are NOT stage-expanded; `plannedTechniqueWeight` does that
   *  arithmetically). Optional so pre-technique fixtures keep their shape. */
  technique?: Technique | null
}

/** A per-week override row, addressed to the week it applies to. */
type WeekOverride = SetOverrideLike & { week: number }

/** One stored plan set plus the overrides addressed at it. */
type PlannedSetPlan = ProgramSetRowLike & { overrides: readonly WeekOverride[] }

/** One exercise's stored plan, as the week derivation needs it. */
export interface PlannedExercisePlan {
  programExerciseId: string
  progression: Progression | null
  sets: readonly PlannedSetPlan[]
}

/** The program-level inputs the week derivation reads. */
export interface PlannedWeekContext {
  week: number
  mesocycleWeeks: number
  deloadWeek: number | null
  deloadPolicy: ResolvedDeloadPolicy
}

/**
 * The week's prescribed sets for every exercise — the ONE derivation, shared
 * with instantiation, so a deload week (or a ramp, or a per-week override)
 * changes the target exactly as much as it changes what the lifter is handed.
 * Pure and exported for tests. `history` is empty on purpose: it only feeds
 * LOAD derivation, and this aggregate counts sets.
 */
export function derivePlannedSetRows(
  plans: readonly PlannedExercisePlan[],
  context: PlannedWeekContext,
): PlannedSetRow[] {
  return plans.flatMap((plan) => {
    const derived = deriveWeekSets({
      sets: plan.sets.map((s) => ({ ...s })),
      progression: plan.progression,
      week: context.week,
      mesocycleWeeks: context.mesocycleWeeks,
      deloadWeek: context.deloadWeek,
      history: { e1rmKg: null, lastSets: null },
      deloadPolicy: context.deloadPolicy,
    })
    // Per-week overrides ride on top through the SAME shared merge
    // db/prescriptions.ts uses — matched by sourceIndex (a ramp resize has
    // already broken the setNumber correspondence), and carrying the rule
    // that a technique override lands on the last row of its source group.
    const merged = applyWeekOverrides(derived, (sourceIndex) =>
      plan.sets[sourceIndex]?.overrides.find((o) => o.week === context.week),
    )
    return merged.map((set) => ({
      programExerciseId: plan.programExerciseId,
      setType: set.setType,
      metricMode: set.metricMode,
      technique: set.technique,
    }))
  })
}

/** One muscle tag row (program_exercise_muscles). */
export interface PlannedMuscleRow {
  programExerciseId: string
  muscle: string
  role: string // 'primary' | 'secondary'
}

export interface PlannedGroupVolume {
  group: VolumeGroup
  /** Credited planned sets (primary 1.0 / secondary 0.5) — halves are real. */
  plannedSets: number
}

export interface PlannedVolume {
  programId: string
  programName: string
  /** All ten groups in display order; 'Other' appended only when planned. */
  groups: PlannedGroupVolume[]
  /** Counted planned sets, uncredited but hard-set weighted — fractional
   *  when the program prescribes technique work. */
  totalSets: number
}

/**
 * Pure aggregation — exported for tests. Builds fresh structures; never
 * mutates inputs.
 */
export function aggregatePlannedVolume(
  setRows: readonly PlannedSetRow[],
  muscleRows: readonly PlannedMuscleRow[],
): Pick<PlannedVolume, 'groups' | 'totalSets'> {
  const musclesByExercise = new Map<string, { primary: string[]; secondary: string[] }>()
  for (const row of muscleRows) {
    let entry = musclesByExercise.get(row.programExerciseId)
    if (!entry) {
      entry = { primary: [], secondary: [] }
      musclesByExercise.set(row.programExerciseId, entry)
    }
    if (row.role === 'primary') entry.primary.push(row.muscle)
    else entry.secondary.push(row.muscle)
  }

  const totals = new Map<VolumeGroup, number>()
  let totalSets = 0
  for (const row of setRows) {
    if (row.setType === 'warmup') continue // ramp-up, not dose (see module doc)
    if (row.metricMode !== 'reps_weight') continue
    // Hard-set weight, the same rule the performed side applies to the rows
    // this set will become (lib/technique.ts) — planned-vs-performed is only
    // honest if a prescribed rest-pause and a logged one count the same.
    const weight = plannedTechniqueWeight(row.technique)
    totalSets += weight
    const credits = creditSetMuscles(musclesByExercise.get(row.programExerciseId) ?? null)
    for (const [group, credit] of credits) {
      totals.set(group, (totals.get(group) ?? 0) + credit * weight)
    }
  }

  const groups: PlannedGroupVolume[] = MUSCLE_GROUPS.map((group) => ({
    group,
    plannedSets: totals.get(group) ?? 0,
  }))
  const other = totals.get('Other') ?? 0
  if (other > 0) groups.push({ group: 'Other', plannedSets: other })

  return { groups, totalSets }
}

/**
 * Planned weekly volume for the user's active program, or null when none —
 * ad-hoc-only users have no targets and their surfaces render unchanged.
 * "Active" mirrors getNextProgramDay (db/programs.ts): the most recently
 * updated program with status 'active'; 'proposed' rows structurally can't
 * qualify. Sits on the authorization boundary — the program query filters by
 * user_id, and the child queries are scoped to that program's id.
 */
export async function getPlannedWeeklyVolume(userId: string): Promise<PlannedVolume | null> {
  const [program] = await db
    .select({
      id: programs.id,
      name: programs.name,
      // The week axis + the policies that reshape a week's prescription.
      mesocycleWeeks: programs.mesocycleWeeks,
      deloadWeek: programs.deloadWeek,
      deloadPolicy: programs.deloadPolicy,
    })
    .from(programs)
    .where(and(eq(programs.userId, userId), eq(programs.status, 'active')))
    .orderBy(desc(programs.updatedAt))
    .limit(1)
  if (!program) return null

  const [planRows, overrideRows, muscleRows, weekState] = await Promise.all([
    db
      .select({
        programExerciseId: programSets.programExerciseId,
        progression: programExercises.progression,
        id: programSets.id,
        setNumber: programSets.setNumber,
        setType: programSets.setType,
        metricMode: programSets.metricMode,
        repMin: programSets.repMin,
        repMax: programSets.repMax,
        rir: programSets.rir,
        rpe: programSets.rpe,
        suggestedLoadKg: programSets.suggestedLoadKg,
        tempo: programSets.tempo,
        durationSec: programSets.durationSec,
        distanceM: programSets.distanceM,
        restSec: programSets.restSec,
        technique: programSets.technique,
      })
      .from(programSets)
      .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
      .innerJoin(programDays, eq(programDays.id, programExercises.programDayId))
      .where(eq(programDays.programId, program.id))
      // deriveWeekSets addresses sets by order (amrap-cycle percents, the
      // ramp's clone-the-last-working-set) — unordered rows would derive a
      // different week than instantiation does.
      .orderBy(asc(programSets.programExerciseId), asc(programSets.setNumber)),
    db
      .select({
        programSetId: programSetOverrides.programSetId,
        week: programSetOverrides.week,
        repMin: programSetOverrides.repMin,
        repMax: programSetOverrides.repMax,
        rir: programSetOverrides.rir,
        rpe: programSetOverrides.rpe,
        suggestedLoadKg: programSetOverrides.suggestedLoadKg,
        tempo: programSetOverrides.tempo,
        durationSec: programSetOverrides.durationSec,
        distanceM: programSetOverrides.distanceM,
        restSec: programSetOverrides.restSec,
        technique: programSetOverrides.technique,
      })
      .from(programSetOverrides)
      .innerJoin(programSets, eq(programSets.id, programSetOverrides.programSetId))
      .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
      .innerJoin(programDays, eq(programDays.id, programExercises.programDayId))
      .where(eq(programDays.programId, program.id)),
    db
      .select({
        programExerciseId: programExerciseMuscles.programExerciseId,
        muscle: programExerciseMuscles.muscle,
        role: programExerciseMuscles.role,
      })
      .from(programExerciseMuscles)
      .innerJoin(
        programExercises,
        eq(programExercises.id, programExerciseMuscles.programExerciseId),
      )
      .innerJoin(programDays, eq(programDays.id, programExercises.programDayId))
      .where(eq(programDays.programId, program.id)),
    programWeekState(userId, program.id, program.mesocycleWeeks),
  ])

  const overridesBySet = new Map<string, WeekOverride[]>()
  for (const row of overrideRows) {
    const list = overridesBySet.get(row.programSetId)
    if (list) list.push(row)
    else overridesBySet.set(row.programSetId, [row])
  }

  // Regrouped per exercise: the derivation is a whole-list operation (the ramp
  // resizes the working-set list, amrap-cycle percents address them in order),
  // so it can never run per row. Built as a mutable accumulator with its own
  // type, so the grouping needs no cast through the readonly public shape.
  const plans: { programExerciseId: string; progression: Progression | null; sets: PlannedSetPlan[] }[] = []
  for (const row of planRows) {
    let plan = plans.at(-1)
    if (plan?.programExerciseId !== row.programExerciseId) {
      plan = {
        programExerciseId: row.programExerciseId,
        // ?? null, not the raw value: the column is nullable and the
        // derivation branches on `progression === null` — an undefined from a
        // projection that never selected it would reach `progression.scheme`.
        progression: row.progression ?? null,
        sets: [],
      }
      plans.push(plan)
    }
    plan.sets.push({ ...row, overrides: overridesBySet.get(row.id) ?? [] })
  }

  const setRows = derivePlannedSetRows(plans, {
    week: weekState.currentWeek,
    mesocycleWeeks: program.mesocycleWeeks,
    deloadWeek: program.deloadWeek,
    // Read-time resolution, the same call the derive path makes: a null column
    // is a pre-policy program and must resolve to the legacy regime, not to
    // "no deload".
    deloadPolicy: resolveDeloadPolicy(program.deloadPolicy, program.deloadWeek),
  })

  return {
    programId: program.id,
    programName: program.name,
    ...aggregatePlannedVolume(setRows, muscleRows),
  }
}
