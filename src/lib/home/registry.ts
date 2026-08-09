/**
 * The registry of home's OPTIONAL sections — the customization contract.
 *
 * PLATFORM-AGNOSTIC BY LAW: entries are data only (semantic kind + copy),
 * never React components. The web render mapping lives in
 * `src/app/home-sections.tsx`; future native clients (SwiftUI/Compose) will
 * consume this same contract and the same stored layout document.
 *
 * StatusHero and CheckInCard are deliberately NOT here: they always render,
 * always first, and are never customizable.
 *
 * Array order IS the default home order.
 */

export interface HomeSectionMeta {
  /** Stable semantic id — what the layout document stores. Never rename. */
  kind: string
  /** Short label for the editor row. */
  title: string
  /** One benefit-first clause for the editor row's hint. */
  description: string
}

export const HOME_SECTION_REGISTRY = [
  {
    kind: 'momentum',
    title: 'Momentum',
    description: 'This week’s sets, activity, and goal progress.',
  },
  {
    kind: 'today-recap',
    title: 'Today',
    description: 'Celebration cards for sessions you finished today.',
  },
  {
    kind: 'unfinished',
    title: 'Unfinished',
    description: 'Stalled sessions waiting to be resumed or finished.',
  },
  {
    kind: 'history',
    title: 'History',
    description: 'Your latest completed workouts.',
  },
] as const satisfies readonly HomeSectionMeta[]

export type HomeSectionKind = (typeof HOME_SECTION_REGISTRY)[number]['kind']
