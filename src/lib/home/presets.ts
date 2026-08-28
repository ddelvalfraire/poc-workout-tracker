import { HOME_SECTION_REGISTRY, type HomeSectionKind, type HomeSectionShape } from './registry'
import type { ResolvedHomeSection } from './layout'

/**
 * The named layouts — a good home for a stated goal, without opening the
 * editor.
 *
 * A PRESET IS NOT A MODE. Applying one writes an ordinary layout document and
 * then gets out of the way: nothing behaves differently afterwards, and there
 * is no state to reconcile when a preset's definition changes in a later
 * release. The id is stored as a LABEL so the editor can say "Custom, from
 * Cut"; it is never read back as behaviour.
 *
 * This module is the seam a future onboarding step calls. "What are you
 * training for?" has exactly these answers, and each maps to one function
 * call — which is why onboarding needs nothing else from this project, and
 * why nothing here knows onboarding exists.
 *
 * Platform-agnostic like the registry: data only, no React, no copy. A native
 * client applies the same presets from the same table.
 */

export type HomePresetId =
  | 'cut'
  | 'bulk'
  | 'powerlifting'
  | 'hypertrophy'
  | 'conditioning'
  | 'consistency'
  | 'volume'

/** Catalog keys, not sentences — the same rule the registry's copy follows,
 *  because the chips render on clients that cannot be handed English. */
export type HomePresetLabelKey = `label.${HomePresetId}`

export interface HomePresetSection {
  kind: HomeSectionKind
  /** Omitted means the kind's registry default. */
  shape?: HomeSectionShape
}

export interface HomePreset {
  id: HomePresetId
  labelKey: HomePresetLabelKey
  /** The VISIBLE sections, in the order they appear. Every registry kind not
   *  named here is appended hidden, so the document stays complete and the
   *  gallery has somewhere to un-hide from. */
  sections: readonly HomePresetSection[]
}

/**
 * Two composition rules hold across every preset, both asserted in the tests
 * rather than left to good intentions:
 *
 * - AT MOST ONE anchor (a `block` or `hero` cell). Two focal points is the
 *   failure mode that turns a bento back into a wall of cards.
 * - AT LEAST ONE `tall` cell. The vertical break is what stops the grid
 *   reading as rows; without it the shapes may as well be one-dimensional.
 *
 * Some archetypes want an anchor the catalog cannot draw yet — a cut's real
 * anchor is a weight-trend BLOCK carrying its own chart, and weight-trend
 * ships micro and wide. Those presets take the widest shape that exists
 * today rather than naming one the registry would silently normalize away.
 */
export const HOME_PRESETS: readonly HomePreset[] = [
  {
    id: 'cut',
    labelKey: 'label.cut',
    sections: [
      { kind: 'weight-trend', shape: 'wide' },
      { kind: 'strength-retention', shape: 'tall' },
      { kind: 'momentum', shape: 'wide' },
      { kind: 'cardio-week', shape: 'micro' },
      { kind: 'streak', shape: 'micro' },
      { kind: 'closest-goal', shape: 'wide' },
    ],
  },
  {
    id: 'bulk',
    labelKey: 'label.bulk',
    sections: [
      { kind: 'weight-trend', shape: 'wide' },
      { kind: 'momentum', shape: 'block' },
      { kind: 'lift-trend', shape: 'tall' },
      { kind: 'muscle-balance', shape: 'wide' },
      { kind: 'streak', shape: 'micro' },
    ],
  },
  {
    id: 'powerlifting',
    labelKey: 'label.powerlifting',
    sections: [
      { kind: 'big-three', shape: 'block' },
      { kind: 'lift-trend', shape: 'tall' },
      { kind: 'plan-adherence', shape: 'micro' },
      { kind: 'closest-goal', shape: 'wide' },
      { kind: 'streak', shape: 'micro' },
      { kind: 'weight-trend', shape: 'micro' },
      { kind: 'trophy-case', shape: 'micro' },
    ],
  },
  {
    id: 'hypertrophy',
    labelKey: 'label.hypertrophy',
    sections: [
      { kind: 'muscle-balance', shape: 'block' },
      { kind: 'lagging-group', shape: 'micro' },
      { kind: 'lift-trend', shape: 'tall' },
      { kind: 'momentum', shape: 'wide' },
      { kind: 'streak', shape: 'micro' },
      { kind: 'today-recap', shape: 'wide' },
    ],
  },
  {
    id: 'conditioning',
    labelKey: 'label.conditioning',
    sections: [
      { kind: 'cardio-week', shape: 'wide' },
      { kind: 'pace-record', shape: 'tall' },
      { kind: 'momentum', shape: 'wide' },
      { kind: 'streak', shape: 'micro' },
      { kind: 'closest-goal', shape: 'wide' },
      { kind: 'today-recap', shape: 'wide' },
    ],
  },
  {
    id: 'consistency',
    labelKey: 'label.consistency',
    sections: [
      { kind: 'momentum', shape: 'block' },
      { kind: 'trophy-case', shape: 'tall' },
      { kind: 'streak', shape: 'micro' },
      { kind: 'today-recap', shape: 'wide' },
      { kind: 'closest-goal', shape: 'wide' },
      { kind: 'unfinished', shape: 'wide' },
    ],
  },
  {
    // The general-purpose answer, and what a brand-new account gets: sets
    // this week, a streak, a recap. Nothing here needs history to be useful,
    // which is what makes it a decent day-one home.
    id: 'volume',
    labelKey: 'label.volume',
    sections: [
      { kind: 'momentum', shape: 'block' },
      { kind: 'trophy-case', shape: 'tall' },
      { kind: 'muscle-balance', shape: 'wide' },
      { kind: 'today-recap', shape: 'wide' },
      { kind: 'streak', shape: 'micro' },
      { kind: 'closest-goal', shape: 'wide' },
    ],
  },
]

/** The preset a home falls back to when nothing else is known — a fresh
 *  account, or a signal that reads nothing. Named here so the derive step and
 *  the editor cannot disagree about what "general" means. */
export const GENERAL_PRESET_ID: HomePresetId = 'volume'

/**
 * The layout for a preset, or the general one when there is no preset.
 *
 * Takes the ID rather than a `TrainingSignal` on purpose. The editor is a
 * client component and needs exactly this answer for its Reset button, but
 * `lib/home/signal` reaches `canonicalLiftFor` → `lib/trophies` → the db
 * modules; importing it from the client drags the postgres driver into the
 * browser bundle and fails the build. A preset id carries everything this
 * decision needs, so the client never has to touch the classifier.
 */
export function layoutForPreset(id: HomePresetId | null): ResolvedHomeSection[] {
  return applyPreset(id ?? GENERAL_PRESET_ID)
}

const PRESETS_BY_ID: ReadonlyMap<string, HomePreset> = new Map(HOME_PRESETS.map((p) => [p.id, p]))

const DEFAULT_SHAPE_BY_KIND: ReadonlyMap<string, HomeSectionShape> = new Map(
  HOME_SECTION_REGISTRY.map((meta) => [meta.kind, meta.defaultShape]),
)

/** Looks a preset up by an untrusted id — a stored label, a URL fragment.
 *  Undefined for anything unknown; callers fall back rather than throw. */
export function findPreset(id: string): HomePreset | undefined {
  return PRESETS_BY_ID.get(id)
}

/**
 * The preset a layout currently IS, or null once it stops being one.
 *
 * Derived by comparison rather than stored, which is what keeps the "zero new
 * state" promise honest: there is no second record of your intent to drift
 * out of step with the document, and no migration for layouts saved before
 * presets existed. The cost is that provenance ends at the first edit — a
 * layout is "Cut" until you change something, and then it is simply yours.
 *
 * Compares what a preset actually determines: the visible sections, their
 * order, and their shapes. Hidden sections are the complement of that set by
 * construction, so comparing them too would only restate it.
 */
export function matchPreset(sections: readonly ResolvedHomeSection[]): HomePresetId | null {
  const visible = sections.filter((s) => !s.hidden)
  for (const preset of HOME_PRESETS) {
    if (visible.length !== preset.sections.length) continue
    const same = preset.sections.every((wanted, i) => {
      const actual = visible[i]
      return (
        actual.kind === wanted.kind &&
        actual.shape === (wanted.shape ?? DEFAULT_SHAPE_BY_KIND.get(wanted.kind))
      )
    })
    if (same) return preset.id
  }
  return null
}

/**
 * The preset, as a section list ready to persist.
 *
 * Named sections come first in the preset's own order; every other registry
 * kind is appended HIDDEN at its default shape. Appending rather than
 * omitting is what keeps the document complete — the write boundary requires
 * every kind, and a hidden section is how the gallery knows what it can add.
 *
 * A repeatable kind gets exactly one instance. Further instances are
 * something a person adds: a preset shipping two lift-trend charts would be
 * guessing at two lifts it has no way to know.
 *
 * `id` is typed, and that type IS the guard — an untrusted label (a stored
 * one, a form value) goes through `findPreset` first.
 */
export function applyPreset(id: HomePresetId): ResolvedHomeSection[] {
  const preset = PRESETS_BY_ID.get(id)!
  const named = new Set<string>(preset.sections.map((s) => s.kind))
  const visible: ResolvedHomeSection[] = preset.sections.map((s) => ({
    id: s.kind,
    kind: s.kind,
    shape: s.shape ?? DEFAULT_SHAPE_BY_KIND.get(s.kind)!,
    hidden: false,
  }))
  const rest: ResolvedHomeSection[] = HOME_SECTION_REGISTRY.filter(
    (meta) => !named.has(meta.kind),
  ).map((meta) => ({
    id: meta.kind,
    kind: meta.kind,
    shape: meta.defaultShape,
    hidden: true,
  }))
  return [...visible, ...rest]
}
