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
}

function render(overrides: {
  kind: string
  shape?: ResolvedHomeSection['shape']
  hidden?: boolean
  index: number
  count: number
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

  test('shape control gating: only allowedShapes are enabled (unfinished is wide-only)', () => {
    const html = render({ kind: 'unfinished', index: 1, count: 4 })
    expect(html).toContain('role="radiogroup"')
    // S and L exist but are disabled; M is enabled and checked.
    expect(html).toContain('aria-checked="false" aria-label="Small Unfinished" disabled=""')
    expect(html).toContain('aria-checked="false" aria-label="Block Unfinished" disabled=""')
    expect(html).toContain('aria-checked="true" aria-label="Wide Unfinished"')
    expect(html).not.toContain('aria-label="Wide Unfinished" disabled=""')
  })

  test('shape control reflects the current shape for a full-range kind', () => {
    const html = render({ kind: 'momentum', shape: 'micro', index: 0, count: 4 })
    expect(html).toContain('aria-checked="true" aria-label="Small Momentum"')
    expect(html).not.toContain('aria-label="Small Momentum" disabled=""')
    expect(html).not.toContain('aria-label="Block Momentum" disabled=""')
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
