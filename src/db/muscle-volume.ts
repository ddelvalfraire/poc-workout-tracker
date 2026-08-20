import { and, eq, gte, isNotNull } from 'drizzle-orm'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { MUSCLE_GROUPS, muscleGroupFor, type MuscleGroup } from '@/lib/muscle-groups'
import { cache } from 'react'
import { inWindow, volumeWindows, type VolumeWindows } from '@/lib/volume-window'
import { getAllExercises } from '@/lib/wger'
import { isTechniqueKind, stageVolumeWeight, type SetTechnique } from '@/lib/technique'
import { db } from './index'
import { listCustomExercises } from './custom-exercises'
import { workouts, workoutExercises, sets } from './schema'

/**
 * Weekly training volume per muscle group — sets counted with the standard
 * hypertrophy credit rule (primary muscles 1.0, secondaries 0.5 per set),
 * each set first weighted by what it is worth as a HARD set: an ordinary set
 * is 1.0, and a technique group's rows share a weight instead of counting
 * three times (lib/technique.ts `stageVolumeWeight`).
 *
 * Like the other stats modules, this sits on the authorization boundary
 * (no RLS — every query filters by user_id) and counts only completed sets
 * inside completed workouts. Muscle identity comes from the CATALOG (the
 * cached wger map + the user's custom exercises), not program provenance —
 * that's what makes ad-hoc workouts count. Volume is set COUNTS, never
 * tonnage: the literature's unit.
 */

/** One completed-set row inside the fetched horizon. */
export interface MuscleVolumeRow {
  workoutId: string
  startedAt: Date
  wgerExerciseId: number
  source: ExerciseSource
  metricMode: string
  /** Logged seconds on duration-mode rows (cardio-minutes total); optional
   *  so pre-cardio fixtures keep their shape. */
  durationSec?: number | null
  /** Technique grouping columns — optional so pre-technique fixtures keep
   *  their shape; a half-written pair reads as an ordinary set. */
  techniqueKind?: string | null
  stageIndex?: number | null
}

/** Muscles an exercise trains, as catalog names (not yet bucketed). Null =
 *  exercise unknown to the catalog — its sets land in 'Other'. */
export type MuscleResolver = (
  source: ExerciseSource,
  wgerExerciseId: number,
) => { primary: string[]; secondary: string[] } | null

/** 'Other' is the honesty bucket: unknown exercises and unmapped muscle
 *  names, shown rather than silently dropped. */
export type VolumeGroup = MuscleGroup | 'Other'

export interface MuscleGroupVolume {
  group: VolumeGroup
  /** Credited sets (primary 1.0 / secondary 0.5) — halves are real values. */
  currentSets: number
  previousSets: number
}

export interface MuscleVolume {
  /** All ten groups in display order, always present; 'Other' appended only
   *  when it has volume in either window. */
  groups: MuscleGroupVolume[]
  totals: {
    /** Completed reps_weight set counts, uncredited but hard-set weighted —
     *  fractional when the window holds technique work (a 3-stage rest-pause
     *  is 2 sets, not 3). */
    currentSets: number
    previousSets: number
    /** Distinct completed workouts in the current window. */
    currentSessions: number
    /** Completed duration-set seconds summed per window (cardio v1) — the
     *  weekly cardio-minutes aggregate, kept apart from set counts because
     *  a minute of cycling is not a set of bench. */
    currentCardioSec: number
    previousCardioSec: number
  }
}

/**
 * The credit rule ONE set earns, shared by performed volume (here) and planned
 * volume (db/planned-volume.ts) so planned-vs-performed is apples-to-apples:
 * each PRIMARY muscle's group gets 1.0, each secondary's 0.5, and a group hit
 * by both roles (e.g. Chest primary + Serratus secondary — same bucket) counts
 * once at 1.0. Null (exercise unknown) and an empty muscle list both credit
 * 'Other' 1.0 — the set happened / is planned; it's never dropped.
 */
export function creditSetMuscles(
  muscles: { primary: readonly string[]; secondary: readonly string[] } | null,
): Map<VolumeGroup, number> {
  const credits = new Map<VolumeGroup, number>()
  if (muscles === null) {
    credits.set('Other', 1)
    return credits
  }
  for (const name of muscles.primary) {
    credits.set(muscleGroupFor(name) ?? 'Other', 1)
  }
  for (const name of muscles.secondary) {
    const group = muscleGroupFor(name) ?? 'Other'
    if (!credits.has(group)) credits.set(group, 0.5)
  }
  // A catalog entry with no muscles at all still did SOMETHING.
  if (credits.size === 0) credits.set('Other', 1)
  return credits
}

/**
 * Pure aggregation — exported for tests. Builds fresh structures; never
 * mutates inputs. Credit per set: `creditSetMuscles`. Duration-mode rows
 * never count (consistent with records: reps_weight is the set-volume unit).
 */
export function aggregateMuscleVolume(
  rows: readonly MuscleVolumeRow[],
  resolver: MuscleResolver,
  windows: VolumeWindows,
): MuscleVolume {
  const current = new Map<VolumeGroup, number>()
  const previous = new Map<VolumeGroup, number>()
  let currentSets = 0
  let previousSets = 0
  let currentCardioSec = 0
  let previousCardioSec = 0
  const currentWorkouts = new Set<string>()

  for (const row of rows) {
    const isCurrent = inWindow(row.startedAt, windows.current)
    const isPrevious = !isCurrent && inWindow(row.startedAt, windows.previous)
    if (!isCurrent && !isPrevious) continue // horizon over-fetch tolerance
    // Duration rows never count as sets or muscle credits (reps_weight is
    // the set-volume unit) — they sum into the cardio-minutes totals instead.
    if (row.metricMode !== 'reps_weight') {
      const sec = row.durationSec ?? 0
      if (isCurrent) currentCardioSec += sec
      else previousCardioSec += sec
      continue
    }
    const bucket = isCurrent ? current : previous
    // What this ROW is worth as a hard set: 1.0 ordinarily, less for the
    // later stages of a technique group (the group is one set, not N).
    const weight = stageVolumeWeight(rowTechnique(row))
    if (isCurrent) {
      currentSets += weight
      currentWorkouts.add(row.workoutId)
    } else {
      previousSets += weight
    }
    // A stage worth nothing (a cluster's later blocks) credits nothing —
    // it was already counted at the top of its group.
    if (weight === 0) continue

    // Per-set group credits: primary wins over secondary within one set.
    const credits = creditSetMuscles(resolver(row.source, row.wgerExerciseId))
    for (const [group, credit] of credits) {
      bucket.set(group, (bucket.get(group) ?? 0) + credit * weight)
    }
  }

  const groups: MuscleGroupVolume[] = MUSCLE_GROUPS.map((group) => ({
    group,
    currentSets: current.get(group) ?? 0,
    previousSets: previous.get(group) ?? 0,
  }))
  const otherCurrent = current.get('Other') ?? 0
  const otherPrevious = previous.get('Other') ?? 0
  if (otherCurrent > 0 || otherPrevious > 0) {
    groups.push({ group: 'Other', currentSets: otherCurrent, previousSets: otherPrevious })
  }

  return {
    groups,
    totals: {
      currentSets,
      previousSets,
      currentSessions: currentWorkouts.size,
      currentCardioSec,
      previousCardioSec,
    },
  }
}

/** The row's technique grouping, or undefined when it is an ordinary set.
 *  Stored columns are still data: a junk kind or a missing stage index
 *  degrades to "ordinary", never to a mis-weighted set. */
function rowTechnique(row: MuscleVolumeRow): SetTechnique | undefined {
  if (!isTechniqueKind(row.techniqueKind) || !Number.isInteger(row.stageIndex)) return undefined
  // `group` plays no part in the weight — the stage index carries it.
  return { kind: row.techniqueKind, group: '', stageIndex: row.stageIndex as number }
}

/**
 * Builds the catalog resolver: the cached wger map plus the user's custom
 * exercises, keyed by the composite identity (a custom id must never read a
 * wger entry). Exported for the Phase-2 page to reuse.
 */
export async function buildMuscleResolver(userId: string): Promise<MuscleResolver> {
  const [catalog, customs] = await Promise.all([getAllExercises(), listCustomExercises(userId)])
  const wgerById = new Map(catalog.map((e) => [e.id, e]))
  const customById = new Map(customs.map((e) => [e.id, e]))
  return (source, id) => {
    if (source === 'custom') {
      const custom = customById.get(id)
      if (!custom) return null
      return { primary: custom.muscles ?? [], secondary: custom.musclesSecondary ?? [] }
    }
    const entry = wgerById.get(id)
    if (!entry) return null
    return { primary: entry.muscles ?? [], secondary: entry.musclesSecondary ?? [] }
  }
}

/** The shared flat-rows fetch: completed sets in completed workouts from the
 *  previous window's start onward (one fetch covers both windows).
 *  Deliberately no set_type filter: a completed warm-up is work performed.
 *  The set-type rule and its planned-side asymmetry are documented in
 *  db/planned-volume.ts. */
function fetchVolumeRows(userId: string, windows: VolumeWindows) {
  return db
    .select({
      workoutId: workouts.id,
      startedAt: workouts.startedAt,
      wgerExerciseId: workoutExercises.wgerExerciseId,
      source: workoutExercises.source,
      metricMode: sets.metricMode,
      durationSec: sets.durationSec,
      techniqueKind: sets.techniqueKind,
      stageIndex: sets.stageIndex,
    })
    .from(sets)
    .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .where(
      and(
        eq(workouts.userId, userId),
        isNotNull(workouts.completedAt),
        eq(sets.completed, true),
        gte(workouts.startedAt, windows.previous.start),
      ),
    )
}

/** Weekly muscle volume for the given windows (current + previous). */
export async function getMuscleVolume(
  userId: string,
  windows: VolumeWindows,
): Promise<MuscleVolume> {
  const [resolver, rows] = await Promise.all([
    buildMuscleResolver(userId),
    fetchVolumeRows(userId, windows),
  ])
  return aggregateMuscleVolume(rows, resolver, windows)
}

/**
 * Totals only — no muscle resolution, so no catalog/Redis dependency. The
 * home teaser's read: it must never put the wger catalog on the home page's
 * critical path (the /stats page owns the full per-group picture).
 */
export async function getVolumeTotals(
  userId: string,
  windows: VolumeWindows,
): Promise<MuscleVolume['totals']> {
  const rows = await fetchVolumeRows(userId, windows)
  const emptyResolver: MuscleResolver = () => ({ primary: [], secondary: [] })
  return aggregateMuscleVolume(rows, emptyResolver, windows).totals
}

/**
 * Rolling-window totals, request-memoized (React cache — per-request only,
 * never cross-request). CONSTRAINT: this wrapper exists because
 * `getVolumeTotals` takes a `VolumeWindows` OBJECT — cache keys args by
 * Object.is, so a fresh windows object per call would defeat memoization.
 * The rolling windows are derived INSIDE, on cache miss, keyed by userId
 * alone. The fresh `new Date()` here matches the old call sites, which each
 * constructed their own `new Date()` at the callsite anyway. Calendar-mode
 * callers (/stats) keep using `getVolumeTotals`/`getMuscleVolume` directly.
 */
export const getRollingVolumeTotals = cache(
  async (userId: string): Promise<MuscleVolume['totals']> =>
    getVolumeTotals(userId, volumeWindows('rolling', new Date())),
)
