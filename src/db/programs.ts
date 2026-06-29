import { and, asc, desc, eq } from 'drizzle-orm'
import type { ProgramInput } from '@/lib/program-input'
import { db } from './index'
import { programs, programDays, programExercises, programSets } from './schema'

/**
 * Data access for training programs, always scoped to a Clerk userId.
 *
 * Like `db/workouts.ts`, this module is the authorization boundary: the app has
 * no Postgres row-level security, so every query filters by `user_id` on the
 * `programs` root and the children inherit ownership through the FK chain
 * (programs → program_days → program_exercises → program_sets). Route/MCP
 * handlers must go through these helpers rather than touching `program_*`
 * tables directly, so a caller can never read or mutate another user's program.
 */

/** Lists a user's programs, most recently updated first. */
export function listPrograms(userId: string) {
  return db
    .select()
    .from(programs)
    .where(eq(programs.userId, userId))
    .orderBy(desc(programs.updatedAt))
}

/** Fetches a single program with its days/exercises/sets, only if owned by the user. */
export function getProgramDetail(userId: string, id: string) {
  return db.query.programs.findFirst({
    where: and(eq(programs.id, id), eq(programs.userId, userId)),
    with: {
      days: {
        orderBy: (d) => [asc(d.position)],
        with: {
          exercises: {
            orderBy: (e) => [asc(e.position)],
            with: { sets: { orderBy: (s) => [asc(s.setNumber)] } },
          },
        },
      },
    },
  })
}

/** The full nested shape returned by getProgramDetail (program + days + exercises + sets). */
export type ProgramDetail = NonNullable<Awaited<ReturnType<typeof getProgramDetail>>>

/** The transaction handle, lifted from the callback signature (no internal import). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Inserts a program's days → exercises → sets (shared by saveProgram and
 * updateProgram). `position` is the 0-based order within its parent; `setNumber`
 * is 1-based within its exercise — mirroring `insertWorkoutChildren`.
 */
async function insertProgramChildren(tx: Tx, programId: string, days: ProgramInput['days']) {
  for (const [dayPosition, day] of days.entries()) {
    const [pd] = await tx
      .insert(programDays)
      .values({ programId, name: day.name, position: dayPosition, notes: day.notes ?? null })
      .returning({ id: programDays.id })

    for (const [exPosition, exercise] of day.exercises.entries()) {
      const [pe] = await tx
        .insert(programExercises)
        .values({
          programDayId: pd.id,
          wgerExerciseId: exercise.wgerExerciseId,
          name: exercise.name,
          position: exPosition,
          progression: exercise.progression ?? null,
        })
        .returning({ id: programExercises.id })

      if (exercise.sets.length > 0) {
        await tx.insert(programSets).values(
          exercise.sets.map((s, i) => ({
            programExerciseId: pe.id,
            setNumber: i + 1,
            setType: s.setType,
            metricMode: s.metricMode,
            repMin: s.repMin ?? null,
            repMax: s.repMax ?? null,
            rir: s.rir ?? null,
            rpe: s.rpe ?? null,
            suggestedLoadKg: s.suggestedLoadKg ?? null,
            tempo: s.tempo ?? null,
            durationSec: s.durationSec ?? null,
            distanceM: s.distanceM ?? null,
            technique: s.technique ?? null,
          })),
        )
      }
    }
  }
}

/**
 * Persists a full program — the `programs` row plus its nested days/exercises/
 * sets — for the given user, atomically. Everything runs inside one
 * `db.transaction`, so a partial save can never happen. The program is stamped
 * with `userId`; the children inherit ownership through the FK chain.
 */
export async function saveProgram(userId: string, input: ProgramInput): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [program] = await tx
      .insert(programs)
      .values({
        userId,
        name: input.name,
        status: input.status,
        mesocycleWeeks: input.mesocycleWeeks,
        deloadWeek: input.deloadWeek ?? null,
        notes: input.notes ?? null,
      })
      .returning({ id: programs.id })

    await insertProgramChildren(tx, program.id, input.days)

    return { id: program.id }
  })
}

/**
 * Replaces a program's metadata + days/exercises/sets atomically, only if owned
 * by the user. The `update ... returning` doubles as the ownership gate: no row
 * back means the caller doesn't own it (or it's gone) and nothing is mutated.
 * Children are deleted (cascade removes their descendants) and re-inserted.
 */
export async function updateProgram(
  userId: string,
  id: string,
  input: ProgramInput,
): Promise<{ id: string } | null> {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .update(programs)
      .set({
        name: input.name,
        status: input.status,
        mesocycleWeeks: input.mesocycleWeeks,
        deloadWeek: input.deloadWeek ?? null,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(programs.id, id), eq(programs.userId, userId)))
      .returning({ id: programs.id })
    if (!owned) return null

    await tx.delete(programDays).where(eq(programDays.programId, id))
    await insertProgramChildren(tx, id, input.days)
    return { id }
  })
}

/** Deletes a program (and its children, via FK cascade) only if owned by the user. */
export function deleteProgram(userId: string, id: string) {
  return db
    .delete(programs)
    .where(and(eq(programs.id, id), eq(programs.userId, userId)))
    .returning({ id: programs.id })
}

/**
 * Updates only a program's lifecycle status, gated on ownership via the
 * `update ... returning`. Returns null when the user doesn't own the program.
 */
export async function setProgramStatus(
  userId: string,
  id: string,
  status: ProgramInput['status'],
): Promise<{ id: string } | null> {
  const [owned] = await db
    .update(programs)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(programs.id, id), eq(programs.userId, userId)))
    .returning({ id: programs.id })
  return owned ?? null
}
