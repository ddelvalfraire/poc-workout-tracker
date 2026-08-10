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

export interface HomeSectionMeta {
  /** Stable semantic id — what the layout document stores. Never rename. */
  kind: string
  /** Short label for the editor row. */
  title: string
  /** One benefit-first clause for the editor row's hint. */
  description: string
  /** Sizes this section knows how to render — the write boundary rejects
   *  anything else; reads normalize to `defaultSize`. */
  allowedSizes: readonly HomeSectionSize[]
  /** The size a section gets when the document doesn't say (and what
   *  serialization omits) — md everywhere, the pre-bento home. */
  defaultSize: HomeSectionSize
}

export const HOME_SECTION_REGISTRY = [
  {
    kind: 'momentum',
    title: 'Momentum',
    description: 'This week’s sets, activity, and goal progress.',
    allowedSizes: ['sm', 'md', 'lg'],
    defaultSize: 'md',
  },
  {
    kind: 'today-recap',
    title: 'Today',
    description: 'Celebration cards for sessions you finished today.',
    allowedSizes: ['sm', 'md'],
    defaultSize: 'md',
  },
  {
    kind: 'unfinished',
    title: 'Unfinished',
    description: 'Stalled sessions waiting to be resumed or finished.',
    allowedSizes: ['md'],
    defaultSize: 'md',
  },
  {
    kind: 'history',
    title: 'History',
    description: 'Your latest completed workouts.',
    allowedSizes: ['sm', 'md', 'lg'],
    defaultSize: 'md',
  },
] as const satisfies readonly HomeSectionMeta[]

export type HomeSectionKind = (typeof HOME_SECTION_REGISTRY)[number]['kind']
