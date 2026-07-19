import { and, asc, countDistinct, desc, eq } from 'drizzle-orm'
import type { WorkoutTemplateInput, TemplateMetaInput } from '@/lib/template-input'
import { db } from './index'
import { workoutTemplates, workoutTemplateExercises } from './schema'

/**
 * Data access for standalone workout templates, always scoped to a Clerk
 * userId. Like `db/workouts.ts`, this module is the authorization boundary:
 * no Postgres RLS exists, so every query filters by user_id on the
 * `workout_templates` root; children inherit ownership through template_id.
 *
 * Callers pass already-parsed input (`parseTemplateInput` /
 * `parseTemplateMeta`) — validation happens at the action boundary, same as
 * saveWorkout. Sharing is future work: authorActor stays 'owner' (the column
 * default) on every write here.
 */

/** A list row: template header plus how many exercises the sketch holds. */
export interface WorkoutTemplateSummary {
  id: string
  name: string
  description: string | null
  icon: string | null
  exerciseCount: number
  updatedAt: Date
}

/** Lists a user's templates, most recently updated first, with exercise counts. */
export function listWorkoutTemplates(userId: string) {
  return db
    .select({
      id: workoutTemplates.id,
      name: workoutTemplates.name,
      description: workoutTemplates.description,
      icon: workoutTemplates.icon,
      exerciseCount: countDistinct(workoutTemplateExercises.id),
      updatedAt: workoutTemplates.updatedAt,
    })
    .from(workoutTemplates)
    .leftJoin(
      workoutTemplateExercises,
      eq(workoutTemplateExercises.templateId, workoutTemplates.id),
    )
    .where(eq(workoutTemplates.userId, userId))
    .groupBy(workoutTemplates.id)
    .orderBy(desc(workoutTemplates.updatedAt))
}

/** Fetches one template with its exercises in order, only if owned by the user. */
export function getWorkoutTemplateDetail(userId: string, id: string) {
  return db.query.workoutTemplates.findFirst({
    where: and(eq(workoutTemplates.id, id), eq(workoutTemplates.userId, userId)),
    with: {
      exercises: { orderBy: (e) => [asc(e.position)] },
    },
  })
}

/** The full nested shape returned by getWorkoutTemplateDetail. */
export type WorkoutTemplateDetail = NonNullable<
  Awaited<ReturnType<typeof getWorkoutTemplateDetail>>
>

/**
 * Persists a template — the root row plus its exercises — atomically, owned
 * by the given user. `position` is the 0-based order of the input array.
 * Mirrors saveWorkout's transaction shape (single connection per checkout on
 * the transaction pooler).
 */
export async function createWorkoutTemplate(
  userId: string,
  input: WorkoutTemplateInput,
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [template] = await tx
      .insert(workoutTemplates)
      .values({
        userId,
        name: input.name,
        // Absent → null: the parsed input omits blank optionals.
        description: input.description ?? null,
        icon: input.icon ?? null,
      })
      .returning({ id: workoutTemplates.id })

    await tx.insert(workoutTemplateExercises).values(
      input.exercises.map((exercise, position) => ({
        templateId: template.id,
        wgerExerciseId: exercise.wgerExerciseId,
        name: exercise.name,
        position,
        // Omit when absent so the column defaults ('wger' / 'weight_reps')
        // apply — same additive rule as insertWorkoutChildren.
        ...(exercise.source !== undefined ? { source: exercise.source } : {}),
        ...(exercise.loggingType !== undefined ? { loggingType: exercise.loggingType } : {}),
        ...(exercise.notes !== undefined ? { notes: exercise.notes } : {}),
        plannedSets: exercise.plannedSets,
        ...(exercise.repMin !== undefined ? { repMin: exercise.repMin } : {}),
        ...(exercise.repMax !== undefined ? { repMax: exercise.repMax } : {}),
        ...(exercise.restSec !== undefined ? { restSec: exercise.restSec } : {}),
      })),
    )

    return { id: template.id }
  })
}

/**
 * Updates a template's metadata (name/description/icon) — never the exercise
 * sketch. Full-replace semantics on the optionals: absent clears to null,
 * matching the edit form that always shows all three fields. The
 * `update ... returning` is the ownership gate; null = not owned/gone.
 */
export async function updateWorkoutTemplateMeta(
  userId: string,
  id: string,
  meta: TemplateMetaInput,
): Promise<{ id: string } | null> {
  const [owned] = await db
    .update(workoutTemplates)
    .set({
      name: meta.name,
      description: meta.description ?? null,
      icon: meta.icon ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(workoutTemplates.id, id), eq(workoutTemplates.userId, userId)))
    .returning({ id: workoutTemplates.id })
  return owned ?? null
}

/** Deletes a template (exercises cascade) only if owned by the user. */
export function deleteWorkoutTemplate(userId: string, id: string) {
  return db
    .delete(workoutTemplates)
    .where(and(eq(workoutTemplates.id, id), eq(workoutTemplates.userId, userId)))
    .returning({ id: workoutTemplates.id })
}
