import {
  z,
} from 'zod'
import {
  setTypeSchema,
  metricModeSchema,
  techniqueSchema,
  progressionSchema,
  type Technique,
  type Progression,
} from '@/lib/programs/program-input'

import {
  ProgramPatchError,
} from './program-ownership'



export type SetType = z.infer<typeof setTypeSchema>
export type MetricMode = z.infer<typeof metricModeSchema>

/** A ZodError → a concise ProgramPatchError (first issue, path-prefixed). */
export function patchErrorFromZod(error: unknown, fallback: string): ProgramPatchError {
  if (error instanceof z.ZodError) {
    const first = error.issues[0]
    const path = first?.path.length ? `${first.path.join('.')}: ` : ''
    return new ProgramPatchError(`${path}${first?.message ?? fallback}`)
  }
  return new ProgramPatchError(error instanceof Error ? error.message : fallback)
}

/** Re-parses a non-null technique through the Phase-1 schema (normalizes `version`). */
export function parseTechnique(value: Technique): Technique {
  try {
    return techniqueSchema.parse(value)
  } catch (error: unknown) {
    throw patchErrorFromZod(error, 'invalid technique')
  }
}

/** Re-parses a non-null progression through the Phase-1 schema. */
export function parseProgression(value: Progression): Progression {
  try {
    return progressionSchema.parse(value)
  } catch (error: unknown) {
    throw patchErrorFromZod(error, 'invalid progression')
  }
}

/**
 * Re-parses a progression that came OUT of storage, preserving an absent
 * `tmBumpTiming`.
 *
 * `progressionSchema` ends in a transform that stamps 'after-deload' onto any
 * amrap-cycle config arriving without the field. That is the right backstop for
 * an incoming WRITE — a new config has to mean something — and the wrong one for
 * a row we are only merging into: the engine reads an absent field as
 * 'before-deload' (`?? 'before-deload'` in progression.ts's `usesOldTmOnDeload`
 * and `amrapBankableWaves`), so stamping it would silently move which training
 * max the deload week derives off. The lifter's deload weights change and
 * nothing explains it, because `tmBumpTiming` appears in no event payload.
 *
 * Absent stays absent; every other field goes through the schema as normal.
 * See docs/specs/progression-authoring.md §03.
 */
export function reparseStoredProgression(stored: Progression, merged: Progression): Progression {
  const parsed = parseProgression(merged)
  const wasAbsent = stored.scheme === 'amrap-cycle' && stored.tmBumpTiming === undefined
  if (!wasAbsent || parsed.scheme !== 'amrap-cycle') return parsed
  const preserved = { ...parsed }
  delete preserved.tmBumpTiming
  return preserved
}

/**
 * Cross-field integrity for a (merged) program-set row — the same shared rules
 * as `programSetSchema`, applied here because a partial edit merges against the
 * stored row, outside Zod's reach.
 */
/** Strips `undefined` entries so an omitted key never overwrites a stored value. */
export function definedFields<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}
