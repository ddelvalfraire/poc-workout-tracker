/**
 * Validation boundary for custom exercises — user-defined movements wger's
 * catalog lacks. The app-side parity target is the `Exercise` shape in
 * `lib/wger.ts` (id/name/category/equipment/muscles/musclesSecondary), so a
 * custom row can stand in anywhere a catalog exercise can.
 *
 * `category` is enforced to wger's fixed 8-category set so merged catalog
 * filtering stays coherent (a custom "Nordic Curl" filters under Legs exactly
 * like a wger exercise would). Muscles/equipment are free text — wger English
 * names by convention, unenforced.
 *
 * `ExerciseSource` lives here (not `program-input.ts`) because later phases
 * thread it through both the workout and program surfaces.
 */
import { z } from 'zod'

// Mirror the bounds in `workout-input.ts` (they aren't exported there).
const MAX_NAME = 200

/** wger's fixed category set (GET /api/v2/exercisecategory/, verified 2026-07-04). */
export const EXERCISE_CATEGORIES = [
  'Abs',
  'Arms',
  'Back',
  'Calves',
  'Cardio',
  'Chest',
  'Legs',
  'Shoulders',
] as const

/** Where an exercise id points: the wger catalog or the user's `custom_exercises`. */
export const exerciseSourceSchema = z.enum(['wger', 'custom'])
/** Exercise category, restricted to wger's set so merged filtering stays coherent. */
export const exerciseCategorySchema = z.enum(EXERCISE_CATEGORIES)

const freeTextItemSchema = z.string().trim().min(1).max(100)

/** A custom exercise definition — the writable subset of the `Exercise` shape. */
export const customExerciseInputSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME),
    category: exerciseCategorySchema,
    equipment: z.array(freeTextItemSchema).max(10).optional(),
    muscles: z.array(freeTextItemSchema).max(20).optional(),
    musclesSecondary: z.array(freeTextItemSchema).max(20).optional(),
  })
  .strict()

export type ExerciseSource = z.infer<typeof exerciseSourceSchema>
export type ExerciseCategory = z.infer<typeof exerciseCategorySchema>
export type CustomExerciseInput = z.infer<typeof customExerciseInputSchema>

/**
 * Validates untrusted input into a normalized `CustomExerciseInput`, throwing a
 * `ZodError` on any malformed field. Returns a fresh object — the caller's
 * input is never mutated.
 */
export function parseCustomExerciseInput(input: unknown): CustomExerciseInput {
  return customExerciseInputSchema.parse(input)
}
