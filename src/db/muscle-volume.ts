import { and, eq, gte, isNotNull } from 'drizzle-orm'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { MUSCLE_GROUPS, muscleGroupFor, type MuscleGroup } from '@/lib/muscle-groups'
import { inWindow, type VolumeWindows } from '@/lib/volume-window'
import { getAllExercises } from '@/lib/wger'
import { db } from './index'
import { listCustomExercises } from './custom-exercises'
import { workouts, workoutExercises, sets } from './schema'

/**
 * Weekly training volume per muscle group — sets counted with the standard
 * hypertrophy credit rule (primary muscles 1.0, secondaries 0.5 per set).
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
    /** Raw completed reps_weight set counts (integers, uncredited). */
    currentSets: number
    previousSets: number
    /** Distinct completed workouts in the current window. */
    currentSessions: number
  }
}

/**
 * Pure aggregation — exported for tests. Builds fresh structures; never
 * mutates inputs. Credit per set: each PRIMARY muscle's group gets 1.0, each
 * secondary's 0.5, and a group hit by both (e.g. a lift listing Chest primary
 * + Serratus secondary — same bucket) counts once at 1.0. Duration-mode rows
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
  const currentWorkouts = new Set<string>()

  for (const row of rows) {
    if (row.metricMode !== 'reps_weight') continue
    const isCurrent = inWindow(row.startedAt, windows.current)
    const isPrevious = !isCurrent && inWindow(row.startedAt, windows.previous)
    if (!isCurrent && !isPrevious) continue // horizon over-fetch tolerance
    const bucket = isCurrent ? current : previous
    if (isCurrent) {
      currentSets += 1
      currentWorkouts.add(row.workoutId)
    } else {
      previousSets += 1
    }

    // Per-set group credits: primary wins over secondary within one set.
    const muscles = resolver(row.source, row.wgerExerciseId)
    const credits = new Map<VolumeGroup, number>()
    if (muscles === null) {
      credits.set('Other', 1)
    } else {
      for (const name of muscles.primary) {
        credits.set(muscleGroupFor(name) ?? 'Other', 1)
      }
      for (const name of muscles.secondary) {
        const group = muscleGroupFor(name) ?? 'Other'
        if (!credits.has(group)) credits.set(group, 0.5)
      }
      // A catalog entry with no muscles at all still did SOMETHING.
      if (credits.size === 0) credits.set('Other', 1)
    }
    for (const [group, credit] of credits) {
      bucket.set(group, (bucket.get(group) ?? 0) + credit)
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
    totals: { currentSets, previousSets, currentSessions: currentWorkouts.size },
  }
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
 *  previous window's start onward (one fetch covers both windows). */
function fetchVolumeRows(userId: string, windows: VolumeWindows) {
  return db
    .select({
      workoutId: workouts.id,
      startedAt: workouts.startedAt,
      wgerExerciseId: workoutExercises.wgerExerciseId,
      source: workoutExercises.source,
      metricMode: sets.metricMode,
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
