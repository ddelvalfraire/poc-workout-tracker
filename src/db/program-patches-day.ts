import {
  and,
  eq,
  gt,
  gte,
  lt,
  lte,
  max,
  sql,
} from 'drizzle-orm'

import {
  db,
} from './index'

import {
  recordProgramEvent,
  type ProgramEventActor,
} from './program-events'
import {
  bumpUpdatedAt,
  findOwnedDayId,
  findOwnedProgramId,
} from './program-ownership'

import {
  programDays,
} from './schema'
import {
  definedFields,
} from './program-patches-shared'

// ---------------------------------------------------------------------------
// Day ops
// ---------------------------------------------------------------------------

/** A day edit. An omitted key is left unchanged; `name` is required by the schema, so it can't be cleared. */
export interface ProgramDayPatch {
  name?: string
  notes?: string | null
}

/**
 * Appends a day at `max(position)+1`. Returns the new 0-based position, or null
 * when the program isn't owned.
 * Reads, in order: owned-program → max(position).
 */
export async function addProgramDay(
  userId: string,
  programId: string,
  day: { name: string; notes?: string | null },
  actor: ProgramEventActor,
): Promise<{ position: number } | null> {
  return db.transaction(async (tx) => {
    const owned = await findOwnedProgramId(tx, userId, programId)
    if (!owned) return null
    const [{ value: lastPosition }] = await tx
      .select({ value: max(programDays.position) })
      .from(programDays)
      .where(eq(programDays.programId, programId))
    const position = lastPosition === null ? 0 : lastPosition + 1
    await tx
      .insert(programDays)
      .values({ programId, name: day.name, position, notes: day.notes ?? null })
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'add_program_day',
      summary: `Add day "${day.name}" (Day ${position + 1})`,
      payload: { after: { name: day.name, notes: day.notes ?? null, position } },
    })
    return { position }
  })
}

/**
 * Updates a day's name and/or notes. Returns null when the patch is empty, the
 * program isn't owned, or no day sits at that position.
 * Reads, in order: owned-day.
 */
export async function updateProgramDay(
  userId: string,
  programId: string,
  dayPosition: number,
  patch: ProgramDayPatch,
  actor: ProgramEventActor,
): Promise<{ id: string } | null> {
  const values = definedFields(patch)
  if (Object.keys(values).length === 0) return null
  return db.transaction(async (tx) => {
    const dayId = await findOwnedDayId(tx, userId, programId, dayPosition)
    if (!dayId) return null
    const [updated] = await tx
      .update(programDays)
      .set(values)
      .where(eq(programDays.id, dayId))
      .returning({ id: programDays.id })
    if (!updated) return null
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'update_program_day',
      summary:
        values.name !== undefined
          ? `Rename Day ${dayPosition + 1} → "${values.name}"`
          : `Update Day ${dayPosition + 1} notes`,
      payload: { dayPosition, after: values },
    })
    return updated
  })
}

/**
 * Removes a day (cascade deletes its exercises/sets) and closes the position gap.
 * Reads, in order: owned-day.
 */
export async function removeProgramDay(
  userId: string,
  programId: string,
  dayPosition: number,
  actor: ProgramEventActor,
): Promise<{ removed: true } | null> {
  return db.transaction(async (tx) => {
    const dayId = await findOwnedDayId(tx, userId, programId, dayPosition)
    if (!dayId) return null
    await tx.delete(programDays).where(eq(programDays.id, dayId))
    await tx
      .update(programDays)
      .set({ position: sql`${programDays.position} - 1` })
      .where(and(eq(programDays.programId, programId), gt(programDays.position, dayPosition)))
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'remove_program_day',
      summary: `Remove Day ${dayPosition + 1}`,
      payload: { dayPosition },
    })
    return { removed: true }
  })
}

/**
 * Moves a day from one 0-based position to another, splice-renumbering the block
 * between them so positions stay contiguous. `from === to` is a no-op success;
 * an out-of-range `to` (no day there) is a not-found null.
 * Reads, in order: owned-day-at-from → day-exists-at-to.
 */
export async function moveProgramDay(
  userId: string,
  programId: string,
  from: number,
  to: number,
  actor: ProgramEventActor,
): Promise<{ moved: true } | null> {
  return db.transaction(async (tx) => {
    const movedId = await findOwnedDayId(tx, userId, programId, from)
    if (!movedId) return null
    if (from === to) return { moved: true }
    const [target] = await tx
      .select({ id: programDays.id })
      .from(programDays)
      .where(and(eq(programDays.programId, programId), eq(programDays.position, to)))
      .limit(1)
    if (!target) return null
    if (from < to) {
      await tx
        .update(programDays)
        .set({ position: sql`${programDays.position} - 1` })
        .where(
          and(
            eq(programDays.programId, programId),
            gt(programDays.position, from),
            lte(programDays.position, to),
          ),
        )
    } else {
      await tx
        .update(programDays)
        .set({ position: sql`${programDays.position} + 1` })
        .where(
          and(
            eq(programDays.programId, programId),
            gte(programDays.position, to),
            lt(programDays.position, from),
          ),
        )
    }
    await tx.update(programDays).set({ position: to }).where(eq(programDays.id, movedId))
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'move_program_day',
      summary: `Move Day ${from + 1} → Day ${to + 1}`,
      payload: { from, to },
    })
    return { moved: true }
  })
}
