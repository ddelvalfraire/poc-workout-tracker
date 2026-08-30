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
  isNull,
  lt,
  max,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import { cache } from 'react'
import type { WorkoutInput, LoggingType, WorkoutMetricMode } from '@/lib/workout/workout-input'
import type { SetType } from '@/lib/programs/program-input'
import type { ExerciseSource } from '@/lib/exercises/custom-exercise-input'
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
import {
  recordWorkoutEvent,
  recordWorkoutEvents,
  type WorkoutChangeContext,
  type WorkoutEventInput,
} from './workout-events'
import {
  describeSetChange,
  describeSetSubject,
  diffSetSnapshots,
  isBlankSetSnapshot,
  setSnapshotKey,
  type WorkoutSetSnapshot,
} from './workout-set-diff'

/**
 * Data access for workouts, always scoped to a WorkOS userId.
 *
 * The app has no Postgres row-level security (WorkOS issues the identity, not
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
    /** Set role, so the Prev column can pair by CLASS (a warm-up last time
     *  never ghosts a working row today — resolveHistorySet). Optional like
     *  the cardio fields: pre-existing fixtures keep their shape, and an
     *  absent value reads as non-warm-up. */
    setType?: SetType
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
      setType: sets.setType,
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

/** Delegates to the change log's key so the before-image and the
 *  replace-surviving facts can never drift apart on identity. */
function priorFactKey(source: string, wgerExerciseId: number, setNumber: number): string {
  return setSnapshotKey(source, wgerExerciseId, setNumber)
}

/**
 * The after-image of a wire set, normalised to what `insertWorkoutChildren`
 * will actually store: an omitted field lands as its column default, so the
 * diff must compare against that default and not against `undefined` — every
 * omission would otherwise read as a change.
 */
function snapshotFromInput(
  exercise: WorkoutInput['exercises'][number],
  set: WorkoutInput['exercises'][number]['sets'][number],
  setNumber: number,
): WorkoutSetSnapshot {
  return {
    source: exercise.source ?? 'wger',
    wgerExerciseId: exercise.wgerExerciseId,
    exerciseName: exercise.name,
    setNumber,
    reps: set.reps ?? null,
    weight: set.weight ?? null,
    completed: set.completed ?? false,
    rir: set.rir ?? null,
    rpe: set.rpe ?? null,
    metricMode: set.metricMode ?? 'reps_weight',
    durationSec: set.durationSec ?? null,
    distanceM: set.distanceM ?? null,
  }
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
 *
 * `context` declares WHO wrote it and WHAT the write meant; this path persists
 * a session for the first time, so callers declare kind 'original'. The
 * changelog row rides the same transaction — a rolled-back save logs nothing.
 */
export async function saveWorkout(
  userId: string,
  input: WorkoutInput,
  context: WorkoutChangeContext,
): Promise<{ id: string }> {
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
        // This call IS the session's original record, so the marker is stamped
        // with it. Wall-clock deliberately, even on a backdated save: the
        // column says WHEN THE RECORD WAS WRITTEN, not when the training
        // happened — `startedAt`/`completedAt` already own that.
        originalRecordedAt: new Date(),
        ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
      })
      .returning({ id: workouts.id })

    const ids = await insertWorkoutChildren(tx, workout.id, input.exercises)
    await syncWireNotes(tx, userId, workout.id, input, ids, { fresh: true })

    // ONE row for the whole creation: the record being created is a single
    // intent, so there is nothing to diff and nothing in `changed`. The
    // subject is the session itself, which is why `after` counts rather than
    // snapshotting a tree the workout rows already hold verbatim.
    const setCount = input.exercises.reduce((total, e) => total + e.sets.length, 0)
    await recordWorkoutEvent(tx, {
      workoutId: workout.id,
      userId,
      kind: context.kind,
      actor: context.actor,
      action: 'create_workout',
      summary: `Logged ${input.name ?? 'workout'} — ${input.exercises.length} exercises, ${setCount} sets`,
      after: { name: input.name ?? null, exerciseCount: input.exercises.length, setCount },
    })

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

/**
 * Turns a pre-delete before-image plus the incoming wire tree into changelog
 * rows — ONE row per set the edit actually touched, never one per column and
 * never one per re-inserted row. A full replace that changed nothing yields an
 * empty array, and `recordWorkoutEvents` then writes nothing.
 *
 * Sets pair by the (source, exerciseId, setNumber) composite, with the same
 * first-slot-wins rule the prior facts use: on a duplicated exercise identity
 * only the first occurrence is keyed, on both sides, so a set can never be
 * diffed against a different slot's history.
 *
 * The declared `kind` carries onto every derived row — a set added inside an
 * amendment is part of that one declared intent, not a separate late entry the
 * db decided on its own.
 */
function deriveSetEvents(
  workoutId: string,
  userId: string,
  context: WorkoutChangeContext,
  priorSnapshots: Map<string, WorkoutSetSnapshot>,
  input: WorkoutInput,
): WorkoutEventInput[] {
  const events: WorkoutEventInput[] = []
  const seen = new Set<string>()
  for (const exercise of input.exercises) {
    for (const [index, set] of exercise.sets.entries()) {
      const after = snapshotFromInput(exercise, set, index + 1)
      const key = setSnapshotKey(after.source, after.wgerExerciseId, after.setNumber)
      if (seen.has(key)) continue
      seen.add(key)
      const before = priorSnapshots.get(key)
      if (before === undefined) {
        events.push({
          workoutId,
          userId,
          kind: context.kind,
          actor: context.actor,
          action: 'add_set',
          summary: `${describeSetSubject(after)} added`,
          after,
        })
        continue
      }
      const changed = diffSetSnapshots(before, after)
      if (changed.length === 0) continue
      events.push({
        workoutId,
        userId,
        kind: context.kind,
        actor: context.actor,
        action: 'update_set',
        summary: describeSetChange(before, after, changed),
        changed,
        before,
        after,
      })
    }
  }
  for (const [key, before] of priorSnapshots) {
    if (seen.has(key)) continue
    events.push({
      workoutId,
      userId,
      kind: context.kind,
      actor: context.actor,
      action: 'remove_set',
      summary: `${describeSetSubject(before)} removed`,
      before,
    })
  }
  return events
}

/**
 * Clears an owned workout's completion stamp, and says so in the log.
 *
 * The ONLY write in this module that walks `completedAt` backwards —
 * everything else coalesces, so completion has been set-once until now. The
 * instant that was cleared comes back, and it is what `recompleteWorkout`
 * must be handed to undo this: re-stamping with `now()` would quietly move a
 * session to today, the wrong-day corruption the provenance rules exist to
 * prevent.
 *
 * Null back means nothing was un-completed — missing, not owned, or already
 * incomplete. Idempotent by construction, so a double-tap writes one event.
 */
export async function uncompleteWorkout(
  userId: string,
  id: string,
  context: WorkoutChangeContext,
): Promise<{ completedAt: Date } | null> {
  return db.transaction(async (tx) => {
    // Read the stamp before clearing it: `returning()` gives the AFTER image,
    // and the whole point of this call is to hand the before image back for
    // the undo. Inside the transaction, so the read and the write agree.
    const [before] = await tx
      .select({ completedAt: workouts.completedAt })
      .from(workouts)
      .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
    if (!before || before.completedAt === null) return null

    const [row] = await tx
      .update(workouts)
      .set({ completedAt: null })
      .where(and(eq(workouts.id, id), eq(workouts.userId, userId), isNotNull(workouts.completedAt)))
      .returning({ id: workouts.id })
    if (!row) return null

    await recordWorkoutEvent(tx, {
      workoutId: id,
      userId,
      // An AMENDMENT, not a system write: this contradicts what the record
      // said — the session was finished, and now it is not.
      kind: 'amendment',
      actor: context.actor,
      action: 'uncomplete_workout',
      summary: 'Session marked not finished',
      changed: ['completedAt'],
      before: { completedAt: before.completedAt.toISOString() },
      after: { completedAt: null },
    })
    return { completedAt: before.completedAt }
  })
}

/**
 * Restores a completion stamp cleared by `uncompleteWorkout` — the undo half.
 *
 * `completedAt` is passed IN rather than defaulted to now(): the undo has to
 * put the session back on the day it happened, and the append-only log keeps
 * both moves rather than pretending neither did.
 *
 * Null back when the row is missing, not owned, or already complete.
 */
export async function recompleteWorkout(
  userId: string,
  id: string,
  completedAt: Date,
  context: WorkoutChangeContext,
): Promise<{ id: string } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(workouts)
      .set({ completedAt })
      .where(and(eq(workouts.id, id), eq(workouts.userId, userId), isNull(workouts.completedAt)))
      .returning({ id: workouts.id })
    if (!row) return null

    await recordWorkoutEvent(tx, {
      workoutId: id,
      userId,
      kind: 'amendment',
      actor: context.actor,
      action: 'recomplete_workout',
      summary: 'Session marked finished again',
      changed: ['completedAt'],
      before: { completedAt: null },
      after: { completedAt: completedAt.toISOString() },
    })
    return { id: row.id }
  })
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
 *
 * `context` declares WHO edited and WHAT the edit meant (see workout-events.ts
 * — the db layer must never guess). The changelog rows are derived from a
 * pre-delete before-image diffed against the incoming wire sets, so the full
 * replace still records the handful of sets the lifter actually meant to
 * change rather than "everything was rewritten".
 */
export async function updateWorkout(
  userId: string,
  id: string,
  input: WorkoutInput,
  context: WorkoutChangeContext,
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
        // The first FULL persist of this workout's contents is its original
        // record — an instantiated program day is a blank shell until one
        // lands. Coalesced, so later saves leave the first one standing, and
        // wall-clock for the same reason as saveWorkout. Unlike `completedAt`,
        // no set-level write touches this: `stampWorkoutCompleted` (the MCP
        // patch path) moves completion only, so an agent patching a live
        // session can never make the session's own first persist look like a
        // correction.
        originalRecordedAt: sql`coalesce(${workouts.originalRecordedAt}, now())`,
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
    // WIDENED for the change log: `priorFacts` alone is provenance only
    // (setType + prescribed_*) and cannot answer "what did the lifter
    // change?" — the performed columns (reps/weight/completed/rir/rpe and the
    // cardio trio) plus the exercise name ride along so the before-image
    // costs no second query.
    const priorRows = await tx
      .select({
        wgerExerciseId: workoutExercises.wgerExerciseId,
        source: workoutExercises.source,
        exerciseName: workoutExercises.name,
        setNumber: sets.setNumber,
        setType: sets.setType,
        prescribedLoadKg: sets.prescribedLoadKg,
        prescribedRepMin: sets.prescribedRepMin,
        prescribedRir: sets.prescribedRir,
        prescribedRpe: sets.prescribedRpe,
        reps: sets.reps,
        weight: sets.weight,
        completed: sets.completed,
        rir: sets.rir,
        rpe: sets.rpe,
        metricMode: sets.metricMode,
        durationSec: sets.durationSec,
        distanceM: sets.distanceM,
      })
      .from(sets)
      .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
      .where(eq(workoutExercises.workoutId, id))
      .orderBy(asc(workoutExercises.position), asc(sets.setNumber))
    const priorFacts = new Map<string, PriorSetFacts>()
    // The change log's before-image, keyed and first-slot-gated IDENTICALLY to
    // priorFacts: a duplicated exercise resolves to its first slot in both, so
    // the diff can never pair a set with another slot's history.
    const priorSnapshots = new Map<string, WorkoutSetSnapshot>()
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
        priorSnapshots.set(key, {
          source: row.source,
          wgerExerciseId: row.wgerExerciseId,
          exerciseName: row.exerciseName,
          setNumber: row.setNumber,
          reps: row.reps,
          weight: row.weight,
          completed: row.completed,
          rir: row.rir,
          rpe: row.rpe,
          metricMode: row.metricMode,
          durationSec: row.durationSec,
          distanceM: row.distanceM,
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

    // The change log LAST: everything above has to have succeeded for the
    // events to describe reality, and they ride the same transaction anyway.
    await recordWorkoutEvents(tx, deriveSetEvents(id, userId, context, priorSnapshots, input))
    return { id }
  })
}

/**
 * Resolves a workout-exercise (id + the identity the change log addresses it
 * by) only when the workout is owned by the user. The
 * join to `workouts.userId` is the ownership gate for every set-level edit below:
 * a caller can address a set only through an exercise that belongs to a workout
 * they own. Returns null when the workout isn't owned or no exercise sits at that
 * 0-based position.
 */
async function findOwnedExercise(
  tx: Tx,
  userId: string,
  workoutId: string,
  position: number,
): Promise<{
  id: string
  name: string
  source: ExerciseSource
  wgerExerciseId: number
} | null> {
  const [we] = await tx
    .select({
      id: workoutExercises.id,
      // The changelog's addressing — same query, no extra round trip.
      name: workoutExercises.name,
      source: workoutExercises.source,
      wgerExerciseId: workoutExercises.wgerExerciseId,
    })
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
  return we ?? null
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
 * Updates one set of an owned workout's exercise — any `SetPatch` field:
 * reps/weight, completion, rir/rpe, metric mode, duration, distance — addressed
 * by 0-based exercise `position` and 1-based `setNumber`. Returns null when the
 * patch is empty, the workout isn't owned, the position is absent, or no such set
 * exists — the tool layer turns that into a not-found. Throws
 * `SetCompletionError` when the patch would leave a completed set without its
 * required metric (see `assertPatchedSetCompletable`).
 *
 * The pre-write read is now UNCONDITIONAL (it used to run only for patches
 * that could break completion). A change log has no honest way around it: the
 * before-image of the row is the whole point, and `RETURNING` only ever sees
 * the after state. One indexed row read inside a transaction the call already
 * opens is the price of the record.
 *
 * `context` declares WHO and WHAT the write meant — this layer cannot tell an
 * agent logging mid-session from an agent correcting a week later, so it does
 * not try. A patch whose values all match the stored row logs nothing.
 */
export async function updateSet(
  userId: string,
  workoutId: string,
  exercisePosition: number,
  setNumber: number,
  patch: SetPatch,
  context: WorkoutChangeContext,
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
    const exercise = await findOwnedExercise(tx, userId, workoutId, exercisePosition)
    if (!exercise) return null
    const [row] = await tx
      .select({
        completed: sets.completed,
        reps: sets.reps,
        weight: sets.weight,
        rir: sets.rir,
        rpe: sets.rpe,
        durationSec: sets.durationSec,
        distanceM: sets.distanceM,
        metricMode: sets.metricMode,
        loggingType: workoutExercises.loggingType,
      })
      .from(sets)
      .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
      .where(and(eq(sets.workoutExerciseId, exercise.id), eq(sets.setNumber, setNumber)))
      .limit(1)
    if (!row) return null
    if (patchCanBreakCompletion(patch)) assertPatchedSetCompletable(row, patch)
    const [updated] = await tx
      .update(sets)
      .set(values)
      .where(and(eq(sets.workoutExerciseId, exercise.id), eq(sets.setNumber, setNumber)))
      .returning({ id: sets.id })
    if (!updated) return null
    await stampWorkoutCompleted(tx, workoutId)

    // loggingType is the completion gate's input, not a performed value —
    // it stays out of the snapshot.
    const before: WorkoutSetSnapshot = {
      source: exercise.source,
      wgerExerciseId: exercise.wgerExerciseId,
      exerciseName: exercise.name,
      setNumber,
      reps: row.reps,
      weight: row.weight,
      completed: row.completed,
      rir: row.rir,
      rpe: row.rpe,
      metricMode: row.metricMode,
      durationSec: row.durationSec,
      distanceM: row.distanceM,
    }
    // `values` is exactly the patch's present keys, so spreading it produces
    // the row the UPDATE just wrote — omitted keys keep the before value.
    const after: WorkoutSetSnapshot = { ...before, ...values }
    const changed = diffSetSnapshots(before, after)
    if (changed.length > 0) {
      await recordWorkoutEvent(tx, {
        workoutId,
        userId,
        // Which of the caller's two DECLARED words applies (see
        // `blankSubjectKind`): filling a set that held nothing records it for
        // the first time, writing over a logged value contradicts it. Read
        // off the before-image this call already fetched — a caller that
        // declared only `kind` gets `kind`, unchanged.
        kind:
          context.blankSubjectKind !== undefined && isBlankSetSnapshot(before)
            ? context.blankSubjectKind
            : context.kind,
        actor: context.actor,
        action: 'update_set',
        summary: describeSetChange(before, after, changed),
        changed,
        before,
        after,
      })
    }
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
  context: WorkoutChangeContext,
): Promise<{ setNumber: number } | null> {
  return db.transaction(async (tx) => {
    const exercise = await findOwnedExercise(tx, userId, workoutId, exercisePosition)
    if (!exercise) return null
    const exerciseId = exercise.id
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

    // A creation has no before-image and nothing in `changed` — the whole
    // subject IS the change. Values mirror the insert's own defaults.
    const after: WorkoutSetSnapshot = {
      source: exercise.source,
      wgerExerciseId: exercise.wgerExerciseId,
      exerciseName: exercise.name,
      setNumber,
      reps: patch.reps ?? null,
      weight: patch.weight ?? null,
      completed: patch.completed ?? false,
      rir: patch.rir ?? null,
      rpe: patch.rpe ?? null,
      metricMode: patch.metricMode ?? 'reps_weight',
      durationSec: patch.durationSec ?? null,
      distanceM: patch.distanceM ?? null,
    }
    await recordWorkoutEvent(tx, {
      workoutId,
      userId,
      kind: context.kind,
      actor: context.actor,
      action: 'add_set',
      summary: `${describeSetSubject(after)} added`,
      after,
    })
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
  context: WorkoutChangeContext,
): Promise<{ removed: true } | null> {
  return db.transaction(async (tx) => {
    const exercise = await findOwnedExercise(tx, userId, workoutId, exercisePosition)
    if (!exercise) return null
    const exerciseId = exercise.id
    // Capture the doomed set's facts BEFORE the delete: its notes must fall
    // back to the workout anchor (the cascade would eat them — the same
    // landmine updateWorkout's park/re-attach guards), with a snapshot
    // written from these facts when the note never had one.
    const [target] = await tx
      .select({
        id: sets.id,
        weight: sets.weight,
        reps: sets.reps,
        completed: sets.completed,
        rir: sets.rir,
        rpe: sets.rpe,
        metricMode: sets.metricMode,
        durationSec: sets.durationSec,
        distanceM: sets.distanceM,
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

    // A removal has no after-image; the before snapshot is the only record
    // the set ever existed, which is exactly why it must be captured.
    const before: WorkoutSetSnapshot = {
      source: exercise.source,
      wgerExerciseId: exercise.wgerExerciseId,
      exerciseName: target.exerciseName,
      setNumber,
      reps: target.reps,
      weight: target.weight,
      completed: target.completed,
      rir: target.rir,
      rpe: target.rpe,
      metricMode: target.metricMode,
      durationSec: target.durationSec,
      distanceM: target.distanceM,
    }
    await recordWorkoutEvent(tx, {
      workoutId,
      userId,
      kind: context.kind,
      actor: context.actor,
      action: 'remove_set',
      summary: `${describeSetSubject(before)} removed`,
      before,
    })
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
 * Updates only a workout's own metadata — name, startedAt, and/or the session
 * note (reconciled into its canonical notes-v2 row) — no exercise/set changes.
 * Ownership-gated even for a notes-only patch (see the in-body gate). Returns
 * null when the patch is empty or the user doesn't own the workout.
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
    const exerciseId = (await findOwnedExercise(tx, userId, workoutId, exercisePosition))?.id
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
