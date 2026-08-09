import { z } from 'zod'
import { HOME_SECTION_REGISTRY } from './registry'

/**
 * The home layout document — how `user_preferences.home_layout` (jsonb) is
 * read, validated, and edited. Platform-agnostic like the registry: native
 * clients will interpret the same document.
 *
 * Read discipline (matches the equipment-column guard in db/preferences.ts):
 * stored jsonb is untrusted. Corrupt, absent, or unknown-version documents
 * degrade to DEFAULT_HOME_LAYOUT — degradation IS the reset path, so "Reset
 * to default" simply stores NULL.
 *
 * Forward compatibility, both directions:
 * - unknown `kind`s survive resolution (a newer client's section round-trips
 *   through an older one) and are skipped at RENDER, never an error;
 * - registry kinds missing from a stored doc are appended visible (an older
 *   doc gains newly shipped sections instead of hiding them forever).
 */

export const HOME_LAYOUT_VERSION = 1

const homeLayoutSchema = z.object({
  version: z.literal(HOME_LAYOUT_VERSION),
  sections: z.array(
    z.object({
      kind: z.string(),
      hidden: z.boolean().optional(),
    }),
  ),
})

export type HomeLayout = z.infer<typeof homeLayoutSchema>

/** One resolved row: hidden normalized to a required boolean. */
export interface ResolvedHomeSection {
  kind: string
  hidden: boolean
}

/** The code-defined default: registry order, everything visible. This is the
 *  pre-customization home, extracted — never derived from stored data. */
export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  version: HOME_LAYOUT_VERSION,
  sections: HOME_SECTION_REGISTRY.map((s) => ({ kind: s.kind })),
}

/**
 * Resolves an untrusted stored document into the section list home renders.
 * Never throws: every failure mode lands on the default.
 */
export function resolveHomeLayout(stored: unknown): ResolvedHomeSection[] {
  const parsed = homeLayoutSchema.safeParse(stored)
  const doc = parsed.success ? parsed.data : DEFAULT_HOME_LAYOUT
  const seen = new Set<string>()
  const sections: ResolvedHomeSection[] = []
  for (const s of doc.sections) {
    if (seen.has(s.kind)) continue // defensive: writes reject dupes, reads shrug
    seen.add(s.kind)
    sections.push({ kind: s.kind, hidden: s.hidden === true })
  }
  for (const { kind } of HOME_SECTION_REGISTRY) {
    if (!seen.has(kind)) sections.push({ kind, hidden: false })
  }
  return sections
}

/**
 * Boundary validation for WRITES (the server action). Stricter than the read
 * guard on purpose: our editor always writes a complete document, so unknown
 * kinds, duplicates, and missing kinds are client bugs worth rejecting loudly.
 */
export function parseHomeLayoutInput(input: unknown): HomeLayout {
  const parsed = homeLayoutSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error('invalid home layout')
  }
  const kinds = parsed.data.sections.map((s) => s.kind)
  const known = new Set<string>(HOME_SECTION_REGISTRY.map((s) => s.kind))
  if (kinds.some((k) => !known.has(k))) {
    throw new Error('unknown home section kind')
  }
  if (new Set(kinds).size !== kinds.length) {
    throw new Error('duplicate home section kind')
  }
  if (kinds.length !== known.size) {
    throw new Error('home layout must include every section')
  }
  return {
    version: HOME_LAYOUT_VERSION,
    sections: parsed.data.sections.map((s) =>
      s.hidden === true ? { kind: s.kind, hidden: true } : { kind: s.kind },
    ),
  }
}

/** Swaps `kind` with its neighbor. Returns the input array unchanged (same
 *  reference) when the move is impossible — edges or an unknown kind. */
export function moveSection(
  sections: readonly ResolvedHomeSection[],
  kind: string,
  direction: 'up' | 'down',
): readonly ResolvedHomeSection[] {
  const index = sections.findIndex((s) => s.kind === kind)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index === -1 || target < 0 || target >= sections.length) {
    return sections
  }
  const next = [...sections]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/** Flips a section's visibility. Returns the input unchanged for unknown kinds. */
export function toggleSection(
  sections: readonly ResolvedHomeSection[],
  kind: string,
): readonly ResolvedHomeSection[] {
  if (!sections.some((s) => s.kind === kind)) {
    return sections
  }
  return sections.map((s) => (s.kind === kind ? { ...s, hidden: !s.hidden } : s))
}

/** Serializes resolved sections back into the stored document shape,
 *  omitting `hidden: false` so the default round-trips byte-equal. */
export function toLayoutDoc(sections: readonly ResolvedHomeSection[]): HomeLayout {
  return {
    version: HOME_LAYOUT_VERSION,
    sections: sections.map((s) => (s.hidden ? { kind: s.kind, hidden: true } : { kind: s.kind })),
  }
}
