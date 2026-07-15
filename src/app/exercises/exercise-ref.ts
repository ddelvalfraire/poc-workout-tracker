import type { ExerciseSource } from '@/lib/custom-exercise-input'

/**
 * URL-boundary codec for the composite exercise identity — /exercises routes
 * address an exercise as `/exercises/[source]/[id]`, and these params arrive
 * as untrusted strings. Validation lives here (not in the page) so the pages
 * stay render-only and Phase-3's sheet builds the same hrefs.
 */

export interface ExerciseRef {
  source: ExerciseSource
  wgerExerciseId: number
}

/** Digits only — rejects '1.5', '1e3', '-1', '' before parseInt ever runs. */
const ID_PATTERN = /^\d+$/

/**
 * Parses route params into a validated ref, or null for anything that isn't
 * ('wger' | 'custom') + a positive safe-integer id. Null means 404, not throw:
 * a guessed URL is a missing page, never an error.
 */
export function parseExerciseRef(source: string, id: string): ExerciseRef | null {
  if (source !== 'wger' && source !== 'custom') return null
  if (!ID_PATTERN.test(id)) return null
  const parsed = parseInt(id, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null
  return { source, wgerExerciseId: parsed }
}

/** The canonical detail-page href for a ref — the single place the URL shape lives. */
export function exerciseHref(ref: ExerciseRef): string {
  return `/exercises/${ref.source}/${ref.wgerExerciseId}`
}
