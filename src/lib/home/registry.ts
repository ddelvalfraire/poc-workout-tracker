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

/** The column count at each breakpoint the stylesheet renders (globals.css
 *  `.home-bento`). Lives here rather than beside the CSS because the packer
 *  runs once per tier on every client, and a native home has no stylesheet to
 *  read it from. */
export const HOME_COLUMN_TIERS = [2, 4, 6] as const

export type HomeColumnTier = (typeof HOME_COLUMN_TIERS)[number]

/**
 * Spans per tier.
 *
 * `SHAPE_UNITS` is the PHONE table, and reusing it verbatim at 4 and 6
 * columns is a bug with a tidy disguise: the spans stay legal, so nothing
 * errors, but `block` — the anchor every preset is composed around — becomes
 * two columns of six, and the widest viewport renders the smallest-looking
 * anchor. The shapes are relative weights, so they have to be re-expressed
 * against each grid rather than carried across unchanged.
 *
 * ROW spans are deliberately NOT scaled: a row is a fixed height in the
 * stylesheet, and doubling a `tall` cell's rows would make it taller on a
 * desktop rather than proportionally so. Only width is a fraction of the
 * grid; height is an absolute number of rows.
 */
const SHAPE_UNITS_BY_TIER: Record<HomeColumnTier, Record<HomeSectionShape, { cols: number; rows: number }>> = {
  2: SHAPE_UNITS,
  4: {
    micro: { cols: 1, rows: 1 },
    wide: { cols: 2, rows: 1 },
    tall: { cols: 1, rows: 2 },
    block: { cols: 2, rows: 2 },
    // The one shape that has to widen here: a hero at 2-of-4 is indistinguishable
    // from a block, which is the distinction the shape exists to draw.
    hero: { cols: 4, rows: 3 },
  },
  6: {
    micro: { cols: 2, rows: 1 },
    wide: { cols: 3, rows: 1 },
    tall: { cols: 2, rows: 2 },
    block: { cols: 3, rows: 2 },
    hero: { cols: 6, rows: 3 },
  },
}

function isTier(columns: number): columns is HomeColumnTier {
  return (HOME_COLUMN_TIERS as readonly number[]).includes(columns)
}

/**
 * The span lookup for a grid of `columns` columns, in the shape `packSections`
 * takes. An unrecognised column count falls back to the phone table rather
 * than returning undefined spans — a new tier should render a bit off, not
 * crash, until it is given a row here.
 */
export function unitsForColumns(
  columns: number,
): (shape: HomeSectionShape) => { cols: number; rows: number } {
  const table = isTier(columns) ? SHAPE_UNITS_BY_TIER[columns] : SHAPE_UNITS
  return (shape) => table[shape]
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
  | 'title.strengthRetention'
  | 'title.planAdherence'
  | 'title.muscleBalance'
  | 'title.laggingGroup'
  | 'title.streak'
  | 'title.closestGoal'
  | 'title.trophyCase'
  | 'title.weightTrend'
  | 'title.liftTrend'

export type HomeSectionDescriptionKey =
  | 'description.momentum'
  | 'description.todayRecap'
  | 'description.unfinished'
  | 'description.cardioWeek'
  | 'description.bigThree'
  | 'description.paceRecord'
  | 'description.strengthRetention'
  | 'description.planAdherence'
  | 'description.muscleBalance'
  | 'description.laggingGroup'
  | 'description.streak'
  | 'description.closestGoal'
  | 'description.trophyCase'
  | 'description.weightTrend'
  | 'description.liftTrend'

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
  /** The SUBJECT this kind pins per instance, when it pins one. Declarative
   *  like everything else here, so a native client reads the same field and
   *  offers the same picker. Absent means the kind takes no config at all,
   *  and the write boundary rejects a document that gives it one. */
  configKind?: 'exercise'
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
    // Two rows is what the LIST body needs; `wide` stays the default because
    // defaultShape is what a stored document resolves to when it omits one,
    // and changing it would silently re-shape every saved layout.
    allowedShapes: ['wide', 'block'],
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
  {
    kind: 'strength-retention',
    titleKey: 'title.strengthRetention',
    descriptionKey: 'description.strengthRetention',
    allowedShapes: ['micro', 'tall'],
    defaultShape: 'tall',
  },
  {
    kind: 'plan-adherence',
    titleKey: 'title.planAdherence',
    descriptionKey: 'description.planAdherence',
    allowedShapes: ['micro', 'wide'],
    defaultShape: 'micro',
  },
  {
    kind: 'muscle-balance',
    titleKey: 'title.muscleBalance',
    descriptionKey: 'description.muscleBalance',
    allowedShapes: ['wide', 'block', 'hero'],
    defaultShape: 'block',
  },
  {
    kind: 'lagging-group',
    titleKey: 'title.laggingGroup',
    descriptionKey: 'description.laggingGroup',
    allowedShapes: ['micro'],
    defaultShape: 'micro',
  },
  {
    kind: 'weight-trend',
    titleKey: 'title.weightTrend',
    descriptionKey: 'description.weightTrend',
    allowedShapes: ['micro', 'wide'],
    defaultShape: 'micro',
  },
  {
    kind: 'streak',
    titleKey: 'title.streak',
    descriptionKey: 'description.streak',
    allowedShapes: ['micro'],
    defaultShape: 'micro',
  },
  {
    kind: 'closest-goal',
    titleKey: 'title.closestGoal',
    descriptionKey: 'description.closestGoal',
    allowedShapes: ['micro', 'wide'],
    defaultShape: 'wide',
  },
  {
    kind: 'trophy-case',
    titleKey: 'title.trophyCase',
    descriptionKey: 'description.trophyCase',
    allowedShapes: ['micro', 'tall'],
    defaultShape: 'micro',
  },
  {
    // The one repeatable kind: two instances pinned to two lifts is the whole
    // reason sections carry ids. `configKind` is what the picker reads to know
    // it has an exercise to offer.
    kind: 'lift-trend',
    titleKey: 'title.liftTrend',
    descriptionKey: 'description.liftTrend',
    allowedShapes: ['tall', 'wide', 'block'],
    defaultShape: 'tall',
    repeatable: true,
    configKind: 'exercise',
  },
] as const satisfies readonly HomeSectionMeta[]

export type HomeSectionKind = (typeof HOME_SECTION_REGISTRY)[number]['kind']
