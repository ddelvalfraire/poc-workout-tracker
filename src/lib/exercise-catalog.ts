import type { ExerciseSource } from './custom-exercise-input'
import type { Exercise } from './wger'

/**
 * The merged exercise catalog's SHAPE and its pure accessors — everything that
 * reads a catalog without knowing how one is loaded.
 *
 * Exercise identity is the composite (source, id): a custom exercise's id can
 * collide with a wger id, so every lookup goes through `catalogKey` and a
 * custom id can never read a wger entry (or the reverse).
 *
 * CLIENT-SAFE, and deliberately so — the loader lives in db/exercise-catalog
 * because it touches Postgres, and modules bundled with the logger (the draft
 * seeders) need these accessors without dragging the db client into the
 * browser. Both imports here are type-only, so nothing server-side survives
 * into the bundle.
 */

/** The merged catalog keyed by the composite `${source}:${id}`; null = neither
 *  source available. */
export type ExerciseCatalog = ReadonlyMap<string, Exercise>

/** The composite catalog key — exercise identity is (source, id). Shared with
 *  db/prescriptions.ts, which keys history rows the same way. */
export function catalogKey(source: ExerciseSource, exerciseId: number): string {
  return `${source}:${exerciseId}`
}

/** One entry, or undefined when the (source, id) is unknown or the catalog is
 *  absent. The named accessors below are the intended read path; reach for this
 *  only when a caller needs the whole entry. */
export function catalogEntry(
  catalog: ExerciseCatalog | null | undefined,
  source: ExerciseSource,
  exerciseId: number,
): Exercise | undefined {
  return catalog?.get(catalogKey(source, exerciseId))
}

/**
 * The exercise's category (one of wger's fixed 8), or '' when unknown. Empty is
 * the honest answer, not a defect: category is catalog data — no workout or
 * program row stores it — so an outage or a delisted exercise simply drops the
 * label, exactly as every seeded draft read before it was looked up at all.
 */
export function catalogCategory(
  catalog: ExerciseCatalog | null | undefined,
  source: ExerciseSource,
  exerciseId: number,
): string {
  return catalogEntry(catalog, source, exerciseId)?.category ?? ''
}

/** The exercise's muscles, primary and secondary (wger English names). Empty
 *  arrays when untagged or unknown — the tag-rows-are-enrichment rule. */
export function catalogMuscles(
  catalog: ExerciseCatalog | null | undefined,
  source: ExerciseSource,
  exerciseId: number,
): { primary: string[]; secondary: string[] } {
  const entry = catalogEntry(catalog, source, exerciseId)
  return { primary: entry?.muscles ?? [], secondary: entry?.musclesSecondary ?? [] }
}
