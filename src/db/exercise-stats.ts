import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { bestScoredSet, effectiveLoadKg, estimate1RM } from '@/lib/one-rep-max'
import type { LoggingType } from '@/lib/workout-input'
import { db } from './index'
import { getBodyweightKg } from './preferences'
import { workouts, workoutExercises, sets } from './schema'

/**
 * Read-only ALL-TIME aggregates for ONE exercise across a user's COMPLETED
 * workouts — records, per-session e1RM trend, and paginated session history.
 *
 * Like `db/program-stats.ts`, this module sits on the authorization boundary:
 * the app has no Postgres row-level security, so every query here filters by
 * `user_id`. Callers (exercise pages, logger sheet, PR detection) must go
 * through these functions rather than joining the tables directly.
 *
 * Exercise identity is the composite (source, id) — a custom exercise's
 * identity id can equal a wger id, and the two must never merge. Scoring only
 * counts sets with `completed = true` inside workouts with `completedAt` set
 * (completed-only is the standing invariant); the session HISTORY, by
 * contrast, shows every set of those workouts — display truth, not scoring
 * truth. All weights stay canonical kg — display converts, this module never
 * does.
 */

/** The flat query shape — one row per set of the exercise, ascending by
 *  session start, then exercise position, then set number. */
export interface ExerciseStatsRow {
  workoutId: string
  startedAt: Date
  reps: number | null
  weight: number | null // kg
  completed: boolean
  metricMode: string
  /** 'working' | 'warmup' — warm-ups are display truth, never scoring truth. */
  setType: string
}

/** One record-holding set (kg, full precision; round only at display). */
export interface ExerciseRecordSet {
  workoutId: string
  performedAt: Date
  reps: number
  /** The EFFECTIVE load (see `effectiveLoadKg`) — for weight_reps exercises
   *  this is the stored weight; for bodyweight types it includes bodyweight. */
  weightKg: number
  e1rm: number
}

/** All-time bests. Every field is independent: a rep-fallback-only history
 *  (bodyweight work with no stored bodyweight) has null load records but may
 *  still hold `mostReps`. Ties keep the earliest occurrence, matching
 *  `bestScoredSet`'s strictly-greater policy. */
export interface ExerciseRecords {
  bestE1rm: ExerciseRecordSet | null
  heaviestLoadKg: ExerciseRecordSet | null
  mostReps: { workoutId: string; performedAt: Date; reps: number } | null
  /** Σ reps × weight per session over completed reps_weight sets with BOTH
   *  non-null (same rule as program-stats tonnage). */
  bestSessionVolumeKg: { workoutId: string; performedAt: Date; volumeKg: number } | null
}

/** One session's best e1RM — the chart series. */
export interface ExerciseTrendPoint {
  workoutId: string
  performedAt: Date
  e1rm: number
}

export interface ExerciseAllTimeStats {
  exercise: {
    wgerExerciseId: number
    source: ExerciseSource
    name: string
    loggingType: LoggingType
  }
  /** Distinct completed workouts with ≥1 completed set of this exercise. */
  totalSessions: number
  totalCompletedSets: number
  records: ExerciseRecords
  /** Sparse, ascending by session start: only e1rm-scorable sessions appear. */
  trend: ExerciseTrendPoint[]
}

/** Pagination guard: the module caps its own page size — callers are server
 *  components, but reads still guard their inputs. */
const MAX_SESSIONS_PAGE = 50

/**
 * Pure aggregation over the flat rows — exported for tests. Builds fresh
 * structures throughout; never mutates its inputs. Rows must arrive in
 * ascending session-start order (the query's orderBy) so strictly-greater
 * comparisons keep ties on the earliest session.
 */
export function aggregateExerciseStats(
  rows: readonly ExerciseStatsRow[],
  loggingType: LoggingType,
  // The load basis for bodyweight-type scoring. The CURRENT stored bodyweight
  // scores ALL history — accepted drift, same trade-off as program-stats.
  bodyweightKg: number | null = null,
): Pick<ExerciseAllTimeStats, 'totalSessions' | 'totalCompletedSets' | 'records' | 'trend'> {
  // Warm-ups are excluded from ALL scoring (records, trend, tonnage, counts)
  // — same rule as live PR detection, so the stats page and the in-session
  // banner can never disagree. History rendering is a separate query and
  // still shows them.
  const completedRows = rows.filter((row) => row.completed && row.setType !== 'warmup')

  // Group by session, preserving input (session-start) order.
  const bySession = new Map<string, { performedAt: Date; rows: ExerciseStatsRow[] }>()
  for (const row of completedRows) {
    if (!bySession.has(row.workoutId)) {
      bySession.set(row.workoutId, { performedAt: row.startedAt, rows: [] })
    }
    bySession.get(row.workoutId)!.rows.push(row)
  }

  let bestE1rm: ExerciseRecordSet | null = null
  let heaviestLoadKg: ExerciseRecordSet | null = null
  let mostReps: ExerciseRecords['mostReps'] = null
  let bestSessionVolumeKg: ExerciseRecords['bestSessionVolumeKg'] = null
  const trend: ExerciseTrendPoint[] = []

  for (const [workoutId, session] of bySession) {
    // Load scoring reads only reps_weight-METRIC rows: duration rows carry no
    // load, and duration records are deliberately out of scope here.
    const scorableRows = session.rows.filter((row) => row.metricMode === 'reps_weight')
    const best = bestScoredSet(scorableRows, loggingType, bodyweightKg)
    if (best?.kind === 'e1rm') {
      trend.push({ workoutId, performedAt: session.performedAt, e1rm: best.e1rm })
      if (bestE1rm === null || best.e1rm > bestE1rm.e1rm) {
        bestE1rm = {
          workoutId,
          performedAt: session.performedAt,
          reps: best.reps,
          weightKg: best.weightKg,
          e1rm: best.e1rm,
        }
      }
    }

    let sessionVolume = 0
    for (const row of session.rows) {
      // Every record is reps_weight-gated — nothing in the write path forces
      // reps null on duration rows, so stray reps there must not claim the
      // rep record any more than the load ones.
      if (row.metricMode !== 'reps_weight') continue
      // Same guard as the rep fallback in bestScoredSet: reps must be a
      // positive integer to count as a rep record.
      if (row.reps !== null && Number.isInteger(row.reps) && row.reps >= 1) {
        if (mostReps === null || row.reps > mostReps.reps) {
          mostReps = { workoutId, performedAt: session.performedAt, reps: row.reps }
        }
      }
      const load = effectiveLoadKg(loggingType, row.weight, bodyweightKg)
      const e1rm = estimate1RM(row.reps, load)
      if (e1rm !== null && (heaviestLoadKg === null || (load as number) > heaviestLoadKg.weightKg)) {
        heaviestLoadKg = {
          workoutId,
          performedAt: session.performedAt,
          reps: row.reps as number,
          weightKg: load as number,
          e1rm,
        }
      }
      // Tonnage stays RAW stored weight (not effective load), matching the
      // program-stats rule — and is therefore only meaningful for weight_reps.
      if (row.reps !== null && row.weight !== null) {
        sessionVolume += row.reps * row.weight
      }
    }
    if (
      sessionVolume > 0 &&
      (bestSessionVolumeKg === null || sessionVolume > bestSessionVolumeKg.volumeKg)
    ) {
      bestSessionVolumeKg = { workoutId, performedAt: session.performedAt, volumeKg: sessionVolume }
    }
  }

  return {
    totalSessions: bySession.size,
    totalCompletedSets: completedRows.length,
    records: { bestE1rm, heaviestLoadKg, mostReps, bestSessionVolumeKg },
    trend,
  }
}

/**
 * All-time stats for one exercise, or null when the user has no completed
 * history of it (callers render an empty state, never a zeroed record board).
 */
export async function getExerciseStats(
  userId: string,
  source: ExerciseSource,
  wgerExerciseId: number,
): Promise<ExerciseAllTimeStats | null> {
  const [bodyweightKg, rows] = await Promise.all([
    getBodyweightKg(userId),
    db
      .select({
        workoutId: workouts.id,
        startedAt: workouts.startedAt,
        exerciseName: workoutExercises.name,
        loggingType: workoutExercises.loggingType,
        reps: sets.reps,
        weight: sets.weight,
        completed: sets.completed,
        metricMode: sets.metricMode,
        setType: sets.setType,
      })
      .from(sets)
      .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
      .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
      .where(
        and(
          eq(workouts.userId, userId),
          eq(workoutExercises.wgerExerciseId, wgerExerciseId),
          eq(workoutExercises.source, source),
          isNotNull(workouts.completedAt),
        ),
      )
      .orderBy(asc(workouts.startedAt), asc(workoutExercises.position), asc(sets.setNumber)),
  ])
  if (rows.length === 0) return null

  // Latest non-null denormalized name wins (renames converge); loggingType
  // follows the same rule so scoring tracks the current setting — the same
  // policy as program-stats. The null guards are defensive-only on this path:
  // unlike program-stats' left joins, the inner join makes both NOT NULL.
  let name = ''
  let loggingType: LoggingType = 'weight_reps'
  for (const row of rows) {
    if (row.exerciseName !== null) name = row.exerciseName
    if (row.loggingType !== null) loggingType = row.loggingType
  }

  return {
    exercise: { wgerExerciseId, source, name, loggingType },
    ...aggregateExerciseStats(rows, loggingType, bodyweightKg),
  }
}

/** One page entry of the exercise's session history — every set shown,
 *  including uncompleted and duration-mode rows (display truth). */
export interface ExerciseSession {
  workoutId: string
  workoutName: string | null
  performedAt: Date
  sets: {
    setNumber: number
    reps: number | null
    weight: number | null // kg
    completed: boolean
    metricMode: string
    /** 'working' | 'warmup' — lets display surfaces keep the "warm-ups never
     *  score" invariant when marking a session's best set. */
    setType: string
    durationSec: number | null
    distanceM: number | null
  }[]
}

/**
 * Session-grouped history of one exercise, newest first, paginated. Same
 * scoping as `getExerciseStats` (owner, composite identity, completed
 * workouts only). Two-step like `getLastPerformance`: page the workouts,
 * then fetch their set rows.
 */
export async function getExerciseSessions(
  userId: string,
  source: ExerciseSource,
  wgerExerciseId: number,
  opts: { limit: number; offset: number },
): Promise<ExerciseSession[]> {
  // NaN/Infinity would sail through Math.min/max — normalize first.
  const limit = Number.isFinite(opts.limit)
    ? Math.min(Math.max(1, Math.floor(opts.limit)), MAX_SESSIONS_PAGE)
    : MAX_SESSIONS_PAGE
  const offset = Number.isFinite(opts.offset) ? Math.max(0, Math.floor(opts.offset)) : 0

  const page = await db
    .select({
      workoutId: workouts.id,
      workoutName: workouts.name,
      performedAt: workouts.startedAt,
    })
    .from(workouts)
    .innerJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id))
    .where(
      and(
        eq(workouts.userId, userId),
        eq(workoutExercises.wgerExerciseId, wgerExerciseId),
        eq(workoutExercises.source, source),
        isNotNull(workouts.completedAt),
      ),
    )
    // groupBy dedupes a workout that holds the exercise twice (two slots →
    // one session entry), the same way listWorkouts collapses its joins.
    .groupBy(workouts.id)
    // The id tiebreaker keeps pagination stable when two sessions share a
    // startedAt — without it, ties can duplicate or drop across pages.
    .orderBy(desc(workouts.startedAt), desc(workouts.id))
    .limit(limit)
    .offset(offset)
  if (page.length === 0) return []

  const setRows = await db
    .select({
      workoutId: workoutExercises.workoutId,
      setNumber: sets.setNumber,
      reps: sets.reps,
      weight: sets.weight,
      completed: sets.completed,
      metricMode: sets.metricMode,
      setType: sets.setType,
      durationSec: sets.durationSec,
      distanceM: sets.distanceM,
    })
    .from(sets)
    .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
    .where(
      and(
        inArray(
          workoutExercises.workoutId,
          page.map((p) => p.workoutId),
        ),
        eq(workoutExercises.wgerExerciseId, wgerExerciseId),
        eq(workoutExercises.source, source),
      ),
    )
    .orderBy(asc(workoutExercises.position), asc(sets.setNumber))

  // Page order (newest first) is the display order; sets group under their
  // session in position/setNumber order from the query.
  return page.map((p) => ({
    workoutId: p.workoutId,
    workoutName: p.workoutName,
    performedAt: p.performedAt,
    sets: setRows
      .filter((s) => s.workoutId === p.workoutId)
      .map((s) => ({
        setNumber: s.setNumber,
        reps: s.reps,
        weight: s.weight,
        completed: s.completed,
        metricMode: s.metricMode,
        setType: s.setType,
        durationSec: s.durationSec,
        distanceM: s.distanceM,
      })),
  }))
}

/** One occurrence of an exercise in a completed workout — the flat row the
 *  library list aggregates over. Set fields are nullable because the query
 *  LEFT-joins `sets`: an occurrence with no logged sets still lists. */
export interface LoggedExerciseRow {
  wgerExerciseId: number
  source: ExerciseSource
  name: string
  workoutId: string
  startedAt: Date
  loggingType: LoggingType
  reps: number | null
  weight: number | null // kg
  completed: boolean | null
  metricMode: string | null
  setType: string | null
}

/** One library entry. `sessionCount` counts completed workouts CONTAINING the
 *  exercise (occurrence-level) — it can differ from `totalSessions` (which
 *  requires ≥1 COMPLETED set); the LEFT join keeps set-less occurrences.
 *  The e1RM fields are the /exercises alive-row facts; all null when no set
 *  of the exercise is e1RM-scorable (rows degrade to session count). */
export interface LoggedExercise {
  wgerExerciseId: number
  source: ExerciseSource
  name: string
  sessionCount: number
  lastPerformedAt: Date
  /** All-time best e1RM (kg, full precision; round only at display). */
  bestE1rmKg: number | null
  /** Best e1RM of the last 30 days minus the best of the 30 days before
   *  that — the row's trend delta (kg). Null when EITHER window has no
   *  scorable session: a delta with no baseline is no delta at all. */
  trendDeltaKg: number | null
  /** When the running-max e1RM last advanced — the MOVING-zone signal. */
  lastPrAt: Date | null
}

/** The trend windows: best-of-last-30d vs best-of-the-prior-30d. */
const TREND_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Pure aggregation over the left-joined rows — exported for tests. Groups by
 * the composite identity, latest name/loggingType win, newest-trained first.
 * Scoring reuses `bestScoredSet` (e1RM is deliberately NOT re-derived in SQL
 * — the logging-type weight semantics live in one place) over completed
 * working reps_weight sets, per session, in ascending order so `lastPrAt`
 * and the strictly-greater tie policy match `aggregateExerciseStats`.
 * Builds fresh structures; never mutates its inputs. Rows must arrive
 * ascending by session start (the query's orderBy).
 */
export function aggregateLoggedExercises(
  rows: readonly LoggedExerciseRow[],
  bodyweightKg: number | null = null,
  now: Date = new Date(),
): LoggedExercise[] {
  interface SessionAcc {
    performedAt: Date
    sets: { reps: number | null; weight: number | null }[]
  }
  interface Acc {
    wgerExerciseId: number
    source: ExerciseSource
    name: string
    loggingType: LoggingType
    workoutIds: Set<string>
    lastPerformedAt: Date
    /** Insertion-ordered (= ascending session start) scorable sets. */
    sessions: Map<string, SessionAcc>
  }
  // Keyed by the composite identity: a custom exercise's identity id can
  // collide with a wger id, and the two must never merge into one entry.
  const byExercise = new Map<string, Acc>()
  for (const row of rows) {
    const key = `${row.source}:${row.wgerExerciseId}`
    const existing = byExercise.get(key)
    const acc: Acc = existing ?? {
      wgerExerciseId: row.wgerExerciseId,
      source: row.source,
      name: row.name,
      loggingType: row.loggingType,
      workoutIds: new Set(),
      lastPerformedAt: row.startedAt,
      sessions: new Map(),
    }
    if (!existing) byExercise.set(key, acc)
    acc.name = row.name // ascending input order → last write is the latest
    acc.loggingType = row.loggingType // same latest-wins rule as getExerciseStats
    acc.workoutIds.add(row.workoutId)
    if (row.startedAt > acc.lastPerformedAt) acc.lastPerformedAt = row.startedAt
    // Scoring truth: completed working reps_weight sets only — the same gate
    // as aggregateExerciseStats, so list and detail can never disagree.
    if (row.completed === true && row.setType !== 'warmup' && row.metricMode === 'reps_weight') {
      let session = acc.sessions.get(row.workoutId)
      if (!session) {
        session = { performedAt: row.startedAt, sets: [] }
        acc.sessions.set(row.workoutId, session)
      }
      session.sets.push({ reps: row.reps, weight: row.weight })
    }
  }

  const recentStart = now.getTime() - TREND_WINDOW_MS
  const priorStart = recentStart - TREND_WINDOW_MS

  return [...byExercise.values()]
    .map((acc) => {
      let bestE1rmKg: number | null = null
      let lastPrAt: Date | null = null
      let bestRecent: number | null = null
      let bestPrior: number | null = null
      for (const session of acc.sessions.values()) {
        const best = bestScoredSet(session.sets, acc.loggingType, bodyweightKg)
        if (best?.kind !== 'e1rm') continue
        // Strictly-greater: a tied session is a repeat, not a new PR.
        if (bestE1rmKg === null || best.e1rm > bestE1rmKg) {
          bestE1rmKg = best.e1rm
          lastPrAt = session.performedAt
        }
        const at = session.performedAt.getTime()
        if (at >= recentStart) {
          if (bestRecent === null || best.e1rm > bestRecent) bestRecent = best.e1rm
        } else if (at >= priorStart) {
          if (bestPrior === null || best.e1rm > bestPrior) bestPrior = best.e1rm
        }
      }
      return {
        wgerExerciseId: acc.wgerExerciseId,
        source: acc.source,
        name: acc.name,
        sessionCount: acc.workoutIds.size,
        lastPerformedAt: acc.lastPerformedAt,
        bestE1rmKg,
        trendDeltaKg: bestRecent !== null && bestPrior !== null ? bestRecent - bestPrior : null,
        lastPrAt,
      }
    })
    .sort((a, b) => b.lastPerformedAt.getTime() - a.lastPerformedAt.getTime())
}

/** The library query builder, exported for SQL-shape tests (`.toSQL()`).
 *  LEFT join on `sets` on purpose: the list is navigation first — an
 *  exercise whose workouts hold no set rows must still appear
 *  (occurrence-level sessionCount), while the set columns feed the
 *  alive-row scoring above. One flat query over the user's completed
 *  history; the windowed trend comparison happens in the pure aggregate,
 *  where `bestScoredSet` already owns the e1RM semantics. */
export function loggedExercisesQuery(userId: string) {
  return db
    .select({
      wgerExerciseId: workoutExercises.wgerExerciseId,
      source: workoutExercises.source,
      name: workoutExercises.name,
      workoutId: workoutExercises.workoutId,
      startedAt: workouts.startedAt,
      loggingType: workoutExercises.loggingType,
      reps: sets.reps,
      weight: sets.weight,
      completed: sets.completed,
      metricMode: sets.metricMode,
      setType: sets.setType,
    })
    .from(workoutExercises)
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .leftJoin(sets, eq(sets.workoutExerciseId, workoutExercises.id))
    .where(and(eq(workouts.userId, userId), isNotNull(workouts.completedAt)))
    .orderBy(asc(workouts.startedAt), asc(workoutExercises.position), asc(sets.setNumber))
}

/** Every exercise the user has trained in a completed workout, newest first,
 *  with best-e1RM + trend facts — the /exercises library list. Same authz
 *  scoping as the rest of the module; bodyweight fetched like
 *  `getExerciseStats` so bodyweight-type exercises score identically. */
export async function listLoggedExercises(userId: string): Promise<LoggedExercise[]> {
  const [bodyweightKg, rows] = await Promise.all([
    getBodyweightKg(userId),
    loggedExercisesQuery(userId),
  ])
  return aggregateLoggedExercises(rows, bodyweightKg, new Date())
}
