import {
  eq,
} from 'drizzle-orm'

import {
  type Progression,
} from '@/lib/program-input'

import {
  db,
} from './index'

import {
  recordProgramEvent,
  type ProgramEventActor,
} from './program-events'
import {
  ProgramPatchError,
  bumpUpdatedAt,
  findOwnedExercise,
  type PatchRunner,
} from './program-ownership'

import {
  programExercises,
} from './schema'
import {
  reparseStoredProgression,
} from './program-patches-shared'

export type TrainingMaxReason = 'cycle-end' | 'reset' | 'manual' | 'block-restart'

/** Trims float noise for event summaries (kg, max 1 decimal): 142.5 stays
 *  142.5, 140.0000001 reads 140. Payloads keep full precision. */
function formatKg(valueKg: number): string {
  return String(Math.round(valueKg * 10) / 10)
}

/**
 * THE single call site for every training-max change (TM lifecycle plan §1):
 * updates ONLY `progression.trainingMaxKg` on a percent-1rm / amrap-cycle
 * exercise — other schemes carry no TM and throw `ProgramPatchError` — and
 * logs `action: 'adjust_training_max'` with `{before, after, reason}` in the
 * same transaction ("Squat TM 140 → 145 kg (cycle-end)"). Every other
 * progression field is preserved verbatim (a TM move must never cost wave or
 * percent structure). `options.bankedWaves` is the wave-boundary persist's
 * private marker (see program-input.ts): it stamps how many completed waves
 * the new TM already folds in, so derive stops re-adding them — callers other
 * than instantiation never pass it. Returns null when the exercise isn't
 * owned/found. Reads, in order: owned-exercise → current progression.
 */
export async function setTrainingMax(
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
  trainingMaxKg: number,
  reason: TrainingMaxReason,
  actor: ProgramEventActor,
  options?: { bankedWaves?: number; runIn?: PatchRunner },
): Promise<{ id: string; trainingMaxKg: number } | null> {
  if (!Number.isFinite(trainingMaxKg) || trainingMaxKg < 0) {
    throw new ProgramPatchError('trainingMax must be a non-negative number')
  }
  return (options?.runIn ?? db).transaction(async (tx) => {
    const found = await findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
    if (!found) return null
    const [row] = await tx
      .select({ progression: programExercises.progression })
      .from(programExercises)
      .where(eq(programExercises.id, found.exerciseId))
      .limit(1)
    if (!row) return null
    const progression = row.progression as Progression | null
    if (progression?.scheme !== 'percent-1rm' && progression?.scheme !== 'amrap-cycle') {
      throw new ProgramPatchError(
        `${found.name} uses ${progression?.scheme ?? 'no'} progression — a training max applies only to percent-1rm or amrap-cycle exercises`,
      )
    }
    const before = progression.trainingMaxKg
    // Immutable merge: only the TM (and, for the wave persist, its banked-wave
    // marker) moves; wave/percent structure is preserved verbatim.
    const next: Progression = {
      ...progression,
      trainingMaxKg,
      ...(progression.scheme === 'amrap-cycle' && options?.bankedWaves !== undefined
        ? { bankedWaves: options.bankedWaves }
        : {}),
    }
    await tx
      .update(programExercises)
      .set({ progression: reparseStoredProgression(progression, next) })
      .where(eq(programExercises.id, found.exerciseId))
    await bumpUpdatedAt(tx, programId)
    await recordProgramEvent(tx, {
      programId,
      userId,
      actor,
      action: 'adjust_training_max',
      summary: `${found.name} TM ${formatKg(before)} → ${formatKg(trainingMaxKg)} kg (${reason})`,
      payload: {
        dayPosition,
        exercisePosition,
        before: { trainingMaxKg: before },
        after: { trainingMaxKg },
        reason,
      },
    })
    return { id: found.exerciseId, trainingMaxKg }
  })
}
