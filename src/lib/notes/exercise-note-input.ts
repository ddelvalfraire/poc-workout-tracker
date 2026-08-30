import { z } from 'zod'

/**
 * Boundary validation for exercise-identity notes (the seat-pin notes), same
 * pattern as `custom-exercise-input.ts`: server actions and MCP tools parse
 * here before any db call. `body` is a markdown STRING — markdown is the
 * source of truth (agents read/write it; editor JSON is never persisted).
 */

/** Generous but bounded — a note is setup context, not a document. */
export const MAX_NOTE_BODY = 10_000

const exerciseNoteInputSchema = z.object({
  // Trimmed emptiness is rejected: clearing a note is an explicit delete, not
  // an upsert of "" (the show-gating everywhere checks note presence, and an
  // empty stored body would render a blank chip).
  body: z
    .string()
    .max(MAX_NOTE_BODY)
    .refine((s) => s.trim().length > 0, 'note body must not be blank'),
  pinned: z.boolean().optional().default(false),
})

export type ExerciseNoteInput = z.infer<typeof exerciseNoteInputSchema>

/** Parses unknown input into a note payload; throws ZodError on bad shape. */
export function parseExerciseNoteInput(input: unknown): ExerciseNoteInput {
  return exerciseNoteInputSchema.parse(input)
}
