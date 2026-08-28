/**
 * The registry of home's OPTIONAL sections — the customization contract.
 *
 * PLATFORM-AGNOSTIC BY LAW: entries are data only (semantic kind + copy +
 * size classes), never React components. The web render mapping lives in
 * `src/app/home-sections.tsx`; future native clients (SwiftUI/Compose) will
 * consume this same contract and the same stored layout document.
 *
 * StatusHero and CheckInCard are deliberately NOT here: they always render,
 * always first, and are never customizable.
 *
 * History is deliberately NOT here either: the full log lives at /history.
 * Stored documents that still name it resolve fine (unknown kinds round-trip
 * and are skipped at render), so removal needed no migration.
 *
 * Array order IS the default home order.
 */

/**
 * Abstract TILE SHAPES, two-dimensional by construction. A one-dimensional
 * size ('sm' | 'md' | 'lg') could only ever vary a tile's width, which is a
 * responsive card list rather than a bento — the vertical break is what stops
 * a grid reading as a stack. Each platform maps these to its own grid (web:
 * home-sections.tsx); the units below are columns x rows on the phone's
 * 2-column grid, and wider breakpoints re-map them.
 */
export type HomeSectionShape = 'micro' | 'wide' | 'tall' | 'block' | 'hero'

export const HOME_SECTION_SHAPES = [
  'micro',
  'wide',
  'tall',
  'block',
  'hero',
] as const satisfies readonly HomeSectionShape[]

/** Columns x rows per shape on the phone grid. The single source for spans —
 *  every platform reads these rather than hard-coding its own. */
export const SHAPE_UNITS: Record<HomeSectionShape, { cols: number; rows: number }> = {
  micro: { cols: 1, rows: 1 },
  wide: { cols: 2, rows: 1 },
  tall: { cols: 1, rows: 2 },
  block: { cols: 2, rows: 2 },
  hero: { cols: 2, rows: 3 },
}

/** The `HomeSection` catalog keys, written out rather than derived from
 *  `kind` — a template-literal type would type-check against nothing, and the
 *  point of the generated key types is that a missing message is a compile
 *  error. */
export type HomeSectionTitleKey =
  | 'title.momentum'
  | 'title.todayRecap'
  | 'title.unfinished'
  | 'title.cardioWeek'
  | 'title.bigThree'
  | 'title.paceRecord'

export type HomeSectionDescriptionKey =
  | 'description.momentum'
  | 'description.todayRecap'
  | 'description.unfinished'
  | 'description.cardioWeek'
  | 'description.bigThree'
  | 'description.paceRecord'

/** The registry's copy is CATALOG KEYS, not sentences: entries are data
 *  shared by the editor grid, the tile sheet and (later) native clients, none
 *  of which can be handed an English string. Both resolve against the
 *  `HomeSection` namespace, and they are written out per entry rather than
 *  derived from `kind` so the generated key types still check them. */
export interface HomeSectionMeta {
  /** Stable semantic id — what the layout document stores. Never rename. */
  kind: string
  /** Short label for the editor row. */
  titleKey: HomeSectionTitleKey
  /** One benefit-first clause for the editor row's hint. */
  descriptionKey: HomeSectionDescriptionKey
  /** Shapes this section knows how to render — the write boundary rejects
   *  anything else; reads normalize to `defaultShape`. */
  allowedShapes: readonly HomeSectionShape[]
  /** The shape a section gets when the document doesn't say (and what
   *  serialization omits). */
  defaultShape: HomeSectionShape
  /** Whether a layout may hold MORE THAN ONE instance of this kind. Only
   *  meaningful for sections that carry per-instance config — a pinned lift
   *  trend is the motivating case (two charts, two different lifts). Absent
   *  means once-only, which is every kind shipped today. */
  repeatable?: boolean
}

export const HOME_SECTION_REGISTRY = [
  {
    kind: 'momentum',
    titleKey: 'title.momentum',
    descriptionKey: 'description.momentum',
    allowedShapes: ['micro', 'wide', 'block'],
    defaultShape: 'wide',
  },
  {
    kind: 'today-recap',
    titleKey: 'title.todayRecap',
    descriptionKey: 'description.todayRecap',
    allowedShapes: ['micro', 'wide'],
    defaultShape: 'wide',
  },
  {
    kind: 'unfinished',
    titleKey: 'title.unfinished',
    descriptionKey: 'description.unfinished',
    allowedShapes: ['wide'],
    defaultShape: 'wide',
  },
  {
    kind: 'cardio-week',
    titleKey: 'title.cardioWeek',
    descriptionKey: 'description.cardioWeek',
    allowedShapes: ['micro', 'wide'],
    defaultShape: 'micro',
  },
  {
    kind: 'big-three',
    titleKey: 'title.bigThree',
    descriptionKey: 'description.bigThree',
    allowedShapes: ['wide', 'block', 'hero'],
    defaultShape: 'block',
  },
  {
    kind: 'pace-record',
    titleKey: 'title.paceRecord',
    descriptionKey: 'description.paceRecord',
    allowedShapes: ['micro', 'tall'],
    defaultShape: 'micro',
  },
] as const satisfies readonly HomeSectionMeta[]

export type HomeSectionKind = (typeof HOME_SECTION_REGISTRY)[number]['kind']
