import { z } from 'zod'
import {
  HOME_SECTION_REGISTRY,
  HOME_SECTION_SHAPES,
  type HomeSectionMeta,
  type HomeSectionShape,
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
 * - a v1 document (pre-shape) is upgraded IN MEMORY on read — registry default
 *   shapes, never written back. The stored doc only advances when the user
 *   next edits their layout.
 *
 * Shapes are loose on READ (any string; unknown/missing/not-allowed normalize
 * to the kind's default) and strict on WRITE (must be in the kind's
 * allowedShapes). Serialization omits a shape equal to the kind's default, so
 * the default document stays byte-minimal.
 *
 * IDENTITY (v3): a section is addressed by `id`, not by `kind`. Kinds marked
 * `repeatable` may appear more than once — a layout can hold two lift-trend
 * charts pinned to different lifts — so `kind` stopped being a unique key and
 * every mutation helper takes an id. For the once-only kinds that are all we
 * ship today the id simply IS the kind, which is why the stored document omits
 * it in that case and the default document is byte-identical to v2's.
 */

export const HOME_LAYOUT_VERSION = 3

const homeLayoutSchema = z.object({
  version: z.literal(HOME_LAYOUT_VERSION),
  sections: z.array(
    z.object({
      kind: z.string(),
      /** Instance identity. Omitted when it equals `kind` (the once-only
       *  case), so the common document carries no ids at all. */
      id: z.string().optional(),
      // Loose on read — normalization (not the schema) owns shape validity.
      shape: z.string().optional(),
      hidden: z.boolean().optional(),
    }),
  ),
})

/** The pre-identity document, accepted on READ only (in-memory upgrade):
 *  identical to v3 minus `id`, which resolution fills in from `kind`. */
const homeLayoutV2Schema = z.object({
  version: z.literal(2),
  sections: z.array(
    z.object({
      kind: z.string(),
      shape: z.string().optional(),
      hidden: z.boolean().optional(),
    }),
  ),
})

/** The pre-shape document shape, accepted on READ only (in-memory upgrade). */
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

/** One resolved row: hidden normalized to a required boolean, shape to a
 *  valid class (the kind's default when the doc doesn't say). */
export interface ResolvedHomeSection {
  /** Stable instance identity — what every mutation helper addresses. Equals
   *  `kind` for the once-only kinds; distinct per instance for repeatable
   *  ones. Unique within a layout, always. */
  id: string
  kind: string
  shape: HomeSectionShape
  hidden: boolean
}

const REGISTRY_BY_KIND: ReadonlyMap<string, HomeSectionMeta> = new Map(
  HOME_SECTION_REGISTRY.map((s) => [s.kind, s]),
)

/** Fallback for kinds the registry doesn't know (a future client's section —
 *  never rendered here, but resolution still needs a well-typed row). */
const FALLBACK_SHAPE: HomeSectionShape = 'wide'

function defaultShapeFor(kind: string): HomeSectionShape {
  return REGISTRY_BY_KIND.get(kind)?.defaultShape ?? FALLBACK_SHAPE
}

function isHomeSectionShape(value: unknown): value is HomeSectionShape {
  return (HOME_SECTION_SHAPES as readonly string[]).includes(value as string)
}

/** Read-side normalization: unknown, missing, or not-allowed → kind default. */
function normalizeShape(kind: string, shape: string | undefined): HomeSectionShape {
  if (!isHomeSectionShape(shape)) return defaultShapeFor(kind)
  const allowed = REGISTRY_BY_KIND.get(kind)?.allowedShapes
  // Unknown kind: any valid shape class round-trips (its client knows better).
  if (allowed === undefined) return shape
  return allowed.includes(shape) ? shape : defaultShapeFor(kind)
}

/** The code-defined default: registry order, everything visible, every shape
 *  the kind's default (omitted — byte-minimal). This is the pre-customization
 *  home, extracted — never derived from stored data. */
export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  version: HOME_LAYOUT_VERSION,
  sections: HOME_SECTION_REGISTRY.map((s) => ({ kind: s.kind })),
}

function isRepeatable(kind: string): boolean {
  return REGISTRY_BY_KIND.get(kind)?.repeatable === true
}

/**
 * Resolves an untrusted stored document into the section list home renders.
 * Never throws: every failure mode lands on the default. v1 and v2 documents
 * are upgraded in memory (v1 gains per-kind shapes, v2 gains ids from kinds) —
 * never written back.
 *
 * Identity is resolved defensively, because the stored id is untrusted: a
 * duplicate id is dropped (the first wins), and a repeated NON-repeatable
 * kind is dropped even when its ids differ, so a corrupt document can't put
 * two Momentum panels on the page. A repeatable kind therefore needs an
 * EXPLICIT id on every instance past the first — two bare `{kind}` rows both
 * resolve to the same id, and the second is dropped as the duplicate it is.
 */
export function resolveHomeLayout(stored: unknown): ResolvedHomeSection[] {
  const parsed = homeLayoutSchema.safeParse(stored)
  let doc: HomeLayout
  if (parsed.success) {
    doc = parsed.data
  } else {
    const v2 = homeLayoutV2Schema.safeParse(stored)
    if (v2.success) {
      doc = { version: HOME_LAYOUT_VERSION, sections: v2.data.sections }
    } else {
      const v1 = homeLayoutV1Schema.safeParse(stored)
      doc = v1.success
        ? { version: HOME_LAYOUT_VERSION, sections: v1.data.sections }
        : DEFAULT_HOME_LAYOUT
    }
  }
  const seenIds = new Set<string>()
  const seenKinds = new Set<string>()
  const sections: ResolvedHomeSection[] = []
  for (const s of doc.sections) {
    // An empty stored id is absent, not an id — `??` alone would let '' through
    // and hand every such section the same blank identity.
    const id = s.id !== undefined && s.id.length > 0 ? s.id : s.kind
    if (seenIds.has(id)) continue
    if (seenKinds.has(s.kind) && !isRepeatable(s.kind)) continue
    seenIds.add(id)
    seenKinds.add(s.kind)
    sections.push({
      id,
      kind: s.kind,
      shape: normalizeShape(s.kind, s.shape),
      hidden: s.hidden === true,
    })
  }
  for (const { kind, defaultShape } of HOME_SECTION_REGISTRY) {
    if (!seenKinds.has(kind)) sections.push({ id: kind, kind, shape: defaultShape, hidden: false })
  }
  return sections
}

/**
 * Boundary validation for WRITES (the server action). Stricter than the read
 * guard on purpose: our editor always writes a complete current-version
 * document, so unknown kinds, duplicates, missing kinds, and shapes outside a
 * kind's allowedShapes are client bugs worth rejecting loudly.
 */
export function parseHomeLayoutInput(input: unknown): HomeLayout {
  const strictSchema = homeLayoutSchema.extend({
    sections: z.array(
      z.object({
        kind: z.string(),
        id: z.string().min(1).optional(),
        shape: z.enum(HOME_SECTION_SHAPES).optional(),
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
  // Identity is what must be unique now. A repeated kind is legal only when
  // the registry says the kind repeats; ids are unique unconditionally, which
  // is what forces a repeatable kind's extra instances to carry explicit ids.
  const ids = parsed.data.sections.map((s) => s.id ?? s.kind)
  if (new Set(ids).size !== ids.length) {
    throw new Error('duplicate home section id')
  }
  const onceOnly = kinds.filter((k) => !isRepeatable(k))
  if (new Set(onceOnly).size !== onceOnly.length) {
    throw new Error('duplicate home section kind')
  }
  // Every registry kind must still appear at least once — a repeatable kind
  // may appear more, which is why this counts distinct kinds, not sections.
  if (new Set(kinds).size !== known.size) {
    throw new Error('home layout must include every section')
  }
  for (const s of parsed.data.sections) {
    if (s.shape !== undefined && !REGISTRY_BY_KIND.get(s.kind)!.allowedShapes.includes(s.shape)) {
      throw new Error('invalid home section shape')
    }
  }
  return {
    version: HOME_LAYOUT_VERSION,
    sections: parsed.data.sections.map((s) =>
      toStoredSection(s.kind, s.id ?? s.kind, s.shape, s.hidden),
    ),
  }
}

/** One stored row, byte-minimal: id omitted when it equals the kind, shape
 *  omitted when it equals the kind's default, hidden omitted when false. */
function toStoredSection(
  kind: string,
  id: string,
  shape: HomeSectionShape | undefined,
  hidden: boolean | undefined,
): HomeLayout['sections'][number] {
  return {
    kind,
    ...(id !== kind ? { id } : {}),
    ...(shape !== undefined && shape !== defaultShapeFor(kind) ? { shape } : {}),
    ...(hidden === true ? { hidden: true } : {}),
  }
}

/** Swaps the section with its neighbor. Returns the input array unchanged
 *  (same reference) when the move is impossible — edges or an unknown id. */
export function moveSection(
  sections: readonly ResolvedHomeSection[],
  id: string,
  direction: 'up' | 'down',
): readonly ResolvedHomeSection[] {
  const index = sections.findIndex((s) => s.id === id)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index === -1 || target < 0 || target >= sections.length) {
    return sections
  }
  const next = [...sections]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/** Moves the section to the front, preserving everyone else's relative order.
 *  Returns the input unchanged (same reference) when the section is already
 *  first or the id is unknown. */
export function moveSectionToTop(
  sections: readonly ResolvedHomeSection[],
  id: string,
): readonly ResolvedHomeSection[] {
  const index = sections.findIndex((s) => s.id === id)
  if (index <= 0) return sections
  const next = [...sections]
  const [moved] = next.splice(index, 1)
  next.unshift(moved)
  return next
}

/** Moves `activeId` to `overId`'s position (the drag preview's reorder),
 *  preserving everyone else's relative order. Returns the input unchanged
 *  (same reference) when either id is unknown or they already coincide. */
export function reorderSection(
  sections: readonly ResolvedHomeSection[],
  activeId: string,
  overId: string,
): readonly ResolvedHomeSection[] {
  const from = sections.findIndex((s) => s.id === activeId)
  const to = sections.findIndex((s) => s.id === overId)
  if (from === -1 || to === -1 || from === to) return sections
  const next = [...sections]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** Flips a section's visibility. Returns the input unchanged for unknown ids. */
export function toggleSection(
  sections: readonly ResolvedHomeSection[],
  id: string,
): readonly ResolvedHomeSection[] {
  if (!sections.some((s) => s.id === id)) {
    return sections
  }
  return sections.map((s) => (s.id === id ? { ...s, hidden: !s.hidden } : s))
}

/** Sets a section's shape class. Returns the input unchanged (same reference)
 *  for unknown ids, shapes the kind doesn't allow, and no-op sets. */
export function setSectionShape(
  sections: readonly ResolvedHomeSection[],
  id: string,
  shape: HomeSectionShape,
): readonly ResolvedHomeSection[] {
  const current = sections.find((s) => s.id === id)
  if (current === undefined || current.shape === shape) return sections
  const allowed = REGISTRY_BY_KIND.get(current.kind)?.allowedShapes
  if (allowed === undefined || !allowed.includes(shape)) return sections
  return sections.map((s) => (s.id === id ? { ...s, shape } : s))
}

/** Serializes resolved sections back into the stored document shape, omitting
 *  `hidden: false` and default shapes so the default round-trips byte-equal. */
export function toLayoutDoc(sections: readonly ResolvedHomeSection[]): HomeLayout {
  return {
    version: HOME_LAYOUT_VERSION,
    sections: sections.map((s) => toStoredSection(s.kind, s.id, s.shape, s.hidden)),
  }
}
