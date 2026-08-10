import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { MUSCLE_GROUPS, muscleGroupFor, type MuscleGroup } from '@/lib/muscle-groups'
import type { AutoregSession, AutoregStallPolicy } from '@/lib/autoregulate'
import { getRedis } from '@/lib/redis'
import {
  combineWeekResults,
  movementWeekResult,
  muscleVerdicts,
  proposalsToCreate,
  uniformRepTop,
  volumeProposalContent,
  type MovementWeekEvidence,
  type MovementWeekResult,
  type MuscleVerdict,
  type SetTemplate,
} from '@/lib/volume-progression'
import { db } from './index'
import { creditSetMuscles, type VolumeGroup } from './muscle-volume'
import { createPatchProposal, listPatchProposals } from './patch-proposals'
import { nextProgramWeek } from './programs'
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
 * Data assembly for the volume-progression signal (lib/volume-progression.ts)
 * — the derive-time weekly check of feature-wave plan §4. Everything here is
 * program-provenance-scoped (workouts → program_days → program) and gated on
 * `workouts.userId` / `programs.userId`, the module's authorization boundary,
 * mirroring db/program-stats.ts.
 *
 * The week axis is the PROGRAM's (`workouts.programWeek` stamps), not the
 * /stats calendar: verdicts speak about "the last completed program week"
 * (currentWeek − 1 via `nextProgramWeek`, so this surface and the Start-day
 * button always agree on where the block stands). Evidence is the same
 * prescribed-at-instantiation snapshot rows the autoreg engine scores —
 * prescriptions stay snapshotted facts; verdicts derive from logged history
 * only.
 *
 * Muscle identity on BOTH sides comes from the program's own tag rows
 * (`program_exercise_muscles`), keyed by composite exercise identity — NOT
 * the wger catalog: this surface is program-scoped, so the plan's tags keep
 * planned/performed/verdict vocabulary identical without putting the catalog
 * on the page's critical path. Untagged or substituted movements roll into
 * 'Other' (honesty bucket) for the volume table and simply carry no primary
 * groups for verdicts — silence, never a guess.
 */

/** One structure row: a program-exercise occurrence with its address. */
export interface StructureRow {
  dayPosition: number
  exercisePosition: number
  programExerciseId: string
  wgerExerciseId: number
  source: ExerciseSource
  name: string
  /** progression?.scheme — 'weekly-volume' owns its own set count. */
  scheme: string | null
}

/** One planned-set row of a program exercise. */
export interface StructureSetRow {
  programExerciseId: string
  setNumber: number
  setType: string
  repMin: number | null
  repMax: number | null
  restSec: number | null
}

/** One muscle tag row (program_exercise_muscles). */
export interface StructureMuscleRow {
  programExerciseId: string
  muscle: string
  role: string
}

/** One logged-set row inside the two-week evidence window. */
export interface EvidenceSetRow {
  workoutId: string
  programWeek: number
  startedAtMs: number
  wgerExerciseId: number
  source: ExerciseSource
  setNumber: number
  reps: number | null
  weightKg: number | null
  completed: boolean
  setType: string
  prescribedLoadKg: number | null
  prescribedRepMin: number | null
}

/** One completed-set row for the per-week volume table. */
export interface WeekVolumeRow {
  programWeek: number
  wgerExerciseId: number
  source: ExerciseSource
  metricMode: string
}

export interface WeekGroupVolume {
  group: VolumeGroup
  /** Credited sets (primary 1.0 / secondary 0.5) — halves are real values. */
  sets: number
}

export interface VolumeWeek {
  week: number
  groups: WeekGroupVolume[]
}

export interface VolumeStatus {
  programId: string
  programName: string
  /** Whether the signal ran at all: false = autoregulation off or the
   *  program isn't active (the cheap skip — nothing else was computed). */
  enabled: boolean
  currentWeek: number
  /** The completed program week the verdicts speak about; null = nothing
   *  behind us yet (week 1, or disabled). */
  week: number | null
  verdicts: MuscleVerdict[]
  /** Performed credited sets per program week per muscle group, ascending —
   *  the trend/table tiers of the disclosure UI. Includes the current
   *  (partial) week; empty when disabled. */
  weeks: VolumeWeek[]
}

const identityKey = (source: string, id: number) => `${source}:${id}`

/**
 * Pure assembly — exported for tests. Folds the program structure + the
 * two-week evidence rows into per-movement evidence for `muscleVerdicts`.
 * Deload-week sessions never testify (a planned back-off is neither a beat
 * nor a stall). Builds fresh structures; never mutates inputs.
 */
export function assembleMovements(
  structure: readonly StructureRow[],
  structureSets: readonly StructureSetRow[],
  muscleRows: readonly StructureMuscleRow[],
  evidence: readonly EvidenceSetRow[],
  stallPolicy: AutoregStallPolicy,
  deloadWeek: number | null,
): MovementWeekEvidence[] {
  const setsByExercise = new Map<string, StructureSetRow[]>()
  for (const row of structureSets) {
    const list = setsByExercise.get(row.programExerciseId) ?? []
    list.push(row)
    setsByExercise.set(row.programExerciseId, list)
  }
  const musclesByExercise = new Map<string, StructureMuscleRow[]>()
  for (const row of muscleRows) {
    const list = musclesByExercise.get(row.programExerciseId) ?? []
    list.push(row)
    musclesByExercise.set(row.programExerciseId, list)
  }

  // Group occurrences per composite identity (rows arrive in day/exercise
  // position order, so the first occurrence is the patch address).
  interface MovementAcc {
    first: StructureRow
    days: Set<number>
    tagRows: StructureMuscleRow[]
    schemeOwnsSets: boolean
  }
  const byKey = new Map<string, MovementAcc>()
  for (const row of structure) {
    const key = identityKey(row.source, row.wgerExerciseId)
    let acc = byKey.get(key)
    if (!acc) {
      acc = { first: row, days: new Set<number>(), tagRows: [], schemeOwnsSets: false }
      byKey.set(key, acc)
    }
    acc.days.add(row.dayPosition)
    acc.tagRows.push(...(musclesByExercise.get(row.programExerciseId) ?? []))
    if (row.scheme === 'weekly-volume') acc.schemeOwnsSets = true
  }

  // One AutoregSession per (identity, workout), then combined per week.
  interface SessionAcc {
    key: string
    programWeek: number
    session: AutoregSession
  }
  const sessionsByWorkout = new Map<string, SessionAcc>()
  for (const row of evidence) {
    if (row.programWeek === deloadWeek) continue
    const key = identityKey(row.source, row.wgerExerciseId)
    if (!byKey.has(key)) continue // movement no longer on the plan — silence
    const mapKey = `${key}:${row.workoutId}`
    let acc = sessionsByWorkout.get(mapKey)
    if (!acc) {
      acc = {
        key,
        programWeek: row.programWeek,
        session: { startedAtMs: row.startedAtMs, prescribed: [], actual: [] },
      }
      sessionsByWorkout.set(mapKey, acc)
    }
    acc.session.prescribed.push({
      setNumber: row.setNumber,
      repMin: row.prescribedRepMin,
      loadKg: row.prescribedLoadKg,
      setType: row.setType,
    })
    acc.session.actual.push({
      setNumber: row.setNumber,
      reps: row.reps,
      weightKg: row.weightKg,
      completed: row.completed,
      setType: row.setType,
    })
  }

  const movements: MovementWeekEvidence[] = []
  for (const [key, acc] of byKey) {
    const firstSets = setsByExercise.get(acc.first.programExerciseId) ?? []
    const repTop = uniformRepTop(firstSets)
    const working = firstSets.filter((s) => s.setType === 'working')
    const last = working[working.length - 1]
    const setTemplate: SetTemplate | null = last
      ? { repMin: last.repMin, repMax: last.repMax, restSec: last.restSec }
      : null

    // Primary groups deduped across occurrences; unmapped names carry no
    // verdict currency (the volume table still counts them under 'Other').
    const primaryGroups: MuscleGroup[] = []
    for (const tag of acc.tagRows) {
      if (tag.role !== 'primary') continue
      const group = muscleGroupFor(tag.muscle)
      if (group !== null && !primaryGroups.includes(group)) primaryGroups.push(group)
    }
    const muscleTagCount = new Set(acc.tagRows.map((t) => t.muscle)).size

    const resultsByWeek = new Map<number, MovementWeekResult[]>()
    for (const s of sessionsByWorkout.values()) {
      if (s.key !== key) continue
      const list = resultsByWeek.get(s.programWeek) ?? []
      list.push(movementWeekResult(s.session, repTop, stallPolicy))
      resultsByWeek.set(s.programWeek, list)
    }
    const weeks = new Map<number, MovementWeekResult>()
    for (const [week, results] of resultsByWeek) {
      weeks.set(week, combineWeekResults(results))
    }

    movements.push({
      key,
      name: acc.first.name,
      primaryGroups,
      weeks,
      frequency: acc.days.size,
      muscleTagCount,
      address: {
        dayPosition: acc.first.dayPosition,
        exercisePosition: acc.first.exercisePosition,
      },
      setTemplate,
      schemeOwnsSets: acc.schemeOwnsSets,
    })
  }
  return movements
}

/**
 * Pure aggregation for the per-week volume table — exported for tests.
 * Credits each completed reps_weight set to its muscle groups via the shared
 * `creditSetMuscles` rule, resolving muscles through the PROGRAM's tag rows
 * (identity-keyed); movements without tags credit 'Other'. Weeks ascending,
 * every listed week carrying all ten groups (+'Other' when it has volume).
 */
export function aggregateWeekVolume(
  rows: readonly WeekVolumeRow[],
  musclesByKey: ReadonlyMap<string, { primary: string[]; secondary: string[] }>,
): VolumeWeek[] {
  const byWeek = new Map<number, Map<VolumeGroup, number>>()
  for (const row of rows) {
    if (row.metricMode !== 'reps_weight') continue
    let week = byWeek.get(row.programWeek)
    if (!week) {
      week = new Map<VolumeGroup, number>()
      byWeek.set(row.programWeek, week)
    }
    const credits = creditSetMuscles(
      musclesByKey.get(identityKey(row.source, row.wgerExerciseId)) ?? null,
    )
    for (const [group, credit] of credits) {
      week.set(group, (week.get(group) ?? 0) + credit)
    }
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a - b)
    .map(([week, totals]) => {
      const groups: WeekGroupVolume[] = MUSCLE_GROUPS.map((group) => ({
        group,
        sets: totals.get(group) ?? 0,
      }))
      const other = totals.get('Other') ?? 0
      if (other > 0) groups.push({ group: 'Other', sets: other })
      return { week, groups }
    })
}

interface ProgramRow {
  id: string
  name: string
  status: string
  autoregulation: boolean
  autoregStallPolicy: AutoregStallPolicy
  mesocycleWeeks: number
  deloadWeek: number | null
}

async function loadProgram(userId: string, programId: string): Promise<ProgramRow | null> {
  const [row] = await db
    .select({
      id: programs.id,
      name: programs.name,
      status: programs.status,
      autoregulation: programs.autoregulation,
      autoregStallPolicy: programs.autoregStallPolicy,
      mesocycleWeeks: programs.mesocycleWeeks,
      deloadWeek: programs.deloadWeek,
    })
    .from(programs)
    .where(and(eq(programs.id, programId), eq(programs.userId, userId)))
    .limit(1)
  return row ?? null
}

/** The program's full structure (occurrences, planned sets, muscle tags) in
 *  three parallel reads. */
async function loadStructure(programId: string): Promise<{
  structure: StructureRow[]
  structureSets: StructureSetRow[]
  muscleRows: StructureMuscleRow[]
}> {
  const [structure, structureSets, muscleRows] = await Promise.all([
    db
      .select({
        dayPosition: programDays.position,
        exercisePosition: programExercises.position,
        programExerciseId: programExercises.id,
        wgerExerciseId: programExercises.wgerExerciseId,
        source: programExercises.source,
        name: programExercises.name,
        progression: programExercises.progression,
      })
      .from(programExercises)
      .innerJoin(programDays, eq(programDays.id, programExercises.programDayId))
      .where(eq(programDays.programId, programId))
      .orderBy(asc(programDays.position), asc(programExercises.position)),
    db
      .select({
        programExerciseId: programSets.programExerciseId,
        setNumber: programSets.setNumber,
        setType: programSets.setType,
        repMin: programSets.repMin,
        repMax: programSets.repMax,
        restSec: programSets.restSec,
      })
      .from(programSets)
      .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
      .innerJoin(programDays, eq(programDays.id, programExercises.programDayId))
      .where(eq(programDays.programId, programId))
      .orderBy(asc(programSets.setNumber)),
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
      .where(eq(programDays.programId, programId)),
  ])
  return {
    structure: structure.map((r) => ({ ...r, scheme: r.progression?.scheme ?? null })),
    structureSets,
    muscleRows,
  }
}

/** Completed-session set rows (with prescription snapshots) for the verdict
 *  weeks. Only weight_reps slots qualify — the same scorability rule as
 *  db/autoreg-history.ts. */
async function loadEvidence(
  userId: string,
  programId: string,
  weeks: number[],
): Promise<EvidenceSetRow[]> {
  if (weeks.length === 0) return []
  const rows = await db
    .select({
      workoutId: workouts.id,
      programWeek: workouts.programWeek,
      startedAt: workouts.startedAt,
      wgerExerciseId: workoutExercises.wgerExerciseId,
      source: workoutExercises.source,
      setNumber: sets.setNumber,
      reps: sets.reps,
      weightKg: sets.weight,
      completed: sets.completed,
      setType: sets.setType,
      prescribedLoadKg: sets.prescribedLoadKg,
      prescribedRepMin: sets.prescribedRepMin,
    })
    .from(sets)
    .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .innerJoin(programDays, eq(programDays.id, workouts.programDayId))
    .where(
      and(
        eq(workouts.userId, userId),
        eq(programDays.programId, programId),
        isNotNull(workouts.completedAt),
        inArray(workouts.programWeek, weeks),
        eq(workoutExercises.loggingType, 'weight_reps'),
      ),
    )
    .orderBy(asc(sets.setNumber))
  return rows.flatMap((r) =>
    r.programWeek === null
      ? []
      : [{ ...r, programWeek: r.programWeek, startedAtMs: r.startedAt.getTime() }],
  )
}

/** All completed reps_weight sets of the program's completed workouts, for
 *  the per-week volume table. */
async function loadWeekVolumeRows(userId: string, programId: string): Promise<WeekVolumeRow[]> {
  const rows = await db
    .select({
      programWeek: workouts.programWeek,
      wgerExerciseId: workoutExercises.wgerExerciseId,
      source: workoutExercises.source,
      metricMode: sets.metricMode,
    })
    .from(sets)
    .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .innerJoin(programDays, eq(programDays.id, workouts.programDayId))
    .where(
      and(
        eq(workouts.userId, userId),
        eq(programDays.programId, programId),
        isNotNull(workouts.completedAt),
        eq(sets.completed, true),
      ),
    )
  return rows.flatMap((r) => (r.programWeek === null ? [] : [{ ...r, programWeek: r.programWeek }]))
}

/** Identity-keyed muscle map from the program's tag rows, for the volume
 *  table's resolver (shared vocabulary with `assembleMovements`). */
function musclesByIdentity(
  structure: readonly StructureRow[],
  muscleRows: readonly StructureMuscleRow[],
): Map<string, { primary: string[]; secondary: string[] }> {
  const byExercise = new Map<string, StructureMuscleRow[]>()
  for (const row of muscleRows) {
    const list = byExercise.get(row.programExerciseId) ?? []
    list.push(row)
    byExercise.set(row.programExerciseId, list)
  }
  const byKey = new Map<string, { primary: string[]; secondary: string[] }>()
  for (const row of structure) {
    const key = identityKey(row.source, row.wgerExerciseId)
    let entry = byKey.get(key)
    if (!entry) {
      entry = { primary: [], secondary: [] }
      byKey.set(key, entry)
    }
    for (const tag of byExercise.get(row.programExerciseId) ?? []) {
      const bucket = tag.role === 'primary' ? entry.primary : entry.secondary
      if (!bucket.includes(tag.muscle)) bucket.push(tag.muscle)
    }
  }
  return byKey
}

/** The verdict evidence weeks for the last completed week `week`: itself and
 *  the week before (when it exists) — the beat rule's two-week window. */
function evidenceWeeks(week: number): number[] {
  return week >= 2 ? [week - 1, week] : [week]
}

async function computeVerdicts(
  userId: string,
  program: ProgramRow,
  week: number,
): Promise<MuscleVerdict[]> {
  const [{ structure, structureSets, muscleRows }, evidence] = await Promise.all([
    loadStructure(program.id),
    loadEvidence(userId, program.id, evidenceWeeks(week)),
  ])
  const movements = assembleMovements(
    structure,
    structureSets,
    muscleRows,
    evidence,
    program.autoregStallPolicy,
    program.deloadWeek,
  )
  return muscleVerdicts(movements, week)
}

/**
 * The full volume status for one owned program: per-muscle verdicts for the
 * last completed program week plus the per-week volume table. Null when the
 * program doesn't exist or isn't owned. Skips ALL heavy reads (`enabled:
 * false`) for non-active programs and programs with autoregulation off — the
 * plan's cheap-skip rule.
 */
export async function getVolumeStatus(
  userId: string,
  programId: string,
): Promise<VolumeStatus | null> {
  const program = await loadProgram(userId, programId)
  if (!program) return null
  if (program.status !== 'active' || !program.autoregulation) {
    return {
      programId: program.id,
      programName: program.name,
      enabled: false,
      currentWeek: 0,
      week: null,
      verdicts: [],
      weeks: [],
    }
  }
  const currentWeek = await nextProgramWeek(userId, programId, program.mesocycleWeeks)
  const week = currentWeek - 1
  const [verdicts, structureForTable, volumeRows] = await Promise.all([
    week >= 1 ? computeVerdicts(userId, program, week) : Promise.resolve([]),
    loadStructure(program.id),
    loadWeekVolumeRows(userId, programId),
  ])
  return {
    programId: program.id,
    programName: program.name,
    enabled: true,
    currentWeek,
    week: week >= 1 ? week : null,
    verdicts,
    weeks: aggregateWeekVolume(
      volumeRows,
      musclesByIdentity(structureForTable.structure, structureForTable.muscleRows),
    ),
  }
}

/** Redis marker: the weekly check runs at most once per (program, completed
 *  week) — page loads in between cost one GET. Also what keeps a declined
 *  proposal from re-nagging within the same week. */
const markerKey = (programId: string, week: number) => `volume-proposals:${programId}:w${week}`
const MARKER_TTL_SECONDS = 60 * 60 * 24 * 90

/**
 * The derive-time weekly trigger (plan §4): computes verdicts for the last
 * completed week and turns eligible muscles into batch-patch proposals
 * (authorActor 'mcp') through `createPatchProposal` — one add_program_set
 * per muscle; the owner picks by confirming. HOLD produces nothing (silence).
 * Runs at most once per (program, week) via the Redis marker; still-pending
 * proposals are summary-prefix-deduped either way, so a missing Redis config
 * degrades to pending-dedup, never to duplicates. Best-effort by design: any
 * failure logs and leaves the page unharmed, and the marker stays unset so
 * the next load retries.
 */
export async function ensureVolumeProposals(userId: string, programId: string): Promise<void> {
  try {
    const program = await loadProgram(userId, programId)
    if (!program || program.status !== 'active' || !program.autoregulation) return
    const currentWeek = await nextProgramWeek(userId, programId, program.mesocycleWeeks)
    const week = currentWeek - 1
    if (week < 1) return

    const redis = getRedis()
    if (redis && (await redis.get(markerKey(programId, week))) !== null) return

    const [verdicts, pending] = await Promise.all([
      computeVerdicts(userId, program, week),
      listPatchProposals(userId, programId),
    ])
    const jobs = proposalsToCreate(
      verdicts,
      pending.map((p) => p.summary),
    )
    for (const job of jobs) {
      await createPatchProposal(
        userId,
        programId,
        volumeProposalContent(job.group, job.candidate),
        'mcp',
      )
    }
    if (redis) {
      await redis.set(markerKey(programId, week), '1', { ex: MARKER_TTL_SECONDS })
    }
  } catch (error: unknown) {
    // Enhancement on a read path: never break the page; next load retries.
    console.error('volume proposal check failed (page unaffected)', error)
  }
}
