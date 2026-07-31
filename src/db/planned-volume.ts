import { and, desc, eq } from 'drizzle-orm'
import { MUSCLE_GROUPS } from '@/lib/muscle-groups'
import { db } from './index'
import { creditSetMuscles, type VolumeGroup } from './muscle-volume'
import {
  programs,
  programDays,
  programExercises,
  programExerciseMuscles,
  programSets,
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
 */

/** One planned-set row from the active program. */
export interface PlannedSetRow {
  programExerciseId: string
  setType: string
  metricMode: string
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
  /** Raw counted planned sets (integers, uncredited). */
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
    totalSets += 1
    const credits = creditSetMuscles(musclesByExercise.get(row.programExerciseId) ?? null)
    for (const [group, credit] of credits) {
      totals.set(group, (totals.get(group) ?? 0) + credit)
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
    .select({ id: programs.id, name: programs.name })
    .from(programs)
    .where(and(eq(programs.userId, userId), eq(programs.status, 'active')))
    .orderBy(desc(programs.updatedAt))
    .limit(1)
  if (!program) return null

  const [setRows, muscleRows] = await Promise.all([
    db
      .select({
        programExerciseId: programSets.programExerciseId,
        setType: programSets.setType,
        metricMode: programSets.metricMode,
      })
      .from(programSets)
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
  ])

  return {
    programId: program.id,
    programName: program.name,
    ...aggregatePlannedVolume(setRows, muscleRows),
  }
}
