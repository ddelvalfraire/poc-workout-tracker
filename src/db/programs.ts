import { and, asc, count, countDistinct, desc, eq, isNotNull, isNull, max } from 'drizzle-orm'
import type { ProgramInput, Progression } from '@/lib/program-input'
import { getAllExercises, type Exercise } from '@/lib/wger'
import {
  deriveWeekSets,
  applyOverride,
  type DerivedSet,
  type ExerciseHistoryInput,
  type ProgramSetRowLike,
  type SetOverrideLike,
} from '@/lib/progression'
import { bestSet } from '@/lib/one-rep-max'
import { pickNextProgramDay } from '@/lib/next-program-day'
import { db } from './index'
import { getLastPerformance, getExerciseHistoryBefore } from './workouts'
import {
  programs,
  programDays,
  programExercises,
  programExerciseMuscles,
  programSets,
  workouts,
  workoutExercises,
  sets,
} from './schema'

/**
 * Data access for training programs, always scoped to a Clerk userId.
 *
 * Like `db/workouts.ts`, this module is the authorization boundary: the app has
 * no Postgres row-level security, so every query filters by `user_id` on the
 * `programs` root and the children inherit ownership through the FK chain
 * (programs → program_days → program_exercises → program_sets). Route/MCP
 * handlers must go through these helpers rather than touching `program_*`
 * tables directly, so a caller can never read or mutate another user's program.
 */

/** Lists a user's programs, most recently updated first. */
export function listPrograms(userId: string) {
  return db
    .select()
    .from(programs)
    .where(eq(programs.userId, userId))
    .orderBy(desc(programs.updatedAt))
}

/** Fetches a single program with its days/exercises (incl. muscle tags)/sets
 *  (incl. per-week overrides), only if owned by the user. */
export function getProgramDetail(userId: string, id: string) {
  return db.query.programs.findFirst({
    where: and(eq(programs.id, id), eq(programs.userId, userId)),
    with: {
      days: {
        orderBy: (d) => [asc(d.position)],
        with: {
          exercises: {
            orderBy: (e) => [asc(e.position)],
            with: {
              muscles: true,
              sets: { orderBy: (s) => [asc(s.setNumber)], with: { overrides: true } },
            },
          },
        },
      },
    },
  })
}

/** The full nested shape returned by getProgramDetail (program + days + exercises + sets). */
export type ProgramDetail = NonNullable<Awaited<ReturnType<typeof getProgramDetail>>>

/** The transaction handle, lifted from the callback signature (no internal import). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** The wger catalog keyed by exercise id; null = catalog unavailable. */
export type ExerciseCatalog = Map<number, Exercise>

/**
 * Fetches the (in-memory cached) wger catalog for author-time muscle tagging.
 * Never called inside a transaction, and failure-tolerant: muscle tags are
 * enrichment, not integrity, so a save without the catalog proceeds untagged.
 */
export async function loadExerciseCatalog(): Promise<ExerciseCatalog | null> {
  try {
    const all = await getAllExercises()
    return new Map(all.map((e) => [e.id, e]))
  } catch {
    return null
  }
}

/**
 * The `program_exercise_muscles` rows for one exercise slot, from the catalog.
 * Primary names win when wger lists a muscle on both sides (the unique is per
 * (exercise, muscle)); an unknown id or missing catalog yields no rows.
 */
export function muscleRowsFor(
  programExerciseId: string,
  wgerExerciseId: number,
  catalog: ExerciseCatalog | null,
): { programExerciseId: string; muscle: string; role: 'primary' | 'secondary' }[] {
  const entry = catalog?.get(wgerExerciseId)
  if (!entry) return []
  const primary = entry.muscles ?? []
  const secondary = (entry.musclesSecondary ?? []).filter((m) => !primary.includes(m))
  return [
    ...primary.map((muscle) => ({ programExerciseId, muscle, role: 'primary' as const })),
    ...secondary.map((muscle) => ({ programExerciseId, muscle, role: 'secondary' as const })),
  ]
}

/**
 * Inserts a program's days → exercises → sets (shared by saveProgram and
 * updateProgram). `position` is the 0-based order within its parent; `setNumber`
 * is 1-based within its exercise — mirroring `insertWorkoutChildren`. Each
 * exercise is muscle-tagged from the pre-fetched catalog (after its sets, so
 * the long-standing program→day→exercise→sets write order stays put).
 */
async function insertProgramChildren(
  tx: Tx,
  programId: string,
  days: ProgramInput['days'],
  catalog: ExerciseCatalog | null,
) {
  for (const [dayPosition, day] of days.entries()) {
    const [pd] = await tx
      .insert(programDays)
      .values({ programId, name: day.name, position: dayPosition, notes: day.notes ?? null })
      .returning({ id: programDays.id })

    for (const [exPosition, exercise] of day.exercises.entries()) {
      const [pe] = await tx
        .insert(programExercises)
        .values({
          programDayId: pd.id,
          wgerExerciseId: exercise.wgerExerciseId,
          name: exercise.name,
          position: exPosition,
          progression: exercise.progression ?? null,
        })
        .returning({ id: programExercises.id })

      if (exercise.sets.length > 0) {
        await tx.insert(programSets).values(
          exercise.sets.map((s, i) => ({
            programExerciseId: pe.id,
            setNumber: i + 1,
            setType: s.setType,
            metricMode: s.metricMode,
            repMin: s.repMin ?? null,
            repMax: s.repMax ?? null,
            rir: s.rir ?? null,
            rpe: s.rpe ?? null,
            suggestedLoadKg: s.suggestedLoadKg ?? null,
            tempo: s.tempo ?? null,
            durationSec: s.durationSec ?? null,
            distanceM: s.distanceM ?? null,
            restSec: s.restSec ?? null,
            technique: s.technique ?? null,
          })),
        )
      }

      const muscles = muscleRowsFor(pe.id, exercise.wgerExerciseId, catalog)
      if (muscles.length > 0) {
        await tx.insert(programExerciseMuscles).values(muscles)
      }
    }
  }
}

/**
 * Persists a full program — the `programs` row plus its nested days/exercises/
 * sets — for the given user, atomically. Everything runs inside one
 * `db.transaction`, so a partial save can never happen. The program is stamped
 * with `userId`; the children inherit ownership through the FK chain.
 */
export async function saveProgram(userId: string, input: ProgramInput): Promise<{ id: string }> {
  const catalog = await loadExerciseCatalog() // network read stays outside the tx
  return db.transaction(async (tx) => {
    const [program] = await tx
      .insert(programs)
      .values({
        userId,
        name: input.name,
        status: input.status,
        mesocycleWeeks: input.mesocycleWeeks,
        deloadWeek: input.deloadWeek ?? null,
        notes: input.notes ?? null,
      })
      .returning({ id: programs.id })

    await insertProgramChildren(tx, program.id, input.days, catalog)

    return { id: program.id }
  })
}

/**
 * Replaces a program's metadata + days/exercises/sets atomically, only if owned
 * by the user. The `update ... returning` doubles as the ownership gate: no row
 * back means the caller doesn't own it (or it's gone) and nothing is mutated.
 * Children are deleted (cascade removes their descendants) and re-inserted.
 */
export async function updateProgram(
  userId: string,
  id: string,
  input: ProgramInput,
): Promise<{ id: string } | null> {
  const catalog = await loadExerciseCatalog() // network read stays outside the tx
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .update(programs)
      .set({
        name: input.name,
        status: input.status,
        mesocycleWeeks: input.mesocycleWeeks,
        deloadWeek: input.deloadWeek ?? null,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(programs.id, id), eq(programs.userId, userId)))
      .returning({ id: programs.id })
    if (!owned) return null

    await tx.delete(programDays).where(eq(programDays.programId, id))
    await insertProgramChildren(tx, id, input.days, catalog)
    return { id }
  })
}

/** Deletes a program (and its children, via FK cascade) only if owned by the user. */
export function deleteProgram(userId: string, id: string) {
  return db
    .delete(programs)
    .where(and(eq(programs.id, id), eq(programs.userId, userId)))
    .returning({ id: programs.id })
}

/**
 * Updates only a program's lifecycle status, gated on ownership via the
 * `update ... returning`. Returns null when the user doesn't own the program.
 */
export async function setProgramStatus(
  userId: string,
  id: string,
  status: ProgramInput['status'],
): Promise<{ id: string } | null> {
  const [owned] = await db
    .update(programs)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(programs.id, id), eq(programs.userId, userId)))
    .returning({ id: programs.id })
  return owned ?? null
}

/**
 * Fetches a single program day with its exercises and sets, only if the parent
 * program is owned by the user. Ownership is gated through the day's program
 * (the `program: one(programs)` relation); a day whose program belongs to
 * someone else returns null. Used to instantiate a day into a workout and to
 * build the plan overlay on `get_workout`.
 */
export async function getProgramDayDetail(userId: string, programDayId: string) {
  const day = await db.query.programDays.findFirst({
    where: eq(programDays.id, programDayId),
    with: {
      program: {
        columns: { id: true, userId: true, mesocycleWeeks: true, deloadWeek: true },
      },
      exercises: {
        orderBy: (e) => [asc(e.position)],
        with: {
          sets: { orderBy: (s) => [asc(s.setNumber)], with: { overrides: true } },
        },
      },
    },
  })
  if (!day || day.program.userId !== userId) return null
  return day
}

/** The nested shape returned by getProgramDayDetail (day + exercises + sets). */
export type ProgramDayDetail = NonNullable<Awaited<ReturnType<typeof getProgramDayDetail>>>

/**
 * The week `instantiate_program_day` should default to, derived from the
 * program's own workout history (no stored counter to drift): the highest
 * `programWeek` already instantiated is the current week; once every day of
 * the program has a workout at that week, the cycle is complete and the next
 * week begins — clamped to `mesocycleWeeks` so a finished meso re-runs its
 * last week rather than extrapolating. No history → week 1.
 */
export async function nextProgramWeek(
  userId: string,
  programId: string,
  mesocycleWeeks: number,
): Promise<number> {
  const [agg] = await db
    .select({ current: max(workouts.programWeek) })
    .from(workouts)
    .innerJoin(programDays, eq(programDays.id, workouts.programDayId))
    .where(and(eq(programDays.programId, programId), eq(workouts.userId, userId)))
  const current = agg?.current ?? null
  if (current === null) return 1

  // Independent reads — one round-trip of latency instead of two.
  const [[dayTotal], [daysDone]] = await Promise.all([
    db
      .select({ value: count(programDays.id) })
      .from(programDays)
      .where(eq(programDays.programId, programId)),
    db
      .select({ value: countDistinct(workouts.programDayId) })
      .from(workouts)
      .innerJoin(programDays, eq(programDays.id, workouts.programDayId))
      .where(
        and(
          eq(programDays.programId, programId),
          eq(workouts.userId, userId),
          eq(workouts.programWeek, current),
          // COMPLETED days only: a started-but-unfinished (or later-
          // discarded) session must not advance the mesocycle week.
          isNotNull(workouts.completedAt),
        ),
      ),
  ])

  const cycleComplete = daysDone.value >= dayTotal.value
  return cycleComplete ? Math.min(current + 1, Math.max(1, mesocycleWeeks)) : current
}

/** What the home screen's "up next" card renders: the day a user should train
 *  next in their active program, plus enough context to preview it. */
export interface NextProgramDay {
  programId: string
  programName: string
  dayId: string
  dayName: string
  week: number
  exerciseNames: string[]
}

/**
 * The next day to train in the user's active program — the composition the
 * home screen widget needs, or null when there's nothing to suggest (no
 * active program, or an active program with no days).
 *
 * "Active" is the most recently updated program with status 'active' (nothing
 * enforces a single active program; recency is the tiebreak). The week comes
 * from `nextProgramWeek`; the day rotates forward from the last day trained at
 * that week, wrapping to make up skipped days (`pickNextProgramDay`).
 */
export async function getNextProgramDay(userId: string): Promise<NextProgramDay | null> {
  const [program] = await db
    .select({
      id: programs.id,
      name: programs.name,
      mesocycleWeeks: programs.mesocycleWeeks,
    })
    .from(programs)
    .where(and(eq(programs.userId, userId), eq(programs.status, 'active')))
    .orderBy(desc(programs.updatedAt))
    .limit(1)
  if (!program) return null

  // The day list and the current week don't depend on each other — fetch them
  // concurrently (this runs on every home-page load).
  const [days, week] = await Promise.all([
    db
      .select({ id: programDays.id, name: programDays.name, position: programDays.position })
      .from(programDays)
      .where(eq(programDays.programId, program.id))
      .orderBy(asc(programDays.position)),
    nextProgramWeek(userId, program.id, program.mesocycleWeeks),
  ])

  const logged = await db
    .selectDistinct({ dayId: workouts.programDayId })
    .from(workouts)
    .innerJoin(programDays, eq(programDays.id, workouts.programDayId))
    .where(
      and(
        eq(programDays.programId, program.id),
        eq(workouts.userId, userId),
        eq(workouts.programWeek, week),
        // COMPLETED days only. Merely STARTING a day used to consume it for
        // the week — an accidental start (or an in-progress session) rotated
        // the hero to the next day as if the work had been done.
        isNotNull(workouts.completedAt),
      ),
    )

  const next = pickNextProgramDay(
    days,
    new Set(logged.map((r) => r.dayId).filter((id): id is string => id !== null)),
  )
  if (!next) return null

  const exerciseRows = await db
    .select({ name: programExercises.name })
    .from(programExercises)
    .where(eq(programExercises.programDayId, next.id))
    .orderBy(asc(programExercises.position))

  return {
    programId: program.id,
    programName: program.name,
    dayId: next.id,
    dayName: next.name,
    week,
    exerciseNames: exerciseRows.map((r) => r.name),
  }
}

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
    progression: Progression | null
    sets: (ProgramSetRowLike & { overrides: (SetOverrideLike & { week: number })[] })[]
  }[]
  program: { mesocycleWeeks: number; deloadWeek: number | null }
}

export async function deriveDayPrescription(
  userId: string,
  day: DayForDerivation,
  week: number,
): Promise<DerivedSet[][]> {
  const ids = [...new Set(day.exercises.map((e) => e.wgerExerciseId))]
  const historyRows = ids.length > 0 ? await getExerciseHistoryBefore(userId, ids, new Date()) : []

  const e1rmById = new Map<number, number | null>()
  for (const id of ids) {
    // weight_reps rows only: for BW-type rows `weight` is added/assisted
    // load, not total — feeding it to bestSet would deflate the e1RM the
    // prescription math anchors on. Program prescriptions are absolute
    // loads, so only absolute-load history is admissible.
    const rows = historyRows.filter(
      (r) => r.wgerExerciseId === id && r.loggingType === 'weight_reps',
    )
    e1rmById.set(id, bestSet(rows)?.e1rm ?? null)
  }

  // Only double-progression needs the LAST session's sets specifically.
  const lastSetsById = new Map<number, ExerciseHistoryInput['lastSets']>()
  for (const exercise of day.exercises) {
    if (
      exercise.progression?.scheme === 'double-progression' &&
      !lastSetsById.has(exercise.wgerExerciseId)
    ) {
      const perf = await getLastPerformance(userId, exercise.wgerExerciseId)
      lastSetsById.set(
        exercise.wgerExerciseId,
        perf?.sets.map((s) => ({ reps: s.reps, weightKg: s.weight })) ?? null,
      )
    }
  }

  return day.exercises.map((exercise) => {
    const history: ExerciseHistoryInput = {
      e1rmKg: e1rmById.get(exercise.wgerExerciseId) ?? null,
      lastSets: lastSetsById.get(exercise.wgerExerciseId) ?? null,
    }
    const derived = deriveWeekSets({
      sets: exercise.sets,
      progression: exercise.progression,
      week,
      mesocycleWeeks: day.program.mesocycleWeeks,
      deloadWeek: day.program.deloadWeek,
      history,
    })
    // Overrides key on the TEMPLATE set (sourceIndex survives resizing/renumbering).
    return derived.map((s) =>
      applyOverride(
        s,
        exercise.sets[s.sourceIndex]?.overrides.find((o) => o.week === week),
      ),
    )
  })
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
  week?: number | null,
): Promise<{ id: string; week: number; weekDerived: boolean } | null> {
  const day = await getProgramDayDetail(userId, programDayId)
  if (!day) return null

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
  if (existing) return { id: existing.id, week: targetWeek, weekDerived }

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
          name: exercise.name,
          position,
        })
        .returning({ id: workoutExercises.id })

      const derived = prescription[position]
      if (derived.length > 0) {
        await tx.insert(sets).values(
          derived.map((s) => ({
            workoutExerciseId: we.id,
            setNumber: s.setNumber,
            reps: null,
            // Derived load is a mutable starting suggestion; only reps_weight
            // sets carry a load. The achievement fields stay blank until logged.
            weight: s.metricMode === 'reps_weight' ? s.loadKg : null,
            metricMode: s.metricMode,
            durationSec: null,
            distanceM: null,
            completed: false,
          })),
        )
      }
    }

    return { id: workout.id, week: targetWeek, weekDerived }
  })
}
