/**
 * Pure ranking for the replace-sheet's "Suggested" rail: alternatives to the
 * exercise being swapped out, scored from the already-loaded wger catalog.
 * Dependency-free on purpose — the interface is structural, so wger's
 * Exercise, the picker's widened result type, and (one day) custom-exercise
 * rows all feed the same ranker.
 */

/** The catalog subset the ranker reads — structurally satisfied by both
 *  wger's Exercise and the picker's widened ExerciseResult. */
export interface AlternativeCandidate {
  id: number
  name: string
  category: string
  equipment?: string[]
  muscles?: string[]
  musclesSecondary?: string[]
}

/** Compound ≈ touches ≥2 distinct muscles (primary + secondary) — wger has
 *  no explicit flag; muscle breadth is the honest proxy. No data → false. */
export function isCompound(e: AlternativeCandidate): boolean {
  return new Set([...(e.muscles ?? []), ...(e.musclesSecondary ?? [])]).size >= 2
}

// Integer weights, deliberately simple/tunable. Scale parity matters because
// compound and isolation loads don't correlate (PRD decision); equipment is
// penalized because the CURRENT machine is the one that's taken.
const SHARED_PRIMARY_WEIGHT = 3
const SCALE_PARITY_BONUS = 2
const SAME_CATEGORY_BONUS = 1
const SHARED_EQUIPMENT_PENALTY = 1

/**
 * Alternatives for the exercise being replaced, best first: candidates must
 * share ≥1 PRIMARY muscle (a curl never suggests a row — secondary movers
 * don't qualify); ranked by primary overlap, movement-scale parity, category,
 * and equipment difference; ties break alphabetically so the rail is
 * deterministic. Unknown id or a current without muscle data → [] — the
 * sheet falls back to search-only (exactly Phase 1 behavior).
 */
export function rankAlternatives(
  currentId: number,
  catalog: readonly AlternativeCandidate[],
  count = 5,
): AlternativeCandidate[] {
  const current = catalog.find((e) => e.id === currentId)
  const currentPrimaries = current?.muscles ?? []
  if (!current || currentPrimaries.length === 0) return []
  const currentEquipment = new Set(current.equipment ?? [])
  const currentCompound = isCompound(current)

  return catalog
    .flatMap((candidate) => {
      if (candidate.id === current.id) return []
      const shared = (candidate.muscles ?? []).filter((m) => currentPrimaries.includes(m))
      if (shared.length === 0) return []
      const sharesEquipment = (candidate.equipment ?? []).some((t) => currentEquipment.has(t))
      const score =
        shared.length * SHARED_PRIMARY_WEIGHT +
        (isCompound(candidate) === currentCompound ? SCALE_PARITY_BONUS : 0) +
        (candidate.category === current.category ? SAME_CATEGORY_BONUS : 0) -
        (sharesEquipment ? SHARED_EQUIPMENT_PENALTY : 0)
      return [{ candidate, score }]
    })
    .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name))
    .slice(0, count)
    .map((s) => s.candidate)
}
