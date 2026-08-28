import { describe, expect, test } from 'vitest'
import { renderStaticIntl } from '../../../../vitest.intl'
import { HOME_SECTION_REGISTRY } from '@/lib/home/registry'
import type { ResolvedHomeSection } from '@/lib/home/layout'
import { TileSheet } from './tile-sheet'

/**
 * Static-render tests for the tile sheet's GATING: which size radios are
 * enabled (allowedShapes only), which move buttons disable at the edges, and
 * the switch's checked state. Dialog behavior (showModal, backdrop dismiss)
 * lives in effects a static render never runs — that recipe is shared with
 * rest-sheet and exercised there/in e2e.
 */

const metaOf = (kind: string) => HOME_SECTION_REGISTRY.find((s) => s.kind === kind)!

const noop = () => {}
const handlers = {
  onClose: noop,
  onShape: noop as (shape: ResolvedHomeSection['shape']) => void,
  onToggle: noop,
  onMove: noop as (direction: 'up' | 'down') => void,
  onMoveToTop: noop,
  onRemove: noop,
}

function render(overrides: {
  kind: string
  shape?: ResolvedHomeSection['shape']
  hidden?: boolean
  index: number
  count: number
  /** Extra instances of a repeatable kind are the only ones Remove deletes. */
  removesPermanently?: boolean
}) {
  const meta = metaOf(overrides.kind)
  const section: ResolvedHomeSection = {
    id: overrides.kind,
    kind: overrides.kind,
    shape: overrides.shape ?? meta.defaultShape,
    hidden: overrides.hidden ?? false,
  }
  return renderStaticIntl(
    <TileSheet
      meta={meta}
      section={section}
      index={overrides.index}
      count={overrides.count}
      removesPermanently={overrides.removesPermanently ?? false}
      {...handlers}
    />,
  )
}

describe('TileSheet', () => {
  test('renders a bottom-sheet dialog with the section title and description', () => {
    const html = render({ kind: 'momentum', index: 0, count: 3 })
    expect(html).toContain('<dialog')
    expect(html).toContain('aria-label="Momentum section"')
    // The registry carries KEYS now, so this asserts the resolved copy — and
    // that no key path leaked through unresolved.
    expect(html).toContain('This week’s sets, activity, and goal progress.')
    expect(html).not.toMatch(/HomeSection\.[a-zA-Z.]+/)
    expect(html).not.toMatch(/TileSheet\.[a-zA-Z.]+/)
  })

  test('every registered section resolves both of its catalog keys', () => {
    // The registry is data, so nothing renders these two keys except a
    // section the editor happens to show — this walks all of them, which is
    // what catches a new section added without its title or description.
    for (const meta of HOME_SECTION_REGISTRY) {
      const html = render({ kind: meta.kind, index: 0, count: HOME_SECTION_REGISTRY.length })
      expect(html, meta.kind).not.toMatch(/HomeSection\.[a-zA-Z.]+/)
    }
  })

  test('shape control OMITS shapes the kind disallows (streak is micro-only)', () => {
    const html = render({ kind: 'streak', index: 1, count: 4 })
    expect(html).toContain('role="radiogroup"')
    // A one-shape widget offers one chip. The rest never appear, rather than
    // appearing as controls that do nothing when pressed.
    expect(html).toContain('aria-checked="true" aria-label="Small Streak"')
    expect(html).not.toContain('aria-label="Wide Streak"')
    expect(html).not.toContain('aria-label="Block Streak"')
    expect(html).not.toContain('disabled=""')
  })

  /** Unfinished carries a LIST, and a list needs the two-row shape as well as
   *  the one-row default — so the sheet has to offer both, and stop there. */
  test('offers Unfinished both of its shapes, and no others', () => {
    const html = render({ kind: 'unfinished', index: 1, count: 4 })
    expect(html).toContain('aria-checked="true" aria-label="Wide Unfinished"')
    expect(html).toContain('aria-label="Block Unfinished"')
    expect(html).not.toContain('aria-label="Small Unfinished"')
    expect(html).not.toContain('aria-label="Tall Unfinished"')
  })

  test('offers every shape a full-range kind allows, and only those', () => {
    const html = render({ kind: 'momentum', shape: 'micro', index: 0, count: 4 })
    expect(html).toContain('aria-checked="true" aria-label="Small Momentum"')
    for (const label of ['Small Momentum', 'Wide Momentum', 'Block Momentum']) {
      expect(html).toContain(`aria-label="${label}"`)
    }
    // Momentum allows micro/wide/block — never tall or hero.
    expect(html).not.toContain('aria-label="Tall Momentum"')
    expect(html).not.toContain('aria-label="Hero Momentum"')
  })

  test('offers Remove only for a section that removing would DELETE', () => {
    const hideable = render({ kind: 'momentum', index: 0, count: 4 })
    expect(hideable).not.toContain('aria-label="Remove Momentum from your home"')
    // An extra instance of a repeatable kind is the one case where removing
    // is not the same as hiding, so it is the one case that says "Remove".
    const deletable = render({
      kind: 'lift-trend',
      index: 0,
      count: 4,
      removesPermanently: true,
    })
    expect(deletable).toContain('aria-label="Remove Lift trend from your home"')
  })

  test('move gating at the top edge: Up and To top disable, Down stays live', () => {
    const html = render({ kind: 'momentum', index: 0, count: 3 })
    expect(html).toContain('aria-label="Move Momentum up" disabled=""')
    expect(html).toContain('aria-label="Move Momentum to top" disabled=""')
    expect(html).not.toContain('aria-label="Move Momentum down" disabled=""')
  })

  test('move gating at the bottom edge: Down disables, Up and To top stay live', () => {
    const html = render({ kind: 'unfinished', index: 2, count: 3 })
    expect(html).toContain('aria-label="Move Unfinished down" disabled=""')
    expect(html).not.toContain('aria-label="Move Unfinished up" disabled=""')
    expect(html).not.toContain('aria-label="Move Unfinished to top" disabled=""')
  })

  test('visibility switch mirrors hidden state (switch role, settings vocabulary)', () => {
    const shown = render({ kind: 'unfinished', index: 2, count: 3 })
    expect(shown).toContain(
      'role="switch" aria-checked="true" aria-label="Show Unfinished on Home"',
    )
    const hidden = render({ kind: 'unfinished', hidden: true, index: 2, count: 3 })
    expect(hidden).toContain(
      'role="switch" aria-checked="false" aria-label="Show Unfinished on Home"',
    )
  })
})
