/**
 * Muscle-name → display-bucket mapping for weekly volume. The input names are
 * whatever `mapMuscleNames` (lib/wger.ts) stored: wger's `name_en` when
 * non-empty, else the Latin `name` — the full observed set is pinned in the
 * test. Ten buckets read like a training plan (the anatomical 15 don't);
 * anything unrecognized rolls into the caller's "Other" so volume is never
 * silently dropped.
 */

/** Fixed display order — chest-to-calves push/pull/legs reading. */
export const MUSCLE_GROUPS = [
  'Chest',
  'Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Core',
] as const

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]

/** Every muscle name the catalog can emit, mapped to its bucket. Keys must
 *  match `mapMuscleNames` output exactly (case-sensitive). */
const NAME_TO_GROUP: Record<string, MuscleGroup> = {
  // name_en values
  Chest: 'Chest',
  Lats: 'Back',
  Shoulders: 'Shoulders',
  Biceps: 'Biceps',
  Triceps: 'Triceps',
  Quads: 'Quads',
  Hamstrings: 'Hamstrings',
  Glutes: 'Glutes',
  Calves: 'Calves',
  Abs: 'Core',
  // Latin fallbacks (wger rows with empty name_en)
  'Serratus anterior': 'Chest',
  Trapezius: 'Back',
  Brachialis: 'Biceps',
  Soleus: 'Calves',
  'Obliquus externus abdominis': 'Core',
}

/** The bucket for a catalog muscle name, or null when unrecognized (the
 *  caller decides how "Other" is presented — never dropped silently). */
export function muscleGroupFor(name: string): MuscleGroup | null {
  return NAME_TO_GROUP[name] ?? null
}

/** Every catalog muscle name the app understands — the vocabulary custom
 *  exercises tag with so their sets feed muscle-volume and the replacement
 *  suggestions exactly like wger entries. */
export const CATALOG_MUSCLE_NAMES = Object.keys(NAME_TO_GROUP)
