import { and, asc, eq } from 'drizzle-orm'
import type { CustomExerciseInput } from '@/lib/custom-exercise-input'
import { db } from './index'
import { customExercises } from './schema'

/**
 * Data access for custom exercises, always scoped to a Clerk userId.
 *
 * Like `db/programs.ts`, this module is the authorization boundary: the app has
 * no Postgres row-level security, so every query filters by `user_id` on the
 * `custom_exercises` root. Route/MCP handlers must go through these helpers
 * rather than touching the table directly, so a caller can never read or
 * mutate another user's custom exercises.
 *
 * Callers pass already-parsed `CustomExerciseInput` — validation happens at the
 * boundary (`parseCustomExerciseInput`), same as `saveProgram`. A duplicate
 * (user_id, name) create throws the raw Postgres unique violation; mapping it
 * to a clean tool error is the MCP layer's job (Phase 4). No delete in v1.
 */

/** Row type for consumers (Phase 3's catalog merge maps this to `Exercise`). */
export type CustomExerciseRow = typeof customExercises.$inferSelect

/** Lists a user's custom exercises, alphabetical by name. */
export function listCustomExercises(userId: string) {
  return db
    .select()
    .from(customExercises)
    .where(eq(customExercises.userId, userId))
    .orderBy(asc(customExercises.name))
}

/** Creates a custom exercise for the user; returns the new row (incl. its id). */
export async function createCustomExercise(
  userId: string,
  input: CustomExerciseInput,
): Promise<CustomExerciseRow> {
  const [row] = await db
    .insert(customExercises)
    .values({
      userId,
      name: input.name,
      category: input.category,
      equipment: input.equipment ?? null,
      muscles: input.muscles ?? null,
      musclesSecondary: input.musclesSecondary ?? null,
    })
    .returning()
  // An insert either returns the row or throws; guard the impossible empty
  // result so it fails loudly here instead of as a confusing undefined later.
  if (!row) throw new Error('createCustomExercise: insert returned no row')
  return row
}

/**
 * Full-field update (like `updateProgram`'s metadata — partial patch semantics
 * are a Phase 4 concern), gated on ownership via the `update ... returning`.
 * Returns null when the user doesn't own the exercise (or it doesn't exist).
 */
export async function updateCustomExercise(
  userId: string,
  id: number,
  input: CustomExerciseInput,
): Promise<CustomExerciseRow | null> {
  const [owned] = await db
    .update(customExercises)
    .set({
      name: input.name,
      category: input.category,
      equipment: input.equipment ?? null,
      muscles: input.muscles ?? null,
      musclesSecondary: input.musclesSecondary ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(customExercises.id, id), eq(customExercises.userId, userId)))
    .returning()
  return owned ?? null
}
