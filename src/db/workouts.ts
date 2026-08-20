import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lt,
  max,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import { cache } from 'react'
import type { WorkoutInput, LoggingType, WorkoutMetricMode } from '@/lib/workout-input'
import type { SetType } from '@/lib/program-input'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { db } from './index'
import { workouts, workoutExercises, sets, exerciseNotes, notes } from './schema'
import { SetCompletionError } from './workout-errors'
import {
  captureAndParkChildNotes,
  fallbackSetNotesBeforeRemoval,
  reattachChildNotes,
  setCanonicalExerciseNote,
  setCanonicalWorkoutNote,
  type InsertedChildIds,
} from './note-sync'

/**
 * Data access for workouts, always scoped to a Clerk userId.
 *
 * The app has no Postgres row-level security (Clerk issues the identity, not
 * Supabase), so this module is the authorization boundary: every query filters
 * by user_id. Route handlers must go through these helpers rather than querying
 * `workouts` directly, so a caller can never read or mutate another user's data.
 */

/** Lists a user's workouts, most recent first. */
export function listWorkouts(userId: string) {
  return db
    .select()
    .from(workouts)
    .where(eq(workouts.userId, userId))
    .orderBy(desc(workouts.startedAt))
}

/** A history-list row: a workout plus aggregate counts of its exercises/sets. */
export interface WorkoutSummary {
  id: string
  name: string | null
  startedAt: Date
  completedAt: Date | null
  exerciseCount: number
  setCount: number
  completedSetCount: number
  volumeKg: number
}

/** The summary query builder, exported for SQL-shape tests (`.toSQL()`).
 *  App callers use `listWorkoutSummaries` — a drizzle builder re-executes SQL
 *  on every await, so the request memo must wrap an awaited result, not this. */
export function workoutSummariesQuery(userId: string) {
  return db
    .select({
      id: workouts.id,
      name: workouts.name,
      startedAt: workouts.startedAt,
      completedAt: workouts.completedAt,
      exerciseCount: countDistinct(workoutExercises.id),
      setCount: count(sets.id),
      // For the in-progress session banner: how far into the session the
      // last device got, from the saved rows.
      completedSetCount: sql<number>`coalesce(sum(case when ${sets.completed} then 1 else 0 end), 0)`.mapWith(Number),
      volumeKg: sql<number>`coalesce(sum(${sets.reps} * ${sets.weight}), 0)`.mapWith(Number),
    })
    .from(workouts)
    .leftJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id))
    .leftJoin(sets, eq(sets.workoutExerciseId, workoutExercises.id))
    .where(eq(workouts.userId, userId))
    .groupBy(workouts.id)
    .orderBy(desc(workouts.startedAt))
}

/** Lists a user's workouts (most recent first) with exercise/set counts and
 *  total volume (Σ reps × weight kg; duration/distance sets contribute 0), in
 *  one query. Request-memoized (React cache — per-request only, never
 *  cross-request): repeated calls with the same userId inside one server
 *  render/request run the query once. CONSTRAINT: args must stay cache-key-
 *  safe primitives (cache keys by Object.is per arg). */
export const listWorkoutSummaries = cache(
  async (userId: string): Promise<WorkoutSummary[]> => workoutSummariesQuery(userId),
)

/** The comparison facts of a prior same-name session (volume in kg). */
export interface PreviousWorkoutFacts {
  id: string
  startedAt: Date
  completedAt: Date | null
  volumeKg: number
}

/**
 * The most recent COMPLETED workout with the same `name` started before
 * `before` — the summary page's "vs last {name}" baseline. This is the ONE
 * extra read authorized for that page (Arc B): the summary otherwise fetches
 * only the workout itself, and deltas without a prior are no deltas at all.
 * Name-keyed on purpose — "last Push Day" is the comparison the lifter
 * means, program provenance or not. Callers skip unnamed workouts (a null
 * name matches nothing meaningful).
 */
export async function getPreviousCompletedWorkout(
  userId: string,
  name: string,
  before: Date,
): Promise<PreviousWorkoutFacts | null> {
  const [row] = await db
    .select({
      id: workouts.id,
      startedAt: workouts.startedAt,
      completedAt: workouts.completedAt,
      volumeKg: sql<number>`coalesce(sum(${sets.reps} * ${sets.weight}), 0)`.mapWith(Number),
    })
    .from(workouts)
    .leftJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id))
    .leftJoin(sets, eq(sets.workoutExerciseId, workoutExercises.id))
    .where(
      and(
        eq(workouts.userId, userId),
        eq(workouts.name, name),
        isNotNull(workouts.completedAt),
        lt(workouts.startedAt, before),
      ),
    )
    .groupBy(workouts.id)
    .orderBy(desc(workouts.startedAt))
    .limit(1)
  return row ?? null
}

/** A prior performance of an exercise: when it was done and its sets (weights in kg, set order). */
export interface LastPerformance {
  performedAt: Date
  /** Cardio fields ride along so the Prev chip can speak duration/distance;
   *  reps_weight rows carry nulls there. Optional (not `| null` required) so
   *  pre-cardio consumers and fixtures keep their shape. */
  sets: {
    reps: number | null
    weight: number | null
    durationSec?: number | null
    distanceM?: number | null
  }[]
  /**
   * The user's exercise-IDENTITY note (exercise_notes LEFT JOIN), riding the
   * Prev context so the logger can resurface it without a second query. Null
   * when no note exists for the identity.
   */
  note: { body: string; pinned: boolean } | null
  /**
   * The previous session's per-INSTANCE note (workout_exercises.notes),
   * riding the same query — the logger's one-session "Last time: …" echo.
   * Null when that session had no note. Distinct from `note`, which is the
   * exercise-identity note.
   */
  sessionNote: string | null
  /**
   * Whether that same previous instance was marked skipped
   * (workout_exercises.skipped, riding the identical row — no extra query).
   * The echo labels itself "Last time (skipped)" off this fact. Optional so
   * pre-flag consumers and fixtures keep their shape (cardio-field rationale
   * above); absent reads as performed.
   */
  sessionSkipped?: boolean
}

/**
 * Most recent prior performance of the exercise for the user, by workout
 * startedAt. Identity is the composite (source, id) — a custom exercise's id
 * can collide with a wger id and the two must never share ghosts.
 * `excludeWorkoutId` omits the workout currently being edited so it doesn't
 * report itself. Returns null when there's no history.
 */
export async function getLastPerformance(
  userId: string,
  source: ExerciseSource,
  wgerExerciseId: number,
  excludeWorkoutId?: string,
): Promise<LastPerformance | null> {
  const [recent] = await db
    .select({
      exerciseId: workoutExercises.id,
      performedAt: workouts.startedAt,
      // Identity-note ride-along (LEFT JOIN): null columns when no note.
      noteBody: exerciseNotes.body,
      notePinned: exerciseNotes.pinned,
      // …and whether that instance was skipped, so the echo can say so.
      sessionSkipped: workoutExercises.skipped,
    })
    .from(workoutExercises)
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .leftJoin(
      exerciseNotes,
      and(
        eq(exerciseNotes.userId, userId),
        eq(exerciseNotes.source, workoutExercises.source),
        eq(exerciseNotes.exerciseId, workoutExercises.wgerExerciseId),
      ),
    )
    .where(
      and(
        eq(workouts.userId, userId),
        eq(workoutExercises.wgerExerciseId, wgerExerciseId),
        eq(workoutExercises.source, source),
        excludeWorkoutId ? ne(workouts.id, excludeWorkoutId) : undefined,
      ),
    )
    .orderBy(desc(workouts.startedAt))
    .limit(1)

  if (!recent) return null

  // The previous instance's session note now lives in the notes table
  // (notes v2) — the legacy workout_exercises.notes column is no longer
  // read. Latest user-authored note on that instance = the echo.
  const [sessionNoteRow] = await db
    .select({ body: notes.body })
    .from(notes)
    .where(
      and(
        eq(notes.userId, userId),
        eq(notes.workoutExerciseId, recent.exerciseId),
        eq(notes.author, 'user'),
      ),
    )
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .limit(1)

  const setRows = await db
    .select({
      reps: sets.reps,
      weight: sets.weight,
      durationSec: sets.durationSec,
      distanceM: sets.distanceM,
    })
    .from(sets)
    .where(eq(sets.workoutExerciseId, recent.exerciseId))
    .orderBy(asc(sets.setNumber))

  return {
    performedAt: recent.performedAt,
    sets: setRows,
    note:
      recent.noteBody === null
        ? null
        : { body: recent.noteBody, pinned: recent.notePinned ?? false },
    sessionNote: sessionNoteRow?.body ?? null,
    sessionSkipped: recent.sessionSkipped ?? false,
  }
}

/** Flat set rows (reps/weight in kg) for the given exercises across the user's
 *  workouts STARTED BEFORE `before` — the corpus for prior-best/PR comparison.
 *  Excludes the current workout naturally via the time bound. */
export async function getExerciseHistoryBefore(
  userId: string,
  wgerExerciseIds: number[],
  before: Date,
): Promise<
  {
    wgerExerciseId: number
    source: ExerciseSource
    reps: number | null
    weight: number | null
    loggingType: LoggingType
    workoutId: string
    startedAt: Date
    rir: number | null
    setType: SetType
    completed: boolean
  }[]
> {
  if (wgerExerciseIds.length === 0) return []
  return db
    .select({
      wgerExerciseId: workoutExercises.wgerExerciseId,
      // The query stays id-based (an IN over composite pairs buys nothing at
      // this corpus size); callers MUST match rows on (source, id).
      source: workoutExercises.source,
      reps: sets.reps,
      weight: sets.weight,
      // The row's OWN logging type: `weight` is only a total load for
      // weight_reps rows — scorers must not read BW-type rows raw.
      loggingType: workoutExercises.loggingType,
      // Session identity + ordering + effort for the rolling e1RM
      // (lib/rolling-e1rm.ts) — the windowed signal groups per workout and
      // credits logged RIR; additive, existing consumers ignore them.
      workoutId: workouts.id,
      startedAt: workouts.startedAt,
      rir: sets.rir,
      setType: sets.setType,
      completed: sets.completed,
    })
    .from(sets)
    .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .where(
      and(
        eq(workouts.userId, userId),
        inArray(workoutExercises.wgerExerciseId, wgerExerciseIds),
        lt(workouts.startedAt, before),
      ),
    )
}

/** The tree query builder, exported for SQL-shape tests (`.toSQL()`), the
 *  workoutSummariesQuery convention. App callers use `getWorkoutDetail`. */
export function workoutDetailQuery(userId: string, id: string) {
  return db.query.workouts.findFirst({
    where: and(eq(workouts.id, id), eq(workouts.userId, userId)),
    with: {
      exercises: {
        orderBy: (e) => [asc(e.position)],
        with: { sets: { orderBy: (s) => [asc(s.setNumber)] } },
      },
    },
  })
}

/**
 * Fetches a single workout with its exercises and sets, only if owned by the
 * user. The `notes` fields on the workout and each exercise are PROJECTED from
 * the notes table (notes v2) — the legacy columns are never read: the workout
 * tier is the latest user-authored workout-anchored note without a fallback
 * snapshot, the exercise tier the latest user-authored note per instance —
 * so every consumer (detail page, detailToDraft, MCP get_workout) keeps its
 * shape while the storage moves.
 */
export async function getWorkoutDetail(userId: string, id: string) {
  const workout = await workoutDetailQuery(userId, id)
  if (!workout) return workout
  const noteRows = await db
    .select({
      workoutId: notes.workoutId,
      workoutExerciseId: notes.workoutExerciseId,
      body: notes.body,
      anchorSnapshot: notes.anchorSnapshot,
    })
    .from(notes)
    .leftJoin(workoutExercises, eq(workoutExercises.id, notes.workoutExerciseId))
    .where(
      and(
        eq(notes.userId, userId),
        eq(notes.author, 'user'),
        or(eq(notes.workoutId, id), eq(workoutExercises.workoutId, id)),
      ),
    )
    // Newest first; the first row seen per anchor below is the canonical one.
    .orderBy(desc(notes.updatedAt), desc(notes.id))
  let workoutNote: string | null = null
  const exerciseNote = new Map<string, string>()
  for (const row of noteRows) {
    if (row.workoutExerciseId !== null) {
      if (!exerciseNote.has(row.workoutExerciseId)) exerciseNote.set(row.workoutExerciseId, row.body)
    } else if (row.workoutId !== null && row.anchorSnapshot === null && workoutNote === null) {
      // A snapshot on a workout-anchored row marks a fallback re-anchor — a
      // set/exercise note whose anchor vanished — never the session note.
      workoutNote = row.body
    }
  }
  return {
    ...workout,
    notes: workoutNote,
    exercises: workout.exercises.map((exercise) => ({
      ...exercise,
      notes: exerciseNote.get(exercise.id) ?? null,
    })),
  }
}

/** The full nested shape returned by getWorkoutDetail (workout + exercises + sets). */
export type WorkoutDetail = NonNullable<Awaited<ReturnType<typeof getWorkoutDetail>>>

/**
 * The user's two most recent COMPLETED workouts for one program day (ids
 * only, newest by startedAt with id as the midnight-collision tiebreak — the
 * autoreg-history ordering convention). Row 0 is the plan-sync guard: only
 * that workout may offer to sync the plan to its performance, so a stale
 * summary revisited later can never propose regressing the plan to old
 * numbers. Row 1 (when present) is the M2 confirmation session — up-anchors
 * need two consecutive outperformed sessions.
 */
export function latestCompletedWorkoutForDay(userId: string, programDayId: string) {
  return db
    .select({ id: workouts.id })
    .from(workouts)
    .where(
      and(
        eq(workouts.userId, userId),
        eq(workouts.programDayId, programDayId),
        isNotNull(workouts.completedAt),
      ),
    )
    .orderBy(desc(workouts.startedAt), desc(workouts.id))
    .limit(2)
}

/** Creates a workout owned by the given user. */
export function createWorkout(userId: string, name?: string) {
  return db.insert(workouts).values({ userId, name }).returning()
}

/**
 * Whether the user has EVER completed a workout — the `is_first` bit on the
 * workout_completed analytics event (activation metric). Called before the
 * write so the workout being saved doesn't count itself.
 */
export async function hasAnyCompletedWorkout(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(and(eq(workouts.userId, userId), isNotNull(workouts.completedAt)))
    .limit(1)
  return row !== undefined
}

/**
 * The pre-write facts the analytics events need about one workout: its
 * timestamps (duration, completed-vs-in-progress transition) and how many
 * sets exist (abandonment depth). Counts only — no workout content leaves
 * this shape, per the health-data rule in @/lib/analytics.
 */
export async function getWorkoutAnalyticsState(
  userId: string,
  id: string,
): Promise<{ startedAt: Date; completedAt: Date | null; setCount: number } | null> {
  const [row] = await db
    .select({
      startedAt: workouts.startedAt,
      completedAt: workouts.completedAt,
      setCount: count(sets.id),
    })
    .from(workouts)
    .leftJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id))
    .leftJoin(sets, eq(sets.workoutExerciseId, workoutExercises.id))
    .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
    .groupBy(workouts.id)
  return row ?? null
}

/** The transaction handle, lifted from the callback signature (no internal import). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** The set-level facts that must survive updateWorkout's full replace: the
 *  prescribed-at-instantiation snapshot (immutable — input can never carry
 *  it) and any backoff/amrap typing the logger UI can't express. Keyed by
 *  (source, exerciseId, setNumber) — see priorFactKey. */
interface PriorSetFacts {
  setType: 'working' | 'warmup' | 'backoff' | 'amrap'
  prescribedLoadKg: number | null
  prescribedRepMin: number | null
  prescribedRir: number | null
  prescribedRpe: number | null
}

function priorFactKey(source: string, wgerExerciseId: number, setNumber: number): string {
  return `${source}:${wgerExerciseId}:${setNumber}`
}

/** Inserts a workout's exercises + sets (shared by saveWorkout and
 *  updateWorkout). `priorFacts` re-stamps replace-surviving facts onto the
 *  re-inserted rows (updateWorkout only): snapshots always; setType only for
 *  backoff/amrap, which the draft UI can't express — working↔warmup retags
 *  from the input win.
 *
 *  Facts match by POSITION, so they carry forward only while positions can
 *  still align (`priorSetCounts` gate): a SHRUNK set list proves a removal
 *  shifted later positions, and positionally re-stamped snapshots would
 *  attribute one set's prescription to another — evidence corruption. A
 *  shrunk exercise drops its facts instead (unscorable → the autoreg engine
 *  stays silent; silence over corruption). Appends keep positions 1..n
 *  aligned, so same-or-grown lists carry facts — the common add-a-set flow
 *  must not shed evidence. Residual: a remove+add that nets to same-or-more
 *  sets still matches positionally — accepted, bounded by the engine's
 *  load-floor screening and 3-stall rule. */
async function insertWorkoutChildren(
  tx: Tx,
  workoutId: string,
  exercises: WorkoutInput['exercises'],
  priorFacts?: Map<string, PriorSetFacts>,
  priorSetCounts?: Map<string, number>,
): Promise<InsertedChildIds> {
  // New row ids keyed by exercise identity (first slot wins on duplicates,
  // mirroring priorFacts) — what note re-anchoring and the wire-notes
  // reconcile address the fresh rows by.
  const inserted: InsertedChildIds = { exerciseIdByKey: new Map(), setIdByKey: new Map() }
  for (const [position, exercise] of exercises.entries()) {
    const [we] = await tx
      .insert(workoutExercises)
      .values({
        workoutId,
        wgerExerciseId: exercise.wgerExerciseId,
        name: exercise.name,
        position,
        // Omit when absent so the column default ('weight_reps') applies —
        // pre-logging-type callers (older MCP clients) keep their shape.
        ...(exercise.loggingType !== undefined ? { loggingType: exercise.loggingType } : {}),
        // Same rule for the identity discriminator (default 'wger').
        ...(exercise.source !== undefined ? { source: exercise.source } : {}),
        // NOTE: the wire's exercise `notes` no longer writes the legacy
        // column — the callers reconcile it into the notes table (notes v2).
        ...(exercise.skipped !== undefined ? { skipped: exercise.skipped } : {}),
      })
      .returning({ id: workoutExercises.id })
    const exerciseKeyOf = `${exercise.source ?? 'wger'}:${exercise.wgerExerciseId}`
    if (!inserted.exerciseIdByKey.has(exerciseKeyOf)) {
      inserted.exerciseIdByKey.set(exerciseKeyOf, we.id)
    }
    const firstSlot = inserted.exerciseIdByKey.get(exerciseKeyOf) === we.id

    if (exercise.sets.length > 0) {
      const exerciseKey = exerciseKeyOf
      const priorCount = priorSetCounts?.get(exerciseKey)
      const positionsAlign = priorCount !== undefined && exercise.sets.length >= priorCount
      const setRows = await tx.insert(sets).values(
        exercise.sets.map((s, i) => {
          const fact = positionsAlign
            ? priorFacts?.get(
                priorFactKey(exercise.source ?? 'wger', exercise.wgerExerciseId, i + 1),
              )
            : undefined
          const keepPriorType =
            s.setType === undefined &&
            (fact?.setType === 'backoff' || fact?.setType === 'amrap')
          return {
            workoutExerciseId: we.id,
            setNumber: i + 1,
            reps: s.reps,
            weight: s.weight,
            completed: s.completed ?? false,
            // Omit when absent so the column default ('working') applies —
            // same additive rule as loggingType above.
            ...(s.setType !== undefined ? { setType: s.setType } : {}),
            ...(keepPriorType && fact ? { setType: fact.setType } : {}),
            ...(fact
              ? {
                  prescribedLoadKg: fact.prescribedLoadKg,
                  prescribedRepMin: fact.prescribedRepMin,
                  prescribedRir: fact.prescribedRir,
                  prescribedRpe: fact.prescribedRpe,
                }
              : {}),
            // Logged effort travels on the wire like reps/weight (absent →
            // column default null) — unlike the prescribed_* snapshot, which
            // only ever re-stamps from prior facts above.
            ...(s.rir !== undefined ? { rir: s.rir } : {}),
            ...(s.rpe !== undefined ? { rpe: s.rpe } : {}),
            // Cardio metric fields (same additive rule): the draft round-trips
            // metricMode through detailToDraft → draftToInput, so a full
            // replace re-asserts it from the wire — no prior-facts leg needed.
            ...(s.metricMode !== undefined ? { metricMode: s.metricMode } : {}),
            ...(s.durationSec !== undefined ? { durationSec: s.durationSec } : {}),
            ...(s.distanceM !== undefined ? { distanceM: s.distanceM } : {}),
            // Technique grouping rides the wire like metricMode (the draft
            // round-trips it), NOT like the prescribed_* snapshot: the lifter
            // may retag a set mid-session, and a replace must persist the
            // retag rather than restore the plan's grouping. Absent → all
            // three columns null, an ordinary set.
            ...(s.technique !== undefined
              ? {
                  techniqueKind: s.technique.kind,
                  techniqueGroup: s.technique.group,
                  stageIndex: s.technique.stageIndex,
                }
              : {}),
          }
        }),
      ).returning({
        id: sets.id,
        setNumber: sets.setNumber,
        weight: sets.weight,
        reps: sets.reps,
        durationSec: sets.durationSec,
      })
      if (firstSlot) {
        for (const row of setRows) {
          inserted.setIdByKey.set(`${exerciseKey}:${row.setNumber}`, {
            id: row.id,
            weight: row.weight,
            reps: row.reps,
            durationSec: row.durationSec,
          })
        }
      }
    }
  }
  return inserted
}

/**
 * Persists a full workout — the `workouts` row plus its nested
 * `workout_exercises` and `sets` — for the given user, atomically.
 *
 * Everything runs inside one `db.transaction`, so a partial save can never
 * happen: either the whole tree commits or nothing does. The workout is stamped
 * with `userId`; the children inherit ownership through `workoutId`, so the
 * user-scoping invariant of this module holds for the entire tree without
 * filtering each child on `userId`.
 *
 * `position` is the 0-based order an exercise was added; `setNumber` is the
 * 1-based order of a set within its exercise. Runs on the Supabase transaction
 * pooler (single connection per checkout; `prepare:false` set in ./index).
 */
export async function saveWorkout(userId: string, input: WorkoutInput): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [workout] = await tx
      .insert(workouts)
      // Omit startedAt when absent so the column default (now()) applies.
      // Saving a manual log IS completing the session, so completedAt is
      // stamped here (instantiated program workouts get theirs on first edit).
      // A backdated save (explicit startedAt, e.g. MCP create_workout logging
      // last week's session) completes at that same moment — a wall-clock
      // completedAt would contradict the session's actual date and corrupt
      // anything keyed on completion time.
      .values({
        userId,
        name: input.name,
        // The session note goes to the notes table below (notes v2); the
        // legacy workouts.notes column is no longer written.
        completedAt: input.completedAt ?? input.startedAt ?? new Date(),
        ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
      })
      .returning({ id: workouts.id })

    const ids = await insertWorkoutChildren(tx, workout.id, input.exercises)
    await syncWireNotes(tx, userId, workout.id, input, ids, { fresh: true })

    return { id: workout.id }
  })
}

/**
 * Reconciles the wire's one-string note tiers into the notes table: the
 * session note and each exercise's instance note map onto their CANONICAL
 * rows (create/update/delete — absent clears, preserving the legacy
 * full-replace "the input IS the state" rule). First slot wins on a
 * duplicated exercise identity, mirroring priorFacts. Shared by saveWorkout
 * and updateWorkout so the two write paths can't drift. `fresh` skips the
 * canonical reads on a brand-new workout (nothing can exist yet) — one
 * batched insert instead of a read-modify per tier.
 */
async function syncWireNotes(
  tx: Tx,
  userId: string,
  workoutId: string,
  input: WorkoutInput,
  ids: InsertedChildIds,
  opts: { fresh?: boolean } = {},
): Promise<void> {
  const seen = new Set<string>()
  if (opts.fresh) {
    const values: (typeof notes.$inferInsert)[] = []
    if (input.notes !== undefined) {
      values.push({ userId, author: 'user', body: input.notes, workoutId })
    }
    for (const exercise of input.exercises) {
      const key = `${exercise.source ?? 'wger'}:${exercise.wgerExerciseId}`
      if (seen.has(key)) continue
      seen.add(key)
      const weId = ids.exerciseIdByKey.get(key)
      if (weId === undefined || exercise.notes === undefined) continue
      values.push({
        userId,
        author: 'user',
        body: exercise.notes,
        workoutExerciseId: weId,
        anchorSnapshot: { exerciseName: exercise.name },
      })
    }
    if (values.length > 0) await tx.insert(notes).values(values)
    return
  }
  await setCanonicalWorkoutNote(tx, userId, workoutId, input.notes ?? null)
  for (const exercise of input.exercises) {
    const key = `${exercise.source ?? 'wger'}:${exercise.wgerExerciseId}`
    if (seen.has(key)) continue
    seen.add(key)
    const weId = ids.exerciseIdByKey.get(key)
    if (weId === undefined) continue
    await setCanonicalExerciseNote(tx, userId, weId, exercise.name, exercise.notes ?? null)
  }
}

/** Deletes a workout (and its children, via FK cascade) only if owned by the user. */
export function deleteWorkout(userId: string, id: string) {
  return db
    .delete(workouts)
    .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
    .returning({ id: workouts.id })
}

/**
 * Replaces a workout's name + exercises/sets atomically, only if owned by the
 * user. The `update ... returning` doubles as the ownership gate: if no row
 * comes back the caller doesn't own it (or it's gone) and nothing is mutated.
 * Children are deleted (cascade removes their sets) and re-inserted from input.
 */
export async function updateWorkout(
  userId: string,
  id: string,
  input: WorkoutInput,
): Promise<{ id: string } | null> {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .update(workouts)
      // Omit startedAt when absent so the existing value is preserved.
      // First edit completes a not-yet-completed workout (instantiated program
      // days are logged through the edit flow); later edits keep the original.
      // As in saveWorkout, an explicit startedAt (backdated edit) is also the
      // completion moment — never stamp wall-clock time onto a past session.
      .set({
        name: input.name ?? null,
        // The session note is reconciled into the notes table below (notes
        // v2); the legacy workouts.notes column is no longer written.
        completedAt: (() => {
          const explicit = input.completedAt ?? input.startedAt
          // Serialize to ISO here: a param inside a raw sql`` fragment skips
          // the column's Date→string mapping, and postgres.js rejects a raw
          // Date instance (ERR_INVALID_ARG_TYPE).
          return explicit !== undefined
            ? sql`coalesce(${workouts.completedAt}, ${explicit.toISOString()})`
            : sql`coalesce(${workouts.completedAt}, now())`
        })(),
        ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
      })
      .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
      .returning({ id: workouts.id })
    if (!owned) return null

    // Capture the replace-surviving facts BEFORE the delete: the prescribed_*
    // snapshot is immutable provenance the wire input can never carry, and
    // backoff/amrap typing has no draft-UI representation — a full replace
    // must not silently erase either. First slot wins on a duplicated
    // exercise (position order), mirroring the logger's keying.
    const priorRows = await tx
      .select({
        wgerExerciseId: workoutExercises.wgerExerciseId,
        source: workoutExercises.source,
        setNumber: sets.setNumber,
        setType: sets.setType,
        prescribedLoadKg: sets.prescribedLoadKg,
        prescribedRepMin: sets.prescribedRepMin,
        prescribedRir: sets.prescribedRir,
        prescribedRpe: sets.prescribedRpe,
      })
      .from(sets)
      .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
      .where(eq(workoutExercises.workoutId, id))
      .orderBy(asc(workoutExercises.position), asc(sets.setNumber))
    const priorFacts = new Map<string, PriorSetFacts>()
    // Sets captured per exercise (first slot) — the structure-unchanged gate
    // in insertWorkoutChildren compares against the incoming set count.
    const priorSetCounts = new Map<string, number>()
    for (const row of priorRows) {
      const key = priorFactKey(row.source, row.wgerExerciseId, row.setNumber)
      if (!priorFacts.has(key)) {
        priorFacts.set(key, {
          setType: row.setType,
          prescribedLoadKg: row.prescribedLoadKg,
          prescribedRepMin: row.prescribedRepMin,
          prescribedRir: row.prescribedRir,
          prescribedRpe: row.prescribedRpe,
        })
        const exerciseKey = `${row.source}:${row.wgerExerciseId}`
        priorSetCounts.set(exerciseKey, (priorSetCounts.get(exerciseKey) ?? 0) + 1)
      }
    }

    // Park set/exercise-anchored notes on the workout BEFORE the child delete
    // — their FKs cascade, and an edit must never eat the user's words.
    const capturedNotes = await captureAndParkChildNotes(tx, id)

    await tx.delete(workoutExercises).where(eq(workoutExercises.workoutId, id))
    const ids = await insertWorkoutChildren(tx, id, input.exercises, priorFacts, priorSetCounts)

    // Re-attach parked notes to the re-inserted rows under the SAME alignment
    // gate as the prescribed_* facts (set notes carry only while incoming set
    // counts >= prior); anything unmatched stays workout-anchored (fallback,
    // snapshot preserved).
    const alignedKeys = new Set<string>()
    for (const [key, priorCount] of priorSetCounts) {
      const incoming = input.exercises.find(
        (e) => `${e.source ?? 'wger'}:${e.wgerExerciseId}` === key,
      )
      if (incoming !== undefined && incoming.sets.length >= priorCount) alignedKeys.add(key)
    }
    await reattachChildNotes(tx, capturedNotes, ids, alignedKeys)

    // Finally reconcile the wire's one-string note tiers against the
    // (re-anchored) canonical rows.
    await syncWireNotes(tx, userId, id, input, ids)
    return { id }
  })
}

/**
 * Resolves a workout-exercise id only when the workout is owned by the user. The
 * join to `workouts.userId` is the ownership gate for every set-level edit below:
 * a caller can address a set only through an exercise that belongs to a workout
 * they own. Returns null when the workout isn't owned or no exercise sits at that
 * 0-based position.
 */
async function findOwnedExerciseId(
  tx: Tx,
  userId: string,
  workoutId: string,
  position: number,
): Promise<string | null> {
  const [we] = await tx
    .select({ id: workoutExercises.id })
    .from(workoutExercises)
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .where(
      and(
        eq(workoutExercises.workoutId, workoutId),
        eq(workoutExercises.position, position),
        eq(workouts.userId, userId),
      ),
    )
    .limit(1)
  return we?.id ?? null
}

/** A single-set edit. An omitted key is left unchanged; an explicit `null` clears it. */
export interface SetPatch {
  reps?: number | null
  weight?: number | null // kg
  /** In-session check-off state; boolean only (the column is NOT NULL). */
  completed?: boolean
  /** Logged effort (validated at the tool boundary — lib/effort.ts ranges);
   *  omitted = unchanged, explicit null clears. */
  rir?: number | null
  rpe?: number | null
  /** How the set reads (reps_weight | duration | duration_distance); the
   *  column is NOT NULL so omitted = unchanged, never null. */
  metricMode?: WorkoutMetricMode
  durationSec?: number | null
  distanceM?: number | null
}

/**
 * Marks an owned workout completed if it isn't already. Set-level edits are how
 * instantiated program workouts get logged (the MCP patch tools), so a
 * successful set write doubles as the completion signal — mirroring
 * `updateWorkout`, where the web logger's first edit stamps `completedAt`. The
 * coalesce keeps an existing completion time untouched. Ownership is already
 * proven by `findOwnedExerciseId` before any caller reaches this.
 */
async function stampWorkoutCompleted(tx: Tx, workoutId: string): Promise<void> {
  await tx
    .update(workouts)
    .set({ completedAt: sql`coalesce(${workouts.completedAt}, now())` })
    .where(eq(workouts.id, workoutId))
}

/**
 * True when applying `patch` could leave the addressed set completed WITHOUT
 * its required metric — the only shapes that force a pre-write read. Anything
 * else keeps the original no-read fast path.
 */
function patchCanBreakCompletion(patch: SetPatch): boolean {
  return (
    patch.completed === true ||
    patch.weight === null ||
    // <= 0 matches assertPatchedSetCompletable's "missing" definition — the
    // MCP arg floor (min 1) forecloses 0 today, but this API has no floor of
    // its own and a future caller must not defeat the completion guarantee.
    patch.durationSec === null ||
    (patch.durationSec !== undefined && patch.durationSec <= 0) ||
    patch.metricMode !== undefined
  )
}

/**
 * #206 (and its cardio parity) at the DB boundary: given the CURRENT row and
 * the patch, refuses any edit whose post-patch state is a completed set with
 * no required metric — no weight on a weight_reps-logged reps_weight set, no
 * positive duration on a cardio set. Throws `SetCompletionError` (invalid,
 * surfaced verbatim by the tool layer) — distinct from `null` = not-found.
 */
function assertPatchedSetCompletable(
  row: {
    completed: boolean
    weight: number | null
    durationSec: number | null
    /** Raw column text (the schema doesn't $type this column); the whitelist
     *  was enforced on the way in, so comparing literals is safe. */
    metricMode: string
    loggingType: LoggingType
  },
  patch: SetPatch,
): void {
  const completed = patch.completed ?? row.completed
  if (!completed) return
  const mode = patch.metricMode ?? row.metricMode
  if (mode === 'reps_weight') {
    const weight = patch.weight !== undefined ? patch.weight : row.weight
    if (row.loggingType === 'weight_reps' && weight === null) {
      throw new SetCompletionError(
        'a completed set needs a weight when the exercise logs weight × reps — set a weight in the same call, or uncomplete the set',
      )
    }
  } else {
    const durationSec = patch.durationSec !== undefined ? patch.durationSec : row.durationSec
    if (durationSec === null || durationSec <= 0) {
      throw new SetCompletionError(
        `a completed ${mode} set needs a duration — set durationSec in the same call, or uncomplete the set`,
      )
    }
  }
}

/**
 * Updates one set (reps and/or weight) of an owned workout's exercise, addressed
 * by 0-based exercise `position` and 1-based `setNumber`. Returns null when the
 * patch is empty, the workout isn't owned, the position is absent, or no such set
 * exists — the tool layer turns that into a not-found. Throws
 * `SetCompletionError` when the patch would leave a completed set without its
 * required metric (see `assertPatchedSetCompletable`); patches that can't
 * produce that state keep the original no-read fast path.
 */
export async function updateSet(
  userId: string,
  workoutId: string,
  exercisePosition: number,
  setNumber: number,
  patch: SetPatch,
): Promise<{ id: string } | null> {
  const values = {
    ...(patch.reps !== undefined ? { reps: patch.reps } : {}),
    ...(patch.weight !== undefined ? { weight: patch.weight } : {}),
    ...(patch.completed !== undefined ? { completed: patch.completed } : {}),
    ...(patch.rir !== undefined ? { rir: patch.rir } : {}),
    ...(patch.rpe !== undefined ? { rpe: patch.rpe } : {}),
    ...(patch.metricMode !== undefined ? { metricMode: patch.metricMode } : {}),
    ...(patch.durationSec !== undefined ? { durationSec: patch.durationSec } : {}),
    ...(patch.distanceM !== undefined ? { distanceM: patch.distanceM } : {}),
  }
  if (Object.keys(values).length === 0) return null
  return db.transaction(async (tx) => {
    const exerciseId = await findOwnedExerciseId(tx, userId, workoutId, exercisePosition)
    if (!exerciseId) return null
    if (patchCanBreakCompletion(patch)) {
      const [row] = await tx
        .select({
          completed: sets.completed,
          weight: sets.weight,
          durationSec: sets.durationSec,
          metricMode: sets.metricMode,
          loggingType: workoutExercises.loggingType,
        })
        .from(sets)
        .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
        .where(and(eq(sets.workoutExerciseId, exerciseId), eq(sets.setNumber, setNumber)))
        .limit(1)
      if (!row) return null
      assertPatchedSetCompletable(row, patch)
    }
    const [updated] = await tx
      .update(sets)
      .set(values)
      .where(and(eq(sets.workoutExerciseId, exerciseId), eq(sets.setNumber, setNumber)))
      .returning({ id: sets.id })
    if (!updated) return null
    await stampWorkoutCompleted(tx, workoutId)
    return updated
  })
}

/**
 * Appends a set to an owned exercise, numbered one past the current last set.
 * Returns the new 1-based `setNumber`, or null when the workout isn't owned or
 * the exercise position is absent.
 */
export async function addSet(
  userId: string,
  workoutId: string,
  exercisePosition: number,
  // Callers that know the set's role forward it; without one the DB default
  // 'working' stands (the MCP add_set path). Ad-hoc adds carry NO
  // prescribed_* snapshot — they were never prescribed, so the autoreg
  // engine treats them as unscorable.
  patch: SetPatch & { setType?: 'working' | 'warmup' | 'backoff' | 'amrap' },
): Promise<{ setNumber: number } | null> {
  return db.transaction(async (tx) => {
    const exerciseId = await findOwnedExerciseId(tx, userId, workoutId, exercisePosition)
    if (!exerciseId) return null
    const [{ value: lastNumber }] = await tx
      .select({ value: max(sets.setNumber) })
      .from(sets)
      .where(eq(sets.workoutExerciseId, exerciseId))
    const setNumber = (lastNumber ?? 0) + 1
    await tx.insert(sets).values({
      workoutExerciseId: exerciseId,
      setNumber,
      reps: patch.reps ?? null,
      weight: patch.weight ?? null,
      completed: patch.completed ?? false,
      ...(patch.setType !== undefined ? { setType: patch.setType } : {}),
      ...(patch.rir !== undefined ? { rir: patch.rir } : {}),
      ...(patch.rpe !== undefined ? { rpe: patch.rpe } : {}),
      ...(patch.metricMode !== undefined ? { metricMode: patch.metricMode } : {}),
      ...(patch.durationSec !== undefined ? { durationSec: patch.durationSec } : {}),
      ...(patch.distanceM !== undefined ? { distanceM: patch.distanceM } : {}),
    })
    await stampWorkoutCompleted(tx, workoutId)
    return { setNumber }
  })
}

/**
 * Removes one set from an owned exercise and renumbers the higher sets down by
 * one, keeping `setNumber` 1-based and contiguous. Returns null when not owned,
 * the position is absent, or no such set exists.
 */
export async function removeSet(
  userId: string,
  workoutId: string,
  exercisePosition: number,
  setNumber: number,
): Promise<{ removed: true } | null> {
  return db.transaction(async (tx) => {
    const exerciseId = await findOwnedExerciseId(tx, userId, workoutId, exercisePosition)
    if (!exerciseId) return null
    // Capture the doomed set's facts BEFORE the delete: its notes must fall
    // back to the workout anchor (the cascade would eat them — the same
    // landmine updateWorkout's park/re-attach guards), with a snapshot
    // written from these facts when the note never had one.
    const [target] = await tx
      .select({
        id: sets.id,
        weight: sets.weight,
        reps: sets.reps,
        durationSec: sets.durationSec,
        exerciseName: workoutExercises.name,
      })
      .from(sets)
      .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
      .where(and(eq(sets.workoutExerciseId, exerciseId), eq(sets.setNumber, setNumber)))
      .limit(1)
    if (!target) return null
    await fallbackSetNotesBeforeRemoval(tx, workoutId, {
      id: target.id,
      setNumber,
      exerciseName: target.exerciseName,
      weight: target.weight,
      reps: target.reps,
      durationSec: target.durationSec,
    })
    const [deleted] = await tx
      .delete(sets)
      .where(and(eq(sets.workoutExerciseId, exerciseId), eq(sets.setNumber, setNumber)))
      .returning({ id: sets.id })
    if (!deleted) return null
    // Close the gap the removal left so set order stays 1-based contiguous.
    await tx
      .update(sets)
      .set({ setNumber: sql`${sets.setNumber} - 1` })
      .where(and(eq(sets.workoutExerciseId, exerciseId), gt(sets.setNumber, setNumber)))
    await stampWorkoutCompleted(tx, workoutId)
    return { removed: true }
  })
}

/** The metadata `updateWorkoutMeta` can change without touching exercises/sets. */
export interface WorkoutMeta {
  name?: string | null
  startedAt?: Date
  /** Session note; `null` clears it, omitted leaves it unchanged. */
  notes?: string | null
}

/**
 * Updates only a workout's name and/or startedAt — no child changes — gated on
 * ownership via the `update ... returning`. Returns null when the patch is empty
 * or the user doesn't own the workout.
 */
export async function updateWorkoutMeta(
  userId: string,
  id: string,
  meta: WorkoutMeta,
): Promise<{ id: string } | null> {
  const values = {
    ...(meta.name !== undefined ? { name: meta.name } : {}),
    ...(meta.startedAt !== undefined ? { startedAt: meta.startedAt } : {}),
  }
  if (Object.keys(values).length === 0 && meta.notes === undefined) return null
  return db.transaction(async (tx) => {
    // The ownership gate: a column update when there is one, else a bare
    // owned-row read (a notes-only patch still needs the proof).
    let owned: { id: string } | undefined
    if (Object.keys(values).length > 0) {
      ;[owned] = await tx
        .update(workouts)
        .set(values)
        .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
        .returning({ id: workouts.id })
    } else {
      ;[owned] = await tx
        .select({ id: workouts.id })
        .from(workouts)
        .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
        .limit(1)
    }
    if (!owned) return null
    // The session note lives in the notes table (notes v2): null clears the
    // canonical row, a string creates/updates it. The legacy column is dead.
    if (meta.notes !== undefined) {
      await setCanonicalWorkoutNote(tx, userId, id, meta.notes)
    }
    return owned
  })
}

/** The per-exercise facts `updateExerciseMeta` can change without touching sets. */
export interface ExerciseMeta {
  /** Exercise note; `null` clears it, omitted leaves it unchanged. */
  notes?: string | null
  /** Skipped in-session. Never completes or deletes the sets — they stay as logged. */
  skipped?: boolean
}

/**
 * Updates only one workout exercise's notes and/or skipped flag, addressed by
 * 0-based `position` — no set changes, no completion stamp (a skip/note is a
 * meta fact, not a logging signal). Returns null when the patch is empty, the
 * workout isn't owned, or the position is absent.
 */
export async function updateExerciseMeta(
  userId: string,
  workoutId: string,
  exercisePosition: number,
  meta: ExerciseMeta,
): Promise<{ id: string } | null> {
  if (meta.notes === undefined && meta.skipped === undefined) return null
  return db.transaction(async (tx) => {
    const exerciseId = await findOwnedExerciseId(tx, userId, workoutId, exercisePosition)
    if (!exerciseId) return null
    let updated: { id: string; name: string } | undefined
    if (meta.skipped !== undefined) {
      ;[updated] = await tx
        .update(workoutExercises)
        .set({ skipped: meta.skipped })
        .where(eq(workoutExercises.id, exerciseId))
        .returning({ id: workoutExercises.id, name: workoutExercises.name })
    } else {
      ;[updated] = await tx
        .select({ id: workoutExercises.id, name: workoutExercises.name })
        .from(workoutExercises)
        .where(eq(workoutExercises.id, exerciseId))
        .limit(1)
    }
    if (!updated) return null
    // The instance note lives in the notes table (notes v2): null clears the
    // canonical row, a string creates/updates it. The legacy column is dead.
    if (meta.notes !== undefined) {
      await setCanonicalExerciseNote(tx, userId, updated.id, updated.name, meta.notes)
    }
    return { id: updated.id }
  })
}
