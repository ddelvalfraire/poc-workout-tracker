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
 * Array order IS the default home order.
 */

/** Abstract size classes over a 4-unit row: sm=1, md=2, lg=4. Each platform
 *  maps them to its own grid (web: home-sections.tsx). */
export type HomeSectionSize = 'sm' | 'md' | 'lg'

export const HOME_SECTION_SIZES = ['sm', 'md', 'lg'] as const satisfies readonly HomeSectionSize[]

/** The `HomeSection` catalog keys, written out rather than derived from
 *  `kind` — a template-literal type would type-check against nothing, and the
 *  point of the generated key types is that a missing message is a compile
 *  error. */
export type HomeSectionTitleKey =
  | 'title.momentum'
  | 'title.todayRecap'
  | 'title.unfinished'
  | 'title.history'

export type HomeSectionDescriptionKey =
  | 'description.momentum'
  | 'description.todayRecap'
  | 'description.unfinished'
  | 'description.history'

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
  /** Sizes this section knows how to render — the write boundary rejects
   *  anything else; reads normalize to `defaultSize`. */
  allowedSizes: readonly HomeSectionSize[]
  /** The size a section gets when the document doesn't say (and what
   *  serialization omits) — each kind's pre-bento rendering. */
  defaultSize: HomeSectionSize
}

export const HOME_SECTION_REGISTRY = [
  {
    kind: 'momentum',
    titleKey: 'title.momentum',
    descriptionKey: 'description.momentum',
    allowedSizes: ['sm', 'md', 'lg'],
    defaultSize: 'md',
  },
  {
    kind: 'today-recap',
    titleKey: 'title.todayRecap',
    descriptionKey: 'description.todayRecap',
    allowedSizes: ['sm', 'md'],
    defaultSize: 'md',
  },
  {
    kind: 'unfinished',
    titleKey: 'title.unfinished',
    descriptionKey: 'description.unfinished',
    allowedSizes: ['md'],
    defaultSize: 'md',
  },
  {
    kind: 'history',
    titleKey: 'title.history',
    descriptionKey: 'description.history',
    allowedSizes: ['sm', 'md', 'lg'],
    // lg, not md: today's home shows HOME_HISTORY_LIMIT (5) rows, which is
    // the lg rendering — the default-parity contract pins the default to it.
    defaultSize: 'lg',
  },
] as const satisfies readonly HomeSectionMeta[]

export type HomeSectionKind = (typeof HOME_SECTION_REGISTRY)[number]['kind']
