import { and, asc, count, eq } from 'drizzle-orm'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { bestSet, type BestSet } from '@/lib/one-rep-max'
import { db } from './index'
import { nextProgramWeek } from './programs'
import { programs, programDays, workouts, workoutExercises, sets } from './schema'

/**
 * Read-only aggregates for ONE program's workout history, always scoped to a
 * Clerk userId.
 *
 * Like `db/workouts.ts`, this module sits on the authorization boundary: the
 * app has no Postgres row-level security, so the program read gates ownership
 * and the flat-rows query filters by `user_id` again. Callers (Stats tab, MCP
 * tool) must go through `getProgramStats` rather than joining these tables
 * directly.
 *
 * Provenance is the whole feature: workouts instantiated from a program day
 * carry `programDayId` + `programWeek`, and aggregating by program yields
 * self-consistent numbers (one program = one gym = one set of machines).
 * Ad-hoc workouts (null `programDayId`) are excluded by construction. All
 * weights stay canonical kg — display converts, this module never does.
 */

export type { BestSet } from '@/lib/one-rep-max'

/** One week's adherence and volume within the block. */
export interface ProgramWeekStats {
  week: number
  /** Distinct program days with a workout STARTED this week (started counts;
   *  the completed subset is surfaced separately, not silently excluded). */
  daysStarted: number
  /** Subset of daysStarted whose workout has completedAt set — UI flags the gap. */
  daysCompleted: number
  /** Planned days = current count of the program's days. Editing days
   *  mid-block shifts history's denominator retroactively — accepted POC drift. */
  plannedDays: number
  /** Sets with completed = true this week (all metric modes — sets always count). */
  completedSets: number
  /** Σ reps × weight over completed reps_weight sets with BOTH reps and weight
   *  non-null (tonnage skips null-weight sets — maxed stack machines). */
  tonnageKg: number
}

/** One exercise's showing in one week. */
export interface ExerciseWeekPoint {
  week: number
  /** Highest-e1RM completed set this week (null = nothing loggable that week). */
  best: BestSet | null
  completedSets: number
}

/** An exercise's week-by-week trend within the block. */
export interface ProgramExerciseProgression {
  /** Exercise identity is the composite (source, id) — schema.ts on
   *  workout_exercises: a custom exercise's identity id can equal a wger id. */
  wgerExerciseId: number
  source: ExerciseSource
  /** Denormalized name from workout_exercises — latest occurrence wins. */
  name: string
  /** Sparse: only weeks the exercise appeared in, ascending. */
  weeks: ExerciseWeekPoint[]
}

export interface ProgramStats {
  program: {
    id: string
    name: string
    status: string
    mesocycleWeeks: number
    deloadWeek: number | null
  }
  /** Via nextProgramWeek() — the Stats view and the Start-day button always
   *  agree on the week. */
  currentWeek: number
  /** Index 0 = week 1. Length = max(mesocycleWeeks, highest observed week) so
   *  a manually-overshot week still shows rather than silently dropping. */
  weeks: ProgramWeekStats[]
  /** Ordered by first appearance (lowest week first, input order within). */
  exercises: ProgramExerciseProgression[]
}

/** The flat query shape — one row per set, or per workout when the left joins
 *  find no exercises/sets. */
export interface ProgramStatsRow {
  workoutId: string
  programDayId: string
  programWeek: number | null
  completedAt: Date | null
  wgerExerciseId: number | null
  source: ExerciseSource | null
  exerciseName: string | null
  reps: number | null
  weight: number | null // kg
  completed: boolean | null
  metricMode: string | null
}

/**
 * Pure aggregation over the flat rows — exported for tests. Builds fresh
 * structures throughout; never mutates its inputs.
 */
export function aggregateProgramStats(
  program: ProgramStats['program'],
  plannedDays: number,
  currentWeek: number,
  rows: readonly ProgramStatsRow[],
): ProgramStats {
  // Defensive guard: instantiation always stamps programWeek alongside
  // programDayId, but the columns are independently nullable — a null-week
  // row has no home on the weeks axis, so it is skipped rather than guessed.
  const valid = rows.filter(
    (row): row is ProgramStatsRow & { programWeek: number } => row.programWeek !== null,
  )

  const maxObservedWeek = valid.reduce((maxWeek, row) => Math.max(maxWeek, row.programWeek), 0)
  const weekCount = Math.max(program.mesocycleWeeks, maxObservedWeek)

  // Per-week accumulators. The flat rows fan a workout out across its set
  // rows, so adherence counts distinct ids, never rows.
  const startedDays = new Map<number, Set<string>>()
  const completedDays = new Map<number, Set<string>>()
  const setCounts = new Map<number, number>()
  const tonnage = new Map<number, number>()

  for (const row of valid) {
    const week = row.programWeek
    if (!startedDays.has(week)) startedDays.set(week, new Set())
    startedDays.get(week)!.add(row.programDayId)
    if (row.completedAt !== null) {
      if (!completedDays.has(week)) completedDays.set(week, new Set())
      completedDays.get(week)!.add(row.programDayId)
    }
    if (row.completed === true) {
      setCounts.set(week, (setCounts.get(week) ?? 0) + 1)
      if (row.metricMode === 'reps_weight' && row.reps !== null && row.weight !== null) {
        tonnage.set(week, (tonnage.get(week) ?? 0) + row.reps * row.weight)
      }
    }
  }

  const weeks: ProgramWeekStats[] = Array.from({ length: weekCount }, (_, i) => {
    const week = i + 1
    return {
      week,
      daysStarted: startedDays.get(week)?.size ?? 0,
      daysCompleted: completedDays.get(week)?.size ?? 0,
      plannedDays,
      completedSets: setCounts.get(week) ?? 0,
      tonnageKg: tonnage.get(week) ?? 0,
    }
  })

  return { program, currentWeek, weeks, exercises: aggregateExercises(valid) }
}

/** Groups exercise rows by id into sparse week-by-week progressions, ordered
 *  by first appearance (rows arrive in startedAt/position/setNumber order). */
function aggregateExercises(
  rows: readonly (ProgramStatsRow & { programWeek: number })[],
): ProgramExerciseProgression[] {
  interface ExerciseAcc {
    wgerExerciseId: number
    source: ExerciseSource
    name: string
    firstWeek: number
    firstIndex: number
    byWeek: Map<number, (ProgramStatsRow & { programWeek: number })[]>
  }
  // Keyed by the composite identity: a custom exercise's identity id can
  // collide with a wger id, and the two must never merge into one series.
  const byExercise = new Map<string, ExerciseAcc>()

  for (const [index, row] of rows.entries()) {
    if (row.wgerExerciseId === null) continue
    // source is non-null whenever the exercise columns are (same left-joined
    // row); the fallback only satisfies the type on a malformed row.
    const source = row.source ?? 'wger'
    const key = `${source}:${row.wgerExerciseId}`
    const existing = byExercise.get(key)
    const acc: ExerciseAcc = existing ?? {
      wgerExerciseId: row.wgerExerciseId,
      source,
      name: row.exerciseName ?? '',
      firstWeek: row.programWeek,
      firstIndex: index,
      byWeek: new Map(),
    }
    if (!existing) byExercise.set(key, acc)
    // Latest non-null denormalized name wins (renames mid-block converge).
    if (row.exerciseName !== null) acc.name = row.exerciseName
    // A later row can lower the first week (startedAt order doesn't guarantee
    // week order) — the index must move with it so in-week ties stay honest.
    if (row.programWeek < acc.firstWeek) {
      acc.firstWeek = row.programWeek
      acc.firstIndex = index
    }
    if (!acc.byWeek.has(row.programWeek)) acc.byWeek.set(row.programWeek, [])
    acc.byWeek.get(row.programWeek)!.push(row)
  }

  return [...byExercise.values()]
    .sort((a, b) => a.firstWeek - b.firstWeek || a.firstIndex - b.firstIndex)
    .map((acc) => ({
      wgerExerciseId: acc.wgerExerciseId,
      source: acc.source,
      name: acc.name,
      weeks: [...acc.byWeek.entries()]
        .sort(([a], [b]) => a - b)
        .map(([week, weekRows]) => {
          // Completed sets only: seeded-but-unlogged sets carry weight with
          // reps null, and a half-logged abandoned set must not score either.
          const completedRows = weekRows.filter((r) => r.completed === true)
          return {
            week,
            best: bestSet(completedRows),
            completedSets: completedRows.length,
          }
        }),
    }))
}

/**
 * Full stats for one program: adherence + volume per week and per-exercise
 * progression, or null when the program doesn't exist or isn't owned by the
 * user (callers translate — page → notFound(), MCP → error result).
 */
export async function getProgramStats(
  userId: string,
  programId: string,
): Promise<ProgramStats | null> {
  const [program] = await db
    .select({
      id: programs.id,
      name: programs.name,
      status: programs.status,
      mesocycleWeeks: programs.mesocycleWeeks,
      deloadWeek: programs.deloadWeek,
    })
    .from(programs)
    .where(and(eq(programs.id, programId), eq(programs.userId, userId)))
  if (!program) return null

  // Independent reads — one round-trip of latency instead of three.
  const [[dayCount], currentWeek, rows] = await Promise.all([
    db
      .select({ value: count(programDays.id) })
      .from(programDays)
      .where(eq(programDays.programId, programId)),
    nextProgramWeek(userId, programId, program.mesocycleWeeks),
    // The inner join through program_days is the provenance filter — and its
    // known blind spot: workouts orphaned by a day deletion or a full-replace
    // program edit (programDayId SET NULL) drop out of stats silently.
    // Accepted POC trade-off; denormalizing programId onto workouts is the
    // deferred fix. Left joins below keep a started-but-empty workout as one
    // row so it still counts toward adherence.
    db
      .select({
        workoutId: workouts.id,
        programDayId: workouts.programDayId,
        programWeek: workouts.programWeek,
        completedAt: workouts.completedAt,
        wgerExerciseId: workoutExercises.wgerExerciseId,
        source: workoutExercises.source,
        exerciseName: workoutExercises.name,
        reps: sets.reps,
        weight: sets.weight,
        completed: sets.completed,
        metricMode: sets.metricMode,
      })
      .from(workouts)
      .innerJoin(programDays, eq(programDays.id, workouts.programDayId))
      .leftJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id))
      .leftJoin(sets, eq(sets.workoutExerciseId, workoutExercises.id))
      .where(and(eq(programDays.programId, programId), eq(workouts.userId, userId)))
      // Deterministic input order: "first appearance" and bestSet tie-breaks
      // follow session time, then exercise position, then set number.
      .orderBy(asc(workouts.startedAt), asc(workoutExercises.position), asc(sets.setNumber)),
  ])

  // The inner join guarantees programDayId non-null; the type guard narrows
  // the SET-NULL column type without an unchecked cast (runtime no-op).
  const statsRows = rows.filter((r): r is (typeof rows)[number] & { programDayId: string } =>
    r.programDayId !== null,
  )
  return aggregateProgramStats(program, dayCount?.value ?? 0, currentWeek, statsRows)
}
