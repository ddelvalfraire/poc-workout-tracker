import type { MappedTemplate } from '@/lib/templates/wger-template-map'

/**
 * Shelf logic for the wger template library page — grouping, day chips, and
 * adopted-state matching as pure functions (testable without the page).
 *
 * ADOPTED-STATE TRUTH: an imported template's program row stores the
 * mapper's deterministic attribution link (`programs.source_url` =
 * `https://wger.de/en/routine/{id}/view`, written by saveProgram on import).
 * Matching is exact string equality on that URL — real provenance, not a
 * name heuristic. A program whose sourceUrl was cleared or never set simply
 * doesn't match; the card falls back to Add.
 */

/** One browse card's data: the wger id plus what the import would create. */
export interface ShelfCard {
  wgerId: number
  mapped: MappedTemplate
}

export interface ShelfGroup {
  daysPerWeek: number
  /** Zone header copy — "3-DAY" (font-display uppercase at render). */
  label: string
  cards: ShelfCard[]
}

/** Groups cards by training days/week, fewest first; card order within a
 *  group keeps the incoming (wger) order. Returns fresh structures. */
export function groupByDaysPerWeek(cards: readonly ShelfCard[]): ShelfGroup[] {
  const byDays = new Map<number, ShelfCard[]>()
  for (const card of cards) {
    const days = card.mapped.input.days.length
    const group = byDays.get(days)
    if (group) {
      group.push(card)
    } else {
      byDays.set(days, [card])
    }
  }
  return [...byDays.entries()]
    .sort(([a], [b]) => a - b)
    .map(([daysPerWeek, groupCards]) => ({
      daysPerWeek,
      label: `${daysPerWeek}-DAY`,
      cards: groupCards,
    }))
}

/** Day-name chips ("Push", "Pull", "Legs") from the mapped input already in
 *  memory — non-string/blank names drop out rather than render empty pills. */
export function dayNameChips(input: MappedTemplate['input']): string[] {
  return input.days
    .map((day) => (typeof day.name === 'string' ? day.name.trim() : ''))
    .filter((name) => name.length > 0)
}

/** The user's program that adopted this template (matched on the stored
 *  attribution URL), or null — null renders the Add CTA, never a fake link. */
export function findAdoptedProgram<T extends { id: string; sourceUrl: string | null }>(
  programs: readonly T[],
  sourceUrl: unknown,
): T | null {
  if (typeof sourceUrl !== 'string' || sourceUrl.length === 0) return null
  return programs.find((program) => program.sourceUrl === sourceUrl) ?? null
}
