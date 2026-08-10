import { z } from 'zod'
import {
  HOME_SECTION_REGISTRY,
  HOME_SECTION_SIZES,
  type HomeSectionMeta,
  type HomeSectionSize,
} from './registry'

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
 *   doc gains newly shipped sections instead of hiding them forever);
 * - a v1 document (pre-size) is upgraded IN MEMORY on read — registry default
 *   sizes, never written back. The stored doc only advances when the user
 *   next edits their layout.
 *
 * Sizes are loose on READ (any string; unknown/missing/not-allowed normalize
 * to the kind's default) and strict on WRITE (must be in the kind's
 * allowedSizes). Serialization omits a size equal to the kind's default, so
 * the default document stays byte-minimal.
 */

export const HOME_LAYOUT_VERSION = 2

const homeLayoutSchema = z.object({
  version: z.literal(HOME_LAYOUT_VERSION),
  sections: z.array(
    z.object({
      kind: z.string(),
      // Loose on read — normalization (not the schema) owns size validity.
      size: z.string().optional(),
      hidden: z.boolean().optional(),
    }),
  ),
})

/** The pre-size document shape, accepted on READ only (in-memory upgrade). */
const homeLayoutV1Schema = z.object({
  version: z.literal(1),
  sections: z.array(
    z.object({
      kind: z.string(),
      hidden: z.boolean().optional(),
    }),
  ),
})

export type HomeLayout = z.infer<typeof homeLayoutSchema>

/** One resolved row: hidden normalized to a required boolean, size to a
 *  valid class (the kind's default when the doc doesn't say). */
export interface ResolvedHomeSection {
  kind: string
  size: HomeSectionSize
  hidden: boolean
}

const REGISTRY_BY_KIND: ReadonlyMap<string, HomeSectionMeta> = new Map(
  HOME_SECTION_REGISTRY.map((s) => [s.kind, s]),
)

/** Fallback for kinds the registry doesn't know (a future client's section —
 *  never rendered here, but resolution still needs a well-typed row). */
const FALLBACK_SIZE: HomeSectionSize = 'md'

function defaultSizeFor(kind: string): HomeSectionSize {
  return REGISTRY_BY_KIND.get(kind)?.defaultSize ?? FALLBACK_SIZE
}

function isHomeSectionSize(value: unknown): value is HomeSectionSize {
  return (HOME_SECTION_SIZES as readonly string[]).includes(value as string)
}

/** Read-side normalization: unknown, missing, or not-allowed → kind default. */
function normalizeSize(kind: string, size: string | undefined): HomeSectionSize {
  if (!isHomeSectionSize(size)) return defaultSizeFor(kind)
  const allowed = REGISTRY_BY_KIND.get(kind)?.allowedSizes
  // Unknown kind: any valid size class round-trips (its client knows better).
  if (allowed === undefined) return size
  return allowed.includes(size) ? size : defaultSizeFor(kind)
}

/** The code-defined default: registry order, everything visible, every size
 *  the kind's default (omitted — byte-minimal). This is the pre-customization
 *  home, extracted — never derived from stored data. */
export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  version: HOME_LAYOUT_VERSION,
  sections: HOME_SECTION_REGISTRY.map((s) => ({ kind: s.kind })),
}

/**
 * Resolves an untrusted stored document into the section list home renders.
 * Never throws: every failure mode lands on the default. A v1 document is
 * upgraded in memory (sizes default per kind) — never written back.
 */
export function resolveHomeLayout(stored: unknown): ResolvedHomeSection[] {
  const parsed = homeLayoutSchema.safeParse(stored)
  let doc: HomeLayout
  if (parsed.success) {
    doc = parsed.data
  } else {
    const v1 = homeLayoutV1Schema.safeParse(stored)
    doc = v1.success
      ? { version: HOME_LAYOUT_VERSION, sections: v1.data.sections }
      : DEFAULT_HOME_LAYOUT
  }
  const seen = new Set<string>()
  const sections: ResolvedHomeSection[] = []
  for (const s of doc.sections) {
    if (seen.has(s.kind)) continue // defensive: writes reject dupes, reads shrug
    seen.add(s.kind)
    sections.push({
      kind: s.kind,
      size: normalizeSize(s.kind, s.size),
      hidden: s.hidden === true,
    })
  }
  for (const { kind, defaultSize } of HOME_SECTION_REGISTRY) {
    if (!seen.has(kind)) sections.push({ kind, size: defaultSize, hidden: false })
  }
  return sections
}

/**
 * Boundary validation for WRITES (the server action). Stricter than the read
 * guard on purpose: our editor always writes a complete current-version
 * document, so unknown kinds, duplicates, missing kinds, and sizes outside a
 * kind's allowedSizes are client bugs worth rejecting loudly.
 */
export function parseHomeLayoutInput(input: unknown): HomeLayout {
  const strictSchema = homeLayoutSchema.extend({
    sections: z.array(
      z.object({
        kind: z.string(),
        size: z.enum(HOME_SECTION_SIZES).optional(),
        hidden: z.boolean().optional(),
      }),
    ),
  })
  const parsed = strictSchema.safeParse(input)
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
  for (const s of parsed.data.sections) {
    if (s.size !== undefined && !REGISTRY_BY_KIND.get(s.kind)!.allowedSizes.includes(s.size)) {
      throw new Error('invalid home section size')
    }
  }
  return {
    version: HOME_LAYOUT_VERSION,
    sections: parsed.data.sections.map((s) => toStoredSection(s.kind, s.size, s.hidden)),
  }
}

/** One stored row, byte-minimal: size omitted when it equals the kind's
 *  default, hidden omitted when false. */
function toStoredSection(
  kind: string,
  size: HomeSectionSize | undefined,
  hidden: boolean | undefined,
): HomeLayout['sections'][number] {
  return {
    kind,
    ...(size !== undefined && size !== defaultSizeFor(kind) ? { size } : {}),
    ...(hidden === true ? { hidden: true } : {}),
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

/** Sets a section's size class. Returns the input unchanged (same reference)
 *  for unknown kinds, sizes the kind doesn't allow, and no-op sets. */
export function setSectionSize(
  sections: readonly ResolvedHomeSection[],
  kind: string,
  size: HomeSectionSize,
): readonly ResolvedHomeSection[] {
  const current = sections.find((s) => s.kind === kind)
  if (current === undefined || current.size === size) return sections
  const allowed = REGISTRY_BY_KIND.get(kind)?.allowedSizes
  if (allowed === undefined || !allowed.includes(size)) return sections
  return sections.map((s) => (s.kind === kind ? { ...s, size } : s))
}

/** Serializes resolved sections back into the stored document shape, omitting
 *  `hidden: false` and default sizes so the default round-trips byte-equal. */
export function toLayoutDoc(sections: readonly ResolvedHomeSection[]): HomeLayout {
  return {
    version: HOME_LAYOUT_VERSION,
    sections: sections.map((s) => toStoredSection(s.kind, s.size, s.hidden)),
  }
}
