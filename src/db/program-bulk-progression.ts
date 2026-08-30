import { eq, inArray } from 'drizzle-orm'
import type { Progression } from '@/lib/program-input'
import { TM_BASED_SCHEMES } from '@/lib/workout/substitute-slot'
import { db } from './index'
import { recordProgramEvent, type ProgramEventActor } from './program-events'
import {
  ProgramPatchError,
  bumpUpdatedAt,
  findOwnedExercise,
  type PatchRunner,
} from './program-ownership'
import { programDays, programExercises } from './schema'

/**
 * "Also apply to" — broadcasting one exercise's progression RULE across a scope.
 *
 * This is the one bulk op that touches neither `program_sets` nor
 * `program_set_overrides`: it writes `program_exercises.progression` and nothing
 * else. Filing it with the set ops would put a rule-level edit behind a
 * set-level door and invite a future change to "reuse" the set-integrity
 * validation on it, which does not apply here at all.
 */

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
