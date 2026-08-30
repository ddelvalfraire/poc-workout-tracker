import { and, eq } from 'drizzle-orm'
import { programSetIntegrityViolation } from '@/lib/programs/program-input'
import type { ExerciseSource } from '@/lib/exercises/custom-exercise-input'
import type { db } from './index'
import { programs, programDays, programExercises } from './schema'

/**
 * The ownership floor every program edit stands on — the join chain up to
 * `programs.user_id`, the transaction plumbing the ops run through, and the two
 * checks that guard a write once its address resolves.
 *
 * WHY THIS IS ITS OWN MODULE. Nothing here is an op: no function below writes a
 * `program_events` row, and none is a step a caller performs on its own. They
 * are the shared preconditions of the ops in `db/program-patches.ts` (granular)
 * and `db/program-bulk.ts` (fan-out), which is precisely why they used to be
 * exported from program-patches.ts and precisely why that was a problem — the
 * change-log ratchet in `program-events-completeness.test.ts` asserts that every
 * exported function of program-patches.ts is an op with a registered happy path,
 * and each non-op export forced a hand-maintained exception onto it. A ratchet
 * with a growing exception list stops ratcheting. Housed here, program-patches.ts
 * exports ops and only ops, and the check needs no exceptions at all.
 *
 * `ProgramPatchError`, `Tx` and `PatchRunner` live here rather than alongside the
 * ops for the same reason plus a mechanical one: the finders' signatures take a
 * `Tx`, `assertSetRowIntegrity` throws a `ProgramPatchError`, and both op modules
 * import them. Leaving them in program-patches.ts would make this module import
 * from the module that imports it — a cycle. They belong to the floor, not to
 * either storey built on it.
 *
 * The dependency arrow runs one way and never back:
 *   program-patches.ts ─┐
 *                       ├─→ program-ownership.ts
 *   program-bulk*.ts   ─┘
 */

/** An invalid edit (vs. `null` = not-found). The tool layer surfaces the message verbatim. */
export class ProgramPatchError extends Error {}

/**
 * The transaction handle, lifted from the callback signature (no internal
 * import). `db` is imported as a TYPE only, so this module carries no runtime
 * dependency on the connection pool — the ownership floor is pure enough to
 * import anywhere.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Where a patch op runs: the root `db` (the default — each op owns its own
 * transaction, unchanged behavior) or a caller-supplied runner that executes
 * the op's body inside an ALREADY-OPEN transaction. The two callers that need
 * the latter are the batch-proposal confirm (db/patch-proposals.ts — all
 * patches commit or none do) and the block-restart TM carry-forward
 * (cloneProgram — increments ride the clone's transaction). Ops stay
 * event-logged and actor-attributed identically either way.
 */
export interface PatchRunner {
  transaction<T>(cb: (tx: Tx) => Promise<T>): Promise<T>
}

/** Wraps an open transaction as a PatchRunner (the op's body just runs on it —
 *  a throw aborts the caller's whole transaction, which is the point). */
export function withTx(tx: Tx): PatchRunner {
  return { transaction: (cb) => cb(tx) }
}

/**
 * Cross-field integrity for a (merged) program-set row — the same shared rules
 * as `programSetSchema`, applied here because a partial edit merges against the
 * stored row, outside Zod's reach.
 */
export function assertSetRowIntegrity(row: {
  metricMode: string
  durationSec: number | null
  repMin: number | null
  repMax: number | null
}): void {
  const violation = programSetIntegrityViolation(row)
  if (violation) throw new ProgramPatchError(violation.message)
}

/** Marks the program as just-edited; ownership was already verified by the finder. */
export async function bumpUpdatedAt(tx: Tx, programId: string): Promise<void> {
  await tx.update(programs).set({ updatedAt: new Date() }).where(eq(programs.id, programId))
}

/**
 * Resolves the program's own id only when owned by the user — the ownership gate
 * for the day-level ops that don't address an existing day (add).
 */
export async function findOwnedProgramId(
  tx: Tx,
  userId: string,
  programId: string,
): Promise<string | null> {
  const [p] = await tx
    .select({ id: programs.id })
    .from(programs)
    .where(and(eq(programs.id, programId), eq(programs.userId, userId)))
    .limit(1)
  return p?.id ?? null
}

/**
 * Resolves a program-day id only when the program is owned by the user. The join
 * to `programs.userId` is the ownership gate for every day-level edit. Returns
 * null when the program isn't owned or no day sits at that 0-based position.
 */
export async function findOwnedDayId(
  tx: Tx,
  userId: string,
  programId: string,
  dayPosition: number,
): Promise<string | null> {
  const [pd] = await tx
    .select({ id: programDays.id })
    .from(programDays)
    .innerJoin(programs, eq(programs.id, programDays.programId))
    .where(
      and(
        eq(programDays.programId, programId),
        eq(programDays.position, dayPosition),
        eq(programs.userId, userId),
      ),
    )
    .limit(1)
  return pd?.id ?? null
}

/**
 * Resolves a program-exercise id (and its day id, for sibling renumbering) only
 * when the program is owned by the user — one join deeper than the workout twin:
 * program_exercises → program_days → programs.user_id.
 */
export async function findOwnedExercise(
  tx: Tx,
  userId: string,
  programId: string,
  dayPosition: number,
  exercisePosition: number,
): Promise<{
  exerciseId: string
  dayId: string
  wgerExerciseId: number
  source: ExerciseSource
  name: string
} | null> {
  const [pe] = await tx
    .select({
      exerciseId: programExercises.id,
      dayId: programDays.id,
      // Current identity halves, so a partial identity patch can retag with
      // the effective (source, id) — patch value ?? stored value.
      wgerExerciseId: programExercises.wgerExerciseId,
      source: programExercises.source,
      // Current name, so event summaries can say WHAT changed without a re-read.
      name: programExercises.name,
    })
    .from(programExercises)
    .innerJoin(programDays, eq(programDays.id, programExercises.programDayId))
    .innerJoin(programs, eq(programs.id, programDays.programId))
    .where(
      and(
        eq(programDays.programId, programId),
        eq(programDays.position, dayPosition),
        eq(programExercises.position, exercisePosition),
        eq(programs.userId, userId),
      ),
    )
    .limit(1)
  return pe ?? null
}
