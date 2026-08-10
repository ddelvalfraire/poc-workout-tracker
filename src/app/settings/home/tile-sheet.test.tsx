import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HOME_SECTION_REGISTRY } from '@/lib/home/registry'
import type { ResolvedHomeSection } from '@/lib/home/layout'
import { TileSheet } from './tile-sheet'

/**
 * Static-render tests for the tile sheet's GATING: which size radios are
 * enabled (allowedSizes only), which move buttons disable at the edges, and
 * the switch's checked state. Dialog behavior (showModal, backdrop dismiss)
 * lives in effects a static render never runs — that recipe is shared with
 * rest-sheet and exercised there/in e2e.
 */

const metaOf = (kind: string) => HOME_SECTION_REGISTRY.find((s) => s.kind === kind)!

const noop = () => {}
const handlers = {
  onClose: noop,
  onSize: noop as (size: ResolvedHomeSection['size']) => void,
  onToggle: noop,
  onMove: noop as (direction: 'up' | 'down') => void,
  onMoveToTop: noop,
}

function render(overrides: {
  kind: string
  size?: ResolvedHomeSection['size']
  hidden?: boolean
  index: number
  count: number
}) {
  const meta = metaOf(overrides.kind)
  const section: ResolvedHomeSection = {
    kind: overrides.kind,
    size: overrides.size ?? meta.defaultSize,
    hidden: overrides.hidden ?? false,
  }
  return renderToStaticMarkup(
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
    const html = render({ kind: 'momentum', index: 0, count: 4 })
    expect(html).toContain('<dialog')
    expect(html).toContain('aria-label="Momentum section"')
    expect(html).toContain(metaOf('momentum').description)
  })

  test('size control gating: only allowedSizes are enabled (unfinished is md-only)', () => {
    const html = render({ kind: 'unfinished', index: 1, count: 4 })
    expect(html).toContain('role="radiogroup"')
    // S and L exist but are disabled; M is enabled and checked.
    expect(html).toContain('aria-checked="false" aria-label="Small Unfinished" disabled=""')
    expect(html).toContain('aria-checked="false" aria-label="Large Unfinished" disabled=""')
    expect(html).toContain('aria-checked="true" aria-label="Medium Unfinished"')
    expect(html).not.toContain('aria-label="Medium Unfinished" disabled=""')
  })

  test('size control reflects the current size for a full-range kind', () => {
    const html = render({ kind: 'momentum', size: 'sm', index: 0, count: 4 })
    expect(html).toContain('aria-checked="true" aria-label="Small Momentum"')
    expect(html).not.toContain('aria-label="Small Momentum" disabled=""')
    expect(html).not.toContain('aria-label="Large Momentum" disabled=""')
  })

  test('move gating at the top edge: Up and To top disable, Down stays live', () => {
    const html = render({ kind: 'momentum', index: 0, count: 4 })
    expect(html).toContain('aria-label="Move Momentum up" disabled=""')
    expect(html).toContain('aria-label="Move Momentum to top" disabled=""')
    expect(html).not.toContain('aria-label="Move Momentum down" disabled=""')
  })

  test('move gating at the bottom edge: Down disables, Up and To top stay live', () => {
    const html = render({ kind: 'history', index: 3, count: 4 })
    expect(html).toContain('aria-label="Move History down" disabled=""')
    expect(html).not.toContain('aria-label="Move History up" disabled=""')
    expect(html).not.toContain('aria-label="Move History to top" disabled=""')
  })

  test('visibility switch mirrors hidden state (switch role, settings vocabulary)', () => {
    const shown = render({ kind: 'history', index: 3, count: 4 })
    expect(shown).toContain('role="switch" aria-checked="true" aria-label="Show History on Home"')
    const hidden = render({ kind: 'history', hidden: true, index: 3, count: 4 })
    expect(hidden).toContain('role="switch" aria-checked="false" aria-label="Show History on Home"')
  })
})
