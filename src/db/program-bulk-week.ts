import { eq, inArray } from 'drizzle-orm'
import { db } from './index'
import { recordProgramEvent, type ProgramEventActor } from './program-events'
import {
  ProgramPatchError,
  bumpUpdatedAt,
  findOwnedExercise,
  findOwnedProgramId,
  type PatchRunner,
  type Tx,
} from './program-ownership'
import { OVERRIDE_FIELDS, pickFields, selectOverrides } from './program-bulk-shared'
import { programs, programDays, programExercises, programSets, programSetOverrides } from './schema'

/**
 * The week ops — "duplicate week" (program-wide) and "fill right"
 * (exercise-scoped). Both resolve against a schema in which A WEEK IS NOT AN
 * ENTITY, so both mean the same thing at different reach: replace the
 * `program_set_overrides` rows at the target weeks with copies of the source
 * week's. The machinery they share sits below, private to this module.
 */

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
