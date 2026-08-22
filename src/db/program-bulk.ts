import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { Progression, Technique } from '@/lib/program-input'
import { TM_BASED_SCHEMES } from '@/lib/substitute-slot'
import { db } from './index'
import { recordProgramEvent, type ProgramEventActor } from './program-events'
import {
  ProgramPatchError,
  assertSetRowIntegrity,
  bumpUpdatedAt,
  findOwnedDayId,
  findOwnedExercise,
  findOwnedProgramId,
  type PatchRunner,
  type Tx,
} from './program-patches'
import {
  programs,
  programDays,
  programExercises,
  programExerciseMuscles,
  programSets,
  programSetOverrides,
} from './schema'

/**
 * BULK program ops — the primitives behind the authoring affordances that were
 * drawn before anything could serve them: duplicate day, duplicate week, fill
 * down, fill right, quick-entry scheme apply, and "also apply to" progression
 * scopes.
 *
 * WHY THESE ARE OPS AND NOT CLIENT LOOPS. Every one of them is an unbounded
 * fan-out over single-item patches: duplicating a 6-exercise day is ~30 writes,
 * filling a rule across a program is one per exercise. Expressed as N patches
 * they blow through MAX_PROPOSAL_PATCHES (20, lib/patch-proposal.ts) on any
 * real program, and — worse — a client loop has no transaction, so a failure
 * halfway leaves a half-duplicated day behind. Each function here is ONE
 * transaction with ONE `program_events` row, so it costs ONE slot wherever a
 * batch ceiling applies and can never commit partially.
 *
 * Conventions are the sibling module's (db/program-patches.ts) verbatim:
 * ownership through the join chain to `programs.user_id`; `null` = not
 * owned/found; `ProgramPatchError` = a valid address with an invalid edit;
 * every success bumps `programs.updatedAt` and appends one actor-attributed
 * event inside the same transaction.
 */

/** The target fields a fill / scheme / override copy may carry. Deliberately
 *  excludes `setType` and `metricMode`: those are a set's SHAPE, and changing
 *  shape is an edit, not a fill (same stance as `setOverrideSchema`). */
export interface SetTargets {
  repMin?: number | null
  repMax?: number | null
  rir?: number | null
  rpe?: number | null
  suggestedLoadKg?: number | null
  tempo?: string | null
  durationSec?: number | null
  distanceM?: number | null
  restSec?: number | null
  technique?: Technique | null
}

/** The fillable target columns, in one list so the fill, scheme and week ops
 *  can never drift on WHICH fields travel. */
const TARGET_FIELDS = [
  'repMin',
  'repMax',
  'rir',
  'rpe',
  'suggestedLoadKg',
  'tempo',
  'durationSec',
  'distanceM',
  'restSec',
  'technique',
] as const

/** The per-week override columns (mirrors OVERRIDE_FIELDS in program-patches). */
const OVERRIDE_FIELDS = TARGET_FIELDS

// ---------------------------------------------------------------------------
// Duplicate day
// ---------------------------------------------------------------------------

/**
 * Duplicates one program day — the day row, its exercises (superset groups,
 * progression, per-exercise overshoot policy, muscle tags), their sets, AND the
 * per-week overrides on those sets — inserting the copy IMMEDIATELY AFTER the
 * source and shifting the later days down so positions stay 0-based contiguous.
 *
 * PER-WEEK OVERRIDES ARE COPIED. The alternative (drop them, hand back a bare
 * skeleton) was rejected: an override is part of what the day PRESCRIBES, so a
 * "duplicate" that silently drops week 3's back-off targets produces a day that
 * looks identical in the builder and trains differently from week 2 onward — a
 * wrong plan with no signal, which is the failure mode this whole batch of
 * primitives exists to prevent. Copying also matches the fidelity
 * `copyProgramTree` already established for whole-program clones (db/programs.ts),
 * so duplicate-day and duplicate-program agree about what a copy means. The
 * event payload reports `overridesCopied` so the count is auditable rather than
 * invisible; a lifter who wants the skeleton clears the overrides on the copy,
 * which is one visible op instead of an invisible policy.
 *
 * Overrides are copied VERBATIM, including their `week` numbers — the copy
 * lives in the same mesocycle as its source, so week 3 stays week 3.
 *
 * Returns the new day's 0-based position, or null when the program/day isn't
 * owned. Reads, in order: owned-day → day row → exercises → sets → overrides →
 * muscle tags.
 */
export async function duplicateProgramDay(
  userId: string,
  programId: string,
  dayPosition: number,
  actor: ProgramEventActor,
  options?: { name?: string; runIn?: PatchRunner },
): Promise<{ position: number; overridesCopied: number } | null> {
  return (options?.runIn ?? db).transaction(async (tx) => {
    const sourceDayId = await findOwnedDayId(tx, userId, programId, dayPosition)
    if (!sourceDayId) return null

    const [sourceDay] = await tx
      .select({
        name: programDays.name,
        notes: programDays.notes,
        weekdays: programDays.weekdays,
      })
      .from(programDays)
      .where(eq(programDays.id, sourceDayId))
      .limit(1)
    if (!sourceDay) return null

    const sourceExercises = await tx
      .select({
        id: programExercises.id,
        wgerExerciseId: programExercises.wgerExerciseId,
        source: programExercises.source,
        name: programExercises.name,
        position: programExercises.position,
        supersetGroup: programExercises.supersetGroup,
        progression: programExercises.progression,
        overshootPolicy: programExercises.overshootPolicy,
      })
      .from(programExercises)
      .where(eq(programExercises.programDayId, sourceDayId))
      .orderBy(asc(programExercises.position))

    const exerciseIds = sourceExercises.map((e) => e.id)
    const sourceSets = exerciseIds.length
      ? await tx
          .select({
            id: programSets.id,
            programExerciseId: programSets.programExerciseId,
            setNumber: programSets.setNumber,
            setType: programSets.setType,
            metricMode: programSets.metricMode,
            repMin: programSets.repMin,
            repMax: programSets.repMax,
            rir: programSets.rir,
            rpe: programSets.rpe,
            suggestedLoadKg: programSets.suggestedLoadKg,
            tempo: programSets.tempo,
            durationSec: programSets.durationSec,
            distanceM: programSets.distanceM,
            restSec: programSets.restSec,
            technique: programSets.technique,
          })
          .from(programSets)
          .where(inArray(programSets.programExerciseId, exerciseIds))
          .orderBy(asc(programSets.setNumber))
      : []

    const setIds = sourceSets.map((s) => s.id)
    const sourceOverrides = setIds.length > 0 ? await selectOverrides(tx, setIds) : []
    const sourceMuscles = exerciseIds.length
      ? await tx
          .select({
            programExerciseId: programExerciseMuscles.programExerciseId,
            muscle: programExerciseMuscles.muscle,
            role: programExerciseMuscles.role,
          })
          .from(programExerciseMuscles)
          .where(inArray(programExerciseMuscles.programExerciseId, exerciseIds))
      : []

    // Make room, then land the copy directly after its source. The per-parent
    // unique on `position` is DEFERRABLE, so the transient overlap is fine.
    const position = dayPosition + 1
    await tx
      .update(programDays)
      .set({ position: sql`${programDays.position} + 1` })
      .where(and(eq(programDays.programId, programId), gt(programDays.position, dayPosition)))

    const [newDay] = await tx
      .insert(programDays)
      .values({
        programId,
        name: options?.name ?? `${sourceDay.name} (copy)`,
        position,
        notes: sourceDay.notes,
        // The schedule travels with the day — the copy is the same session on
        // (initially) the same weekdays, which the owner then edits. Diverging
        // here would silently unschedule the copy.
        weekdays: sourceDay.weekdays,
      })
      .returning({ id: programDays.id })

    const setsByExercise = groupBy(sourceSets, (s) => s.programExerciseId)
    const overridesBySet = groupBy(sourceOverrides, (o) => o.programSetId)
    const musclesByExercise = groupBy(sourceMuscles, (m) => m.programExerciseId)

    let overridesCopied = 0
    for (const exercise of sourceExercises) {
      const [newExercise] = await tx
        .insert(programExercises)
        .values({
          programDayId: newDay.id,
          wgerExerciseId: exercise.wgerExerciseId,
          source: exercise.source,
          name: exercise.name,
          position: exercise.position,
          supersetGroup: exercise.supersetGroup,
          progression: exercise.progression,
          overshootPolicy: exercise.overshootPolicy,
        })
        .returning({ id: programExercises.id })

      const exerciseSets = setsByExercise.get(exercise.id) ?? []
      if (exerciseSets.length > 0) {
        // Postgres returns batch-insert RETURNING rows in VALUES order — the
        // index zip below relies on it, exactly as `copyProgramTree` does.
        const newSets = await tx
          .insert(programSets)
          .values(
            exerciseSets.map((s) => ({
              programExerciseId: newExercise.id,
              setNumber: s.setNumber,
              setType: s.setType,
              metricMode: s.metricMode,
              repMin: s.repMin,
              repMax: s.repMax,
              rir: s.rir,
              rpe: s.rpe,
              suggestedLoadKg: s.suggestedLoadKg,
              tempo: s.tempo,
              durationSec: s.durationSec,
              distanceM: s.distanceM,
              restSec: s.restSec,
              technique: s.technique,
            })),
          )
          .returning({ id: programSets.id })

        const overrideRows = exerciseSets.flatMap((s, i) =>
          (overridesBySet.get(s.id) ?? []).map((o) => ({
            programSetId: newSets[i].id,
            week: o.week,
            ...pickFields(o, OVERRIDE_FIELDS),
          })),
        )
        if (overrideRows.length > 0) {
          overridesCopied += overrideRows.length
          await tx.insert(programSetOverrides).values(overrideRows)
        }
      }

      // Muscle tags copy as STORED — no catalog fetch, so this path never
      // touches the network (same reasoning as copyProgramTree).
      const muscles = musclesByExercise.get(exercise.id) ?? []
      if (muscles.length > 0) {
        await tx.insert(programExerciseMuscles).values(
          muscles.map((m) => ({
            programExerciseId: newExercise.id,
            muscle: m.muscle,
            role: m.role,
          })),
        )
      }
    }

    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'duplicate_program_day',
      summary: `Duplicate Day ${dayPosition + 1} ("${sourceDay.name}") → Day ${position + 1}`,
      payload: {
        from: dayPosition,
        to: position,
        exercises: sourceExercises.length,
        sets: sourceSets.length,
        overridesCopied,
      },
    })
    return { position, overridesCopied }
  })
}

// ---------------------------------------------------------------------------
// Fill down — one set's targets onto its siblings
// ---------------------------------------------------------------------------

/** Which sets a fill-down reaches. 'below' matches the affordance ("fill the
 *  REMAINING sets"); 'all' rewrites every sibling. Never the source itself. */
export type FillDownScope = 'below' | 'all'

/**
 * Copies one set's TARGET fields onto its siblings within the same exercise —
 * the "fill down" affordance, as ONE op. Shape (`setType`, `metricMode`) never
 * travels, so a warm-up row stays a warm-up and a timed set stays timed; only
 * the prescription copies.
 *
 * Every written row is revalidated against the Phase-1 cross-field rules with
 * the SAME merge-then-revalidate discipline as `updateProgramSet` — a fill that
 * would leave a timed set without a duration, or an inverted rep range, is a
 * `ProgramPatchError`, and because it all rides one transaction NOTHING is
 * written when one row would be invalid. A partial fill is a wrong plan.
 *
 * Returns the number of sets changed (0 when the source is the only/last set —
 * a no-op success, with no event). Null when the node isn't owned/found.
 * Reads, in order: owned-exercise → the exercise's set rows.
 */
export async function fillProgramSetsDown(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  fromSetNumber: number,
  actor: ProgramEventActor,
  options?: { scope?: FillDownScope; fields?: readonly (keyof SetTargets)[]; runIn?: PatchRunner },
): Promise<{ updated: number } | null> {
  const scope = options?.scope ?? 'below'
  const fields = normalizeFields(options?.fields)
  return (options?.runIn ?? db).transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const rows = await tx
      .select({
        setNumber: programSets.setNumber,
        metricMode: programSets.metricMode,
        repMin: programSets.repMin,
        repMax: programSets.repMax,
        rir: programSets.rir,
        rpe: programSets.rpe,
        suggestedLoadKg: programSets.suggestedLoadKg,
        tempo: programSets.tempo,
        durationSec: programSets.durationSec,
        distanceM: programSets.distanceM,
        restSec: programSets.restSec,
        technique: programSets.technique,
      })
      .from(programSets)
      .where(eq(programSets.programExerciseId, found.exerciseId))
      .orderBy(asc(programSets.setNumber))

    const source = rows.find((r) => r.setNumber === fromSetNumber)
    if (!source) return null
    const values = pickFields(source, fields)
    const targets = rows.filter((r) =>
      scope === 'below' ? r.setNumber > fromSetNumber : r.setNumber !== fromSetNumber,
    )
    if (targets.length === 0) return { updated: 0 }

    // Validate EVERY merged row before writing any of them.
    for (const target of targets) {
      assertSetRowIntegrity({ ...target, ...values })
    }
    await tx
      .update(programSets)
      .set(values)
      .where(
        and(
          eq(programSets.programExerciseId, found.exerciseId),
          inArray(
            programSets.setNumber,
            targets.map((t) => t.setNumber),
          ),
        ),
      )
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'fill_program_sets',
      summary: `Fill set ${fromSetNumber} down to ${targets.length} set${
        targets.length === 1 ? '' : 's'
      } of ${found.name} (Day ${dayPosition + 1})`,
      payload: {
        dayPosition,
        exercisePosition,
        fromSetNumber,
        scope,
        setNumbers: targets.map((t) => t.setNumber),
        after: values,
      },
    })
    return { updated: targets.length }
  })
}

// ---------------------------------------------------------------------------
// Fill right / duplicate week — per-week overrides
// ---------------------------------------------------------------------------

function selectOverrides(tx: Tx, setIds: string[]) {
  return tx
    .select({
      id: programSetOverrides.id,
      programSetId: programSetOverrides.programSetId,
      week: programSetOverrides.week,
      repMin: programSetOverrides.repMin,
      repMax: programSetOverrides.repMax,
      rir: programSetOverrides.rir,
      rpe: programSetOverrides.rpe,
      suggestedLoadKg: programSetOverrides.suggestedLoadKg,
      tempo: programSetOverrides.tempo,
      durationSec: programSetOverrides.durationSec,
      distanceM: programSetOverrides.distanceM,
      restSec: programSetOverrides.restSec,
      technique: programSetOverrides.technique,
    })
    .from(programSetOverrides)
    .where(inArray(programSetOverrides.programSetId, setIds))
}

/**
 * REPLACES the override rows at `toWeeks` with copies of the `fromWeek` rows,
 * for the given set ids. Replace, not merge: the caller's intent is "make week
 * M like week N", and a merge would leave week M's unrelated stragglers behind
 * so the two weeks still differ — a copy that didn't copy.
 */
async function replaceWeekOverrides(
  tx: Tx,
  setIds: string[],
  fromWeek: number,
  toWeeks: readonly number[],
): Promise<{ copied: number; cleared: number }> {
  if (setIds.length === 0 || toWeeks.length === 0) return { copied: 0, cleared: 0 }
  const all = await selectOverrides(tx, setIds)
  const source = all.filter((o) => o.week === fromWeek)
  const stale = all.filter((o) => toWeeks.includes(o.week))
  if (stale.length > 0) {
    await tx.delete(programSetOverrides).where(
      inArray(
        programSetOverrides.id,
        stale.map((o) => o.id),
      ),
    )
  }
  const rows = toWeeks.flatMap((week) =>
    source.map((o) => ({
      programSetId: o.programSetId,
      week,
      ...pickFields(o, OVERRIDE_FIELDS),
    })),
  )
  if (rows.length > 0) await tx.insert(programSetOverrides).values(rows)
  return { copied: rows.length, cleared: stale.length }
}

/** Refuses a week outside the program's mesocycle — a "week 9" override in a
 *  6-week block is invisible forever, so it is a `ProgramPatchError`, not a
 *  silently accepted write. */
async function assertWeekInRange(
  tx: Tx,
  programId: string,
  weeks: readonly number[],
): Promise<void> {
  const [row] = await tx
    .select({ mesocycleWeeks: programs.mesocycleWeeks })
    .from(programs)
    .where(eq(programs.id, programId))
    .limit(1)
  const mesocycleWeeks = row?.mesocycleWeeks ?? 0
  for (const week of weeks) {
    if (!Number.isInteger(week) || week < 1 || week > mesocycleWeeks) {
      throw new ProgramPatchError(
        `week ${week} is outside this program's ${mesocycleWeeks}-week mesocycle`,
      )
    }
  }
}

/**
 * "Duplicate week" — resolved against a schema in which A WEEK IS NOT AN ENTITY.
 * A program stores `mesocycleWeeks` (a count) plus `program_set_overrides` rows
 * keyed (set, week); there is no week row to clone. So duplicating week N onto
 * week M means exactly one thing: REPLACE every override at week M, across the
 * whole program, with a copy of the overrides at week N.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not freeze week N's EFFECTIVE
 * prescription into week M. The effective prescription is the template set plus
 * the progression engine plus the deload modifier, resolved at read time;
 * pinning all of that as overrides would make week M immune to progression and
 * auto-regulation forever — the copy would look right on the day it was made
 * and silently stop tracking the lifter. Overrides are DEVIATIONS, and the
 * baseline already applies to every week, so copying just the deviations is
 * what actually reproduces "make week M like week N".
 *
 * Sets with no override at week N end up with none at week M, which is the same
 * statement: both weeks defer to the engine there.
 *
 * Returns the copied/cleared row counts, or null when the program isn't owned.
 * Throws `ProgramPatchError` for a week outside the mesocycle or `from === to`.
 * Reads, in order: owned-program → mesocycle length → the program's set ids →
 * their overrides.
 */
export async function duplicateProgramWeek(
  userId: string,
  programId: string,
  fromWeek: number,
  toWeek: number,
  actor: ProgramEventActor,
  options?: { runIn?: PatchRunner },
): Promise<{ copied: number; cleared: number } | null> {
  return (options?.runIn ?? db).transaction(async (tx) => {
    const owned = await findOwnedProgramId(tx, userId, programId)
    if (!owned) return null
    await assertWeekInRange(tx, programId, [fromWeek, toWeek])
    if (fromWeek === toWeek) {
      throw new ProgramPatchError('a week cannot be duplicated onto itself')
    }
    const setIds = await programSetIds(tx, programId)
    const result = await replaceWeekOverrides(tx, setIds, fromWeek, [toWeek])
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'duplicate_program_week',
      summary: `Copy week ${fromWeek} targets onto week ${toWeek}`,
      payload: { fromWeek, toWeek, ...result },
    })
    return result
  })
}

/**
 * "Fill right" — the exercise-scoped sibling of duplicateProgramWeek: copies
 * one exercise's week-`fromWeek` overrides onto every week from `fromWeek + 1`
 * through `throughWeek` (inclusive), replacing whatever those weeks held. Same
 * deviations-not-derivations semantics, same replace-don't-merge stance; the
 * only difference is reach.
 *
 * Returns the copied/cleared counts and the weeks touched, or null when the
 * exercise isn't owned/found. Throws `ProgramPatchError` when the range is
 * empty or outside the mesocycle. Reads, in order: owned-exercise → mesocycle
 * length → the exercise's set ids → their overrides.
 */
export async function fillProgramWeeksRight(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  fromWeek: number,
  throughWeek: number,
  actor: ProgramEventActor,
  options?: { runIn?: PatchRunner },
): Promise<{ copied: number; cleared: number; weeks: number[] } | null> {
  return (options?.runIn ?? db).transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    await assertWeekInRange(tx, programId, [fromWeek, throughWeek])
    if (throughWeek <= fromWeek) {
      throw new ProgramPatchError(
        `fill right needs a later week than ${fromWeek} — got ${throughWeek}`,
      )
    }
    const weeks: number[] = []
    for (let week = fromWeek + 1; week <= throughWeek; week += 1) weeks.push(week)
    const rows = await tx
      .select({ id: programSets.id })
      .from(programSets)
      .where(eq(programSets.programExerciseId, found.exerciseId))
    const result = await replaceWeekOverrides(
      tx,
      rows.map((r) => r.id),
      fromWeek,
      weeks,
    )
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'fill_program_weeks',
      summary: `Fill week ${fromWeek} of ${found.name} right through week ${throughWeek} (Day ${dayPosition + 1})`,
      payload: { dayPosition, exercisePosition, fromWeek, weeks, ...result },
    })
    return { ...result, weeks }
  })
}

/** Every set id under one program — the reach of a program-wide week op. */
async function programSetIds(tx: Tx, programId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: programSets.id })
    .from(programSets)
    .innerJoin(programExercises, eq(programExercises.id, programSets.programExerciseId))
    .innerJoin(programDays, eq(programDays.id, programExercises.programDayId))
    .where(eq(programDays.programId, programId))
  return rows.map((r) => r.id)
}

// ---------------------------------------------------------------------------
// Quick-entry scheme apply
// ---------------------------------------------------------------------------

/** One planned set a scheme asks for, already in canonical kg (the tool /
 *  action layer converts, exactly as the single-set patch ops require). */
export interface SchemeSetRow {
  repMin: number
  repMax: number
  rir: number | null
  rpe: number | null
  suggestedLoadKg: number | null
}

/**
 * Reconciles one exercise's sets to EXACTLY the list a quick-entry scheme
 * describes (`5,5,3,3,1`, `3x8-12 @ 7RPE` — see lib/set-scheme.ts, which owns
 * the parsing): sets 1..n are updated in place, extra sets are appended, and
 * any tail beyond n is removed. One transaction, one event.
 *
 * This is the add/update/remove batch the affordance implies, as a SINGLE op.
 * A five-set scheme replacing a two-set exercise is 3 adds + 2 updates — five
 * patches through the granular path, and a ten-set one already eats half of
 * MAX_PROPOSAL_PATCHES before anything else in the batch. As one op it costs
 * one slot, and it cannot half-apply.
 *
 * `setType` and `metricMode` are preserved on surviving rows and default to
 * working / reps_weight on appended ones — a scheme prescribes targets, not
 * shape. Effort and load travel as the scheme gave them, INCLUDING nulls: a
 * scheme with no `@8RPE` clears a stale RPE rather than leaving a target the
 * author did not ask for. Every resulting row is revalidated (Phase-1
 * cross-field rules) before anything is written.
 *
 * Returns the per-kind counts, or null when the exercise isn't owned/found.
 * Throws `ProgramPatchError` on an empty scheme (an exercise needs ≥1 set —
 * remove the exercise instead) or an invalid resulting row.
 * Reads, in order: owned-exercise → the exercise's current set rows.
 */
export async function applyProgramSetScheme(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  schemeSets: readonly SchemeSetRow[],
  actor: ProgramEventActor,
  options?: { runIn?: PatchRunner; summary?: string },
): Promise<{ added: number; updated: number; removed: number } | null> {
  if (schemeSets.length === 0) {
    throw new ProgramPatchError(
      'a set scheme must describe at least one set — remove the exercise instead',
    )
  }
  return (options?.runIn ?? db).transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const current = await tx
      .select({
        setNumber: programSets.setNumber,
        metricMode: programSets.metricMode,
        durationSec: programSets.durationSec,
      })
      .from(programSets)
      .where(eq(programSets.programExerciseId, found.exerciseId))
      .orderBy(asc(programSets.setNumber))

    // Validate the whole outcome first — no row is written unless all can be.
    schemeSets.forEach((scheme, index) => {
      const existing = current[index]
      assertSetRowIntegrity({
        metricMode: existing?.metricMode ?? 'reps_weight',
        durationSec: existing?.durationSec ?? null,
        repMin: scheme.repMin,
        repMax: scheme.repMax,
      })
    })

    let updated = 0
    for (const [index, scheme] of schemeSets.entries()) {
      const values = {
        repMin: scheme.repMin,
        repMax: scheme.repMax,
        rir: scheme.rir,
        rpe: scheme.rpe,
        suggestedLoadKg: scheme.suggestedLoadKg,
      }
      if (index < current.length) {
        await tx
          .update(programSets)
          .set(values)
          .where(
            and(
              eq(programSets.programExerciseId, found.exerciseId),
              eq(programSets.setNumber, current[index].setNumber),
            ),
          )
        updated += 1
      } else {
        await tx.insert(programSets).values({
          programExerciseId: found.exerciseId,
          setNumber: index + 1,
          setType: 'working',
          metricMode: 'reps_weight',
          tempo: null,
          durationSec: null,
          distanceM: null,
          restSec: null,
          technique: null,
          ...values,
        })
      }
    }
    const removedNumbers = current.slice(schemeSets.length).map((r) => r.setNumber)
    if (removedNumbers.length > 0) {
      await tx
        .delete(programSets)
        .where(
          and(
            eq(programSets.programExerciseId, found.exerciseId),
            inArray(programSets.setNumber, removedNumbers),
          ),
        )
    }
    const added = Math.max(0, schemeSets.length - current.length)
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'apply_set_scheme',
      summary:
        options?.summary ??
        `Set scheme on ${found.name}: ${schemeSets.length} set${
          schemeSets.length === 1 ? '' : 's'
        } (Day ${dayPosition + 1})`,
      payload: {
        dayPosition,
        exercisePosition,
        added,
        updated,
        removed: removedNumbers.length,
        after: schemeSets,
      },
    })
    return { added, updated, removed: removedNumbers.length }
  })
}

// ---------------------------------------------------------------------------
// "Also apply to" — a progression rule across a scope
// ---------------------------------------------------------------------------

/** How far an "also apply to" reaches: the source exercise's day, or the whole program. */
export type ProgressionScope = 'day' | 'program'

// The schemes anchored to ONE lift's training max come from `substitute-slot`,
// shared with the swap path rather than re-declared here: both guards exist to
// stop a training max reaching a lift it was never measured on, and a second
// copy would let a newly added TM scheme be guarded in one place and not the
// other — silently reopening exactly this bug.

/**
 * Broadcasts one exercise's progression rule to its siblings — the "also apply
 * to: this day / this program" scope picker — as ONE op. Every other exercise
 * in scope gets the source's `progression` JSONB verbatim; the source itself is
 * untouched.
 *
 * TM-ANCHORED SCHEMES ARE REFUSED, not silently stripped. `percent-1rm` and
 * `amrap-cycle` carry a `trainingMaxKg` that belongs to ONE lift; broadcasting
 * it would prescribe the bench's training max to the squat — every derived load
 * in the program wrong, and wrong in a way that looks like a plan. Stripping the
 * TM instead is not an option either: those schemes are undefined without one.
 * So the op refuses with a message naming the scheme, and the coach sets those
 * training maxes per exercise (`set_training_max`), which is the only honest
 * answer. Same principle `substituteProgramExercise` applies when it clears
 * loads off a swapped slot (#215): structure transfers, lift-specific numbers
 * don't.
 *
 * Returns the number of exercises changed, or null when the source isn't
 * owned/found. Reads, in order: owned-exercise → source progression → the
 * in-scope exercise ids.
 */
export async function applyProgressionToScope(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  scope: ProgressionScope,
  actor: ProgramEventActor,
  options?: { runIn?: PatchRunner },
): Promise<{ updated: number } | null> {
  return (options?.runIn ?? db).transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const [row] = await tx
      .select({ progression: programExercises.progression })
      .from(programExercises)
      .where(eq(programExercises.id, found.exerciseId))
      .limit(1)
    if (!row) return null
    const progression = (row.progression ?? null) as Progression | null
    if (progression !== null && TM_BASED_SCHEMES.has(progression.scheme)) {
      throw new ProgramPatchError(
        `${found.name} uses ${progression.scheme}, whose training max belongs to that lift alone — set each exercise's training max instead of copying this rule across the ${scope}`,
      )
    }

    const targets = await tx
      .select({ id: programExercises.id })
      .from(programExercises)
      .innerJoin(programDays, eq(programDays.id, programExercises.programDayId))
      .where(
        scope === 'day'
          ? eq(programExercises.programDayId, found.dayId)
          : eq(programDays.programId, programId),
      )
    const targetIds = targets.map((t) => t.id).filter((id) => id !== found.exerciseId)
    if (targetIds.length === 0) return { updated: 0 }

    await tx
      .update(programExercises)
      .set({ progression })
      .where(inArray(programExercises.id, targetIds))
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'apply_progression_scope',
      summary: `Apply ${found.name}'s ${progression?.scheme ?? 'cleared'} progression to ${
        targetIds.length
      } other exercise${targetIds.length === 1 ? '' : 's'} (${
        scope === 'day' ? `Day ${dayPosition + 1}` : 'whole program'
      })`,
      payload: { dayPosition, exercisePosition, scope, updated: targetIds.length, progression },
    })
    return { updated: targetIds.length }
  })
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Buckets rows by a key — the id-remap tables the copy paths zip against. */
function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const bucket = map.get(key(row))
    if (bucket) bucket.push(row)
    else map.set(key(row), [row])
  }
  return map
}

/** Copies exactly the named fields off a row (a missing key becomes null, so a
 *  fill STATES every field it owns rather than leaving a stale one behind). */
function pickFields<T extends object, K extends keyof T & string>(
  row: T,
  fields: readonly K[],
): { [P in K]: T[P] | null } {
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null])) as {
    [P in K]: T[P] | null
  }
}

/** Validates a caller-supplied field subset against the fillable list — an
 *  unknown field name is a caller bug, not something to quietly ignore. */
function normalizeFields(
  fields: readonly (keyof SetTargets)[] | undefined,
): readonly (typeof TARGET_FIELDS)[number][] {
  if (fields === undefined) return TARGET_FIELDS
  if (fields.length === 0) throw new ProgramPatchError('fill needs at least one field')
  for (const field of fields) {
    if (!(TARGET_FIELDS as readonly string[]).includes(field)) {
      throw new ProgramPatchError(`"${field}" is not a fillable set target`)
    }
  }
  return fields as readonly (typeof TARGET_FIELDS)[number][]
}
