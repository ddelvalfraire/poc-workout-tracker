import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { resolveUserId } from './resolve-user'
import { jsonResult, errorResult } from './result'
import { ToolError } from './errors'
import { assertWorkoutIdShape } from './workout-id'
import { assertProgramIdShape } from './program-id'
import {
  listWorkoutSummaries,
  getWorkoutDetail,
  getLastPerformance,
  type WorkoutDetail,
} from '@/db/workouts'
import { getProgramDayDetail, type ProgramDayDetail } from '@/db/programs'
import { getProgramStats, type ProgramStats } from '@/db/program-stats'
import { getVolumeStatus } from '@/db/volume-progression'
import { listProgramEvents, PROGRAM_EVENTS_MAX_LIMIT } from '@/db/program-events'
import { getWeightUnit, getBodyweightKg } from '@/db/preferences'
import { searchExercises } from '@/lib/exercises/wger'
import { listCustomExercises } from '@/db/custom-exercises'
import { listExerciseNotesFor } from '@/db/exercise-notes'
import { notesForWorkout } from '@/db/notes'
import type { NoteAuthor } from '@/lib/notes/note-input'
import { kgToDisplay, type WeightUnit } from '@/lib/units'
import { bestScoredSet } from '@/lib/exercises/one-rep-max'
import type { LoggingType } from '@/lib/workout/workout-input'
import { buildProgramDayView, type ProgramDayView } from './program-tools'

/**
 * Registers the read tools — the agent's read-only window into a user's
 * training, program stats, and the exercise catalog.
 *
 * Each user-scoped tool funnels its `userId` through `resolveUserId` (the MCP
 * authorization boundary) and echoes the resolved id back so the agent can
 * confirm whose data it read. Weights are stored in kg and converted to the
 * user's unit at this boundary via `kgToDisplay`; the `unit` is echoed in every
 * payload so the agent isn't guessing the basis. `search_exercises` is the
 * partial exception — the wger catalog is public reference data, so it
 * resolves its `userId` best-effort: no identity degrades to the public
 * catalog instead of failing, while a resolved user gets their custom
 * exercises merged in.
 */
/** Descending string compare, so ids tiebreak the same way in the sort and in
 *  the cursor filter below. */
function compareDesc(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0
}

/**
 * Page size for `list_workouts` when the caller doesn't ask for one, and the
 * ceiling when it asks for too much.
 *
 * Bounded because a tool RESULT lands in message history, and message history
 * is the part of the prompt that never settles into a cache prefix (we cache
 * tools → system; see src/lib/coach/tool-policy.ts). A lifter training four
 * times a week for a year has ~200 sessions; returning all of them costs
 * roughly 12k tokens at full price, on every turn for the rest of the session,
 * to answer a question that "the last few workouts" almost always answers.
 * `before` is the escape hatch when the agent genuinely needs older history.
 */
export const WORKOUT_LIST_DEFAULT_LIMIT = 20
export const WORKOUT_LIST_MAX_LIMIT = 100

export function registerReadTools(server: McpServer): void {
  server.registerTool(
    'list_workouts',
    {
      title: 'List Workouts',
      description:
        `Lists the user's workouts (most recent first) with exercise and set counts. Returns at most ${WORKOUT_LIST_DEFAULT_LIMIT} by default (${WORKOUT_LIST_MAX_LIMIT} max) — check \`hasMore\`, and to page older sessions pass the LAST row's \`startedAt\` as \`before\` AND its id as \`beforeId\` (the compound cursor pages same-timestamp ties losslessly). Use to review recent training before drilling into one with get_workout.`,
      inputSchema: {
        limit: z.number().int().min(1).max(WORKOUT_LIST_MAX_LIMIT).optional(),
        before: z.string().datetime().optional(),
        beforeId: z.string().optional(),
        userId: z.string().optional(),
      },
    },
    async ({ limit, before, beforeId, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        // The db read is request-memoized: this bounds what crosses the
        // tool boundary into an agent's context, not what the query costs. App callers of listWorkoutSummaries still get the
        // whole history, which is what the history page and the home
        // momentum panel actually need.
        const rows = await listWorkoutSummaries(resolved)
        // Copy before sorting: listWorkoutSummaries is request-memoized, so
        // an in-place sort would reorder the array every other caller in this
        // request is holding.
        //
        // The query orders by startedAt alone, which leaves same-timestamp
        // rows in no fixed order — and same-timestamp rows are a SUPPORTED
        // state, not a freak one: import dedupes on (startedAt, name), so two
        // sessions imported with a date-only timestamp are two distinct
        // workouts sharing an instant. Without a tiebreak the cursor below
        // would skip one of them silently.
        const ordered = [...rows].sort(
          (a, b) => b.startedAt.getTime() - a.startedAt.getTime() || compareDesc(a.id, b.id),
        )
        const cutoff = before === undefined ? undefined : new Date(before)
        const matching =
          cutoff === undefined
            ? ordered
            : ordered.filter((r) => {
                const delta = r.startedAt.getTime() - cutoff.getTime()
                if (delta !== 0) return delta < 0
                // Same instant as the cursor row: only the ids that sort after
                // it survive, so a tie pages through losslessly instead of
                // dropping every row that shares the timestamp.
                return beforeId !== undefined && r.id < beforeId
              })
        const take = Math.min(limit ?? WORKOUT_LIST_DEFAULT_LIMIT, WORKOUT_LIST_MAX_LIMIT)
        const page = matching.slice(0, take)
        return jsonResult({
          userId: resolved,
          count: page.length,
          hasMore: matching.length > page.length,
          workouts: page.map((r) => ({
            ...r,
            startedAt: r.startedAt.toISOString(),
            completedAt: r.completedAt?.toISOString() ?? null,
          })),
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'get_workout',
    {
      title: 'Get Workout',
      description:
        "Returns one workout (owned by the user) with its exercises and sets, weights in the user's unit, plus a per-exercise estimated 1RM. Each set carries logged effort (`rir`/`rpe`) and its prescribed target (`prescribedRir`/`prescribedRpe`), null when absent. Includes the session `notes`, per exercise `notes` and `skipped` (skipped = the lifter didn't do this exercise that day; its sets stay uncompleted), and per set an optional `notes` list ({author, body} — set-anchored notes in reading order, present only when the set has any).",
      inputSchema: { id: z.string(), userId: z.string().optional() },
    },
    async ({ id, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertWorkoutIdShape(id)
        // Resolve the workout first; only fetch the unit once we know it exists,
        // so the not-found path does no wasted query.
        const workout = await getWorkoutDetail(resolved, id)
        if (!workout) {
          return errorResult(new ToolError(`Workout ${id} not found for user ${resolved}`))
        }
        // Bodyweight is fetched once per request, like the unit — it's the
        // load basis for any bodyweight-type exercise's estimated 1RM.
        // Identity notes ride the same round: one batched query for every
        // exercise in the workout (cheap — bounded by the exercise count).
        // notesForWorkout rides too — its set-anchored rows are the only tier
        // getWorkoutDetail's projection doesn't already surface.
        const [unit, bodyweightKg, noteRows, workoutNoteRows] = await Promise.all([
          getWeightUnit(resolved),
          getBodyweightKg(resolved),
          listExerciseNotesFor(
            resolved,
            workout.exercises.map((e) => ({ source: e.source, exerciseId: e.wgerExerciseId })),
          ),
          notesForWorkout(resolved, id),
        ])
        const identityNotes = new Map(
          noteRows.map((n) => [
            `${n.source}:${n.exerciseId}`,
            { body: n.body, pinned: n.pinned },
          ]),
        )
        // Set-anchored notes keyed by set id (reading order preserved). The
        // workout/exercise tiers are already projected into the detail's
        // `notes` fields, so only the set tier rides separately.
        const setNotes = new Map<string, { author: NoteAuthor; body: string }[]>()
        for (const note of workoutNoteRows) {
          if (note.setId === null) continue
          const list = setNotes.get(note.setId) ?? []
          setNotes.set(note.setId, [...list, { author: note.author, body: note.body }])
        }
        // When the workout was instantiated from a program day, overlay that day's
        // prescription (targets) — read from the program, never stored on the sets.
        const programDay = workout.programDayId
          ? await getProgramDayDetail(resolved, workout.programDayId)
          : null
        return jsonResult(
          buildWorkoutPayload(
            workout,
            resolved,
            unit,
            bodyweightKg,
            programDay ?? undefined,
            identityNotes,
            setNotes,
          ),
        )
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'search_exercises',
    {
      title: 'Search Exercises',
      description:
        "Searches the merged exercise catalog — the public wger catalog plus the user's custom exercises — by name and/or category. Every result carries `source` ('wger' | 'custom'): exercise identity is the composite (source, wgerExerciseId), so pass BOTH through to other tools.",
      inputSchema: {
        search: z.string().optional(),
        category: z.string().optional(),
        limit: z.number().int().positive().optional(),
        userId: z.string().optional(),
      },
    },
    async ({ search, category, limit, userId }, extra) => {
      try {
        const catalog = await searchExercises({ search, category, limit })
        // Customs merge best-effort. Two distinct degrade paths, deliberately
        // separated: an unresolvable USER (no auth context, no arg) is normal
        // and silent — search must not fail because identity couldn't be
        // established — but a db failure fetching a RESOLVED user's customs
        // is an error and gets logged before degrading.
        let customs: object[] = []
        let resolved: string | null = null
        try {
          resolved = resolveUserId(extra, userId)
        } catch {
          // No user in scope — public catalog only (pre-composite behavior).
        }
        if (resolved !== null) {
          try {
            const term = search?.trim().toLowerCase()
            customs = (await listCustomExercises(resolved))
              .filter(
                (c) =>
                  (!term || c.name.toLowerCase().includes(term)) &&
                  (!category || c.category === category),
              )
              .map((c) => ({
                id: c.id,
                source: 'custom' as const,
                name: c.name,
                category: c.category,
                ...(c.muscles && c.muscles.length > 0 ? { muscles: c.muscles } : {}),
                ...(c.musclesSecondary && c.musclesSecondary.length > 0
                  ? { musclesSecondary: c.musclesSecondary }
                  : {}),
              }))
          } catch (error: unknown) {
            console.error('search_exercises: customs merge failed', error)
          }
        }
        const labeled = catalog.map((e) => ({ ...e, source: 'wger' as const }))
        // Customs first (the user's own movements outrank catalog homonyms);
        // the caller's limit bounds the MERGED list, not just the wger leg.
        const merged = [...customs, ...labeled]
        const exercises = limit !== undefined ? merged.slice(0, limit) : merged
        return jsonResult({ count: exercises.length, exercises })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'get_last_performance',
    {
      title: 'Get Last Performance',
      description:
        "Returns the user's most recent prior performance of an exercise — when and the sets done, weights in the user's unit. Identity is the composite (source, wgerExerciseId); `source` defaults to 'wger', pass 'custom' for custom exercises. Use to answer \"what did I do last time?\".",
      inputSchema: {
        wgerExerciseId: z.number().int(),
        source: z.enum(['wger', 'custom']).optional(),
        userId: z.string().optional(),
        excludeWorkoutId: z.string().optional(),
      },
    },
    async ({ wgerExerciseId, source, userId, excludeWorkoutId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        const [last, unit] = await Promise.all([
          getLastPerformance(resolved, source ?? 'wger', wgerExerciseId, excludeWorkoutId),
          getWeightUnit(resolved),
        ])
        return jsonResult({
          userId: resolved,
          unit,
          wgerExerciseId,
          lastPerformance:
            last === null
              ? null
              : {
                  performedAt: last.performedAt.toISOString(),
                  sets: last.sets.map((s) => ({
                    reps: s.reps,
                    weight: s.weight === null ? null : kgToDisplay(s.weight, unit),
                  })),
                  // Identity note ride-along (markdown): the note that follows
                  // this exercise across workouts; null when none exists.
                  note: last.note,
                },
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'get_program_stats',
    {
      title: 'Get Program Stats',
      description:
        "Per-week adherence (started/completed days vs planned), volume (completed sets + tonnage), and per-exercise progression and PRs (first-week baseline vs best est. 1RM) for one program — the same numbers the app's stats page shows. Weights are in the user's unit. Only workouts started from the program's days count. Use to answer \"how's my program going?\".",
      inputSchema: { programId: z.string(), userId: z.string().optional() },
    },
    async ({ programId, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        // Resolve the stats first; only fetch the unit once we know the
        // program exists, matching get_workout's not-found economy.
        const stats = await getProgramStats(resolved, programId)
        if (!stats) {
          return errorResult(new ToolError(`Program ${programId} not found for user ${resolved}`))
        }
        const unit = await getWeightUnit(resolved)
        return jsonResult(buildProgramStatsPayload(stats, resolved, unit))
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'get_volume_status',
    {
      title: 'Get Volume Status',
      description:
        "Per-muscle weekly volume verdicts for one ACTIVE program with autoregulation on: 'increase' (a primary movement beat its rep-range top two consecutive completed weeks — a +1-set batch proposal is raised for the owner to confirm), 'hold' (two or more primary movements stalled — recovery signal, no proposal), or 'on-track'. Muscles without scorable evidence are absent. Also returns per-program-week credited set counts per muscle (primary 1.0 / secondary 0.5). `week` is the completed program week the verdicts speak about; null = nothing completed yet. Read-only aside from raising any due proposals; use to discuss whether volume should move.",
      inputSchema: { programId: z.string(), userId: z.string().optional() },
    },
    async ({ programId, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        // The coach/MCP read is a trigger site (plan §4): `raiseProposals`
        // runs the weekly check off this read's own computation (one shared
        // program/structure/verdict pass), so any due +1 proposal exists by
        // the time the agent references it. Best-effort — the raise can
        // never fail the read.
        const status = await getVolumeStatus(resolved, programId, { raiseProposals: true })
        if (!status) {
          return errorResult(new ToolError(`Program ${programId} not found for user ${resolved}`))
        }
        return jsonResult({
          userId: resolved,
          programId: status.programId,
          programName: status.programName,
          enabled: status.enabled,
          currentWeek: status.currentWeek,
          week: status.week,
          verdicts: status.verdicts.map((v) => ({
            muscle: v.group,
            status: v.status,
            drivers: v.drivers,
            candidate:
              v.candidate === null
                ? null
                : {
                    name: v.candidate.name,
                    dayPosition: v.candidate.address.dayPosition,
                    exercisePosition: v.candidate.address.exercisePosition,
                  },
          })),
          weeks: status.weeks.map((w) => ({
            week: w.week,
            muscles: w.groups.map((g) => ({ muscle: g.group, sets: g.sets })),
          })),
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'list_program_changes',
    {
      title: 'List Program Changes',
      description:
        'The append-only change log for one program — every plan edit (from the app UI, an MCP agent, or the coach), newest first, each with the actor, action, a one-line summary, and a minimal before/after payload. To page older events pass the LAST row\'s occurredAt as `before` AND its id as `beforeId` (the compound cursor pages same-timestamp ties losslessly). Use to answer "what changed on my program, and who changed it?".',
      inputSchema: {
        programId: z.string(),
        limit: z.number().int().min(1).max(PROGRAM_EVENTS_MAX_LIMIT).optional(),
        before: z.string().datetime().optional(),
        beforeId: z.string().uuid().optional(),
        userId: z.string().optional(),
      },
    },
    async ({ programId, limit, before, beforeId, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(programId)
        const events = await listProgramEvents(resolved, programId, {
          limit,
          before: before === undefined ? undefined : new Date(before),
          beforeId,
        })
        return jsonResult({
          userId: resolved,
          programId,
          events: events.map((event) => ({
            id: event.id,
            occurredAt: event.occurredAt.toISOString(),
            actor: event.actor,
            action: event.action,
            summary: event.summary,
            payload: event.payload,
          })),
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'get_weight_unit',
    {
      title: 'Get Weight Unit',
      description:
        "Returns the user's stored weight unit ('kg' or 'lb'). The basis for every weight the other tools return.",
      inputSchema: { userId: z.string().optional() },
    },
    async ({ userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        const unit = await getWeightUnit(resolved)
        return jsonResult({ userId: resolved, unit })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )
}

/**
 * Projects `ProgramStats` (kg-domain) into the agent-facing payload: every
 * weight through `kgToDisplay`, counts/weeks/reps verbatim. `tonnageKg` is
 * renamed `tonnage` because the value is no longer kg for lb users, and the
 * per-set `index` inside ScoredBestSet is dropped — it addresses an internal
 * list the agent never sees.
 */
function buildProgramStatsPayload(stats: ProgramStats, resolved: string, unit: WeightUnit) {
  return {
    userId: resolved,
    unit,
    program: stats.program,
    currentWeek: stats.currentWeek,
    weeks: stats.weeks.map(({ tonnageKg, ...week }) => ({
      ...week,
      tonnage: kgToDisplay(tonnageKg, unit),
    })),
    exercises: stats.exercises.map((exercise) => ({
      wgerExerciseId: exercise.wgerExerciseId,
      source: exercise.source,
      name: exercise.name,
      loggingType: exercise.loggingType,
      weeks: exercise.weeks.map((point) => ({
        week: point.week,
        completedSets: point.completedSets,
        best:
          point.best === null
            ? null
            : point.best.kind === 'e1rm'
              ? {
                  kind: 'e1rm' as const,
                  reps: point.best.reps,
                  // The EFFECTIVE load (bodyweight-aware), not the stored column.
                  weight: kgToDisplay(point.best.weightKg, unit),
                  e1rm: kgToDisplay(point.best.e1rm, unit),
                }
              : { kind: 'reps' as const, reps: point.best.reps },
      })),
      pr:
        exercise.pr === null
          ? null
          : {
              baseline: convertPRPoint(exercise.pr.baseline, unit),
              best: convertPRPoint(exercise.pr.best, unit),
            },
    })),
  }
}

function convertPRPoint(
  point: { week: number; reps: number; e1rm: number },
  unit: WeightUnit,
): { week: number; reps: number; e1rm: number } {
  return { week: point.week, reps: point.reps, e1rm: kgToDisplay(point.e1rm, unit) }
}

/**
 * The agent-facing shape of a single workout — what the `get_workout` tool and
 * the `workout://{id}` resource both return. Weights are in the user's display
 * unit; `startedAt` is an ISO string.
 */
export interface WorkoutPayload {
  userId: string
  unit: WeightUnit
  workout: {
    id: string
    name: string | null
    // Free-form session note (null = none), emitted like the other nullable fields.
    notes: string | null
    startedAt: string
    // Provenance: the program day this workout was instantiated from (null for
    // ad-hoc workouts). `plan` carries that day's prescription as a read overlay.
    programDayId: string | null
    programWeek: number | null
    // What the day was CALLED when this session was trained, frozen at
    // instantiation. Still names the session after the day is deleted (when
    // `programDayId` and `plan` are both gone), and never re-labels history
    // when the plan is renamed. Null on ad-hoc sessions and on rows logged
    // before the column existed — deliberately never backfilled from the
    // day's current name, which is not evidence of its name back then.
    programDayName: string | null
    programDayPosition: number | null
    plan?: ProgramDayView
    exercises: {
      id: string
      wgerExerciseId: number
      name: string
      position: number
      // How the sets' weights read (total / ignored / added / assistance).
      loggingType: LoggingType
      // Free-form per-exercise note (null = none).
      notes: string | null
      // The user's exercise-IDENTITY note (markdown; follows the exercise
      // across workouts). Present only on surfaces that fetch it (the
      // get_workout tool); null = no note for this identity.
      identityNote?: { body: string; pinned: boolean } | null
      // Marked skipped in-session ("didn't do this today"); the sets stay uncompleted.
      skipped: boolean
      sets: {
        setNumber: number
        reps: number | null
        weight: number | null
        completed: boolean
        // Logged effort and its prescribed target — unitless, null when absent.
        rir: number | null
        rpe: number | null
        prescribedRir: number | null
        prescribedRpe: number | null
        // Set-anchored notes in reading order — present only when the set has
        // any (and only on surfaces that fetch them, i.e. the get_workout tool).
        notes?: { author: NoteAuthor; body: string }[]
      }[]
      estimated1RM: number | null
      // Additive rep-fallback readout: the best set's rep count when nothing
      // is load-scorable (BW type without a stored bodyweight, or no weights
      // logged) — estimated1RM stays null in that case.
      bestReps?: number
    }[]
  }
}

/**
 * Projects a `WorkoutDetail` into the agent-facing payload: weights rendered in
 * the user's unit, ISO `startedAt`, and a per-exercise estimated 1RM. Shared by
 * the `get_workout` tool and the `workout://{id}` resource so both emit the exact
 * same shape from one source of truth.
 */
export function buildWorkoutPayload(
  workout: WorkoutDetail,
  resolved: string,
  unit: WeightUnit,
  bodyweightKg: number | null,
  programDay?: ProgramDayDetail,
  /** Identity notes keyed `${source}:${wgerExerciseId}` — when provided, each
   *  exercise carries its `identityNote` (null = none). The resource path
   *  omits the map and stays byte-identical to its pre-notes shape. */
  identityNotes?: Map<string, { body: string; pinned: boolean }>,
  /** Set-anchored notes keyed by set id — when provided, a set with entries
   *  carries them as `notes` (omitted otherwise: minimal wire shape). The
   *  resource path omits the map and stays byte-identical, like identityNotes. */
  setNotes?: Map<string, { author: NoteAuthor; body: string }[]>,
): WorkoutPayload {
  return {
    userId: resolved,
    unit,
    workout: {
      id: workout.id,
      name: workout.name,
      notes: workout.notes,
      startedAt: workout.startedAt.toISOString(),
      programDayId: workout.programDayId,
      programWeek: workout.programWeek,
      programDayName: workout.programDayName,
      programDayPosition: workout.programDayPosition,
      ...(programDay ? { plan: buildProgramDayView(programDay, unit) } : {}),
      exercises: workout.exercises.map((exercise) => ({
        id: exercise.id,
        wgerExerciseId: exercise.wgerExerciseId,
        name: exercise.name,
        position: exercise.position,
        loggingType: exercise.loggingType,
        notes: exercise.notes,
        ...(identityNotes !== undefined
          ? {
              identityNote:
                identityNotes.get(`${exercise.source}:${exercise.wgerExerciseId}`) ?? null,
            }
          : {}),
        skipped: exercise.skipped,
        sets: exercise.sets.map((s) => {
          const noteList = setNotes?.get(s.id)
          return {
            setNumber: s.setNumber,
            reps: s.reps,
            weight: s.weight === null ? null : kgToDisplay(s.weight, unit),
            completed: s.completed,
            // Logged effort + its prescribed-at-instantiation target — unitless
            // scales, so no display conversion. Null when not logged/prescribed.
            rir: s.rir,
            rpe: s.rpe,
            prescribedRir: s.prescribedRir,
            prescribedRpe: s.prescribedRpe,
            ...(noteList !== undefined && noteList.length > 0 ? { notes: noteList } : {}),
          }
        }),
        ...scoreExercise(exercise.sets, exercise.loggingType, bodyweightKg, unit),
      })),
    },
  }
}

/**
 * Best-set scoring for one exercise, in the user's unit. e1rm winners keep the
 * historical shape (`estimated1RM`, null otherwise); the rep fallback — no
 * load-scorable set — adds `bestReps` so the agent still sees a top set.
 */
function scoreExercise(
  sets: readonly { reps: number | null; weight: number | null }[],
  loggingType: LoggingType,
  bodyweightKg: number | null,
  unit: WeightUnit,
): { estimated1RM: number | null; bestReps?: number } {
  const best = bestScoredSet(sets, loggingType, bodyweightKg)
  if (best === null) return { estimated1RM: null }
  return best.kind === 'e1rm'
    ? { estimated1RM: kgToDisplay(best.e1rm, unit) }
    : { estimated1RM: null, bestReps: best.reps }
}
