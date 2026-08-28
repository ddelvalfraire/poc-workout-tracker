import { describe, it, expect } from 'vitest'
import {
  HOME_COLUMN_TIERS,
  HOME_SECTION_REGISTRY,
  HOME_SECTION_SHAPES,
  SHAPE_UNITS,
  unitsForColumns,
} from './registry'

/**
 * The shape → span mapping is the one piece of geometry every client shares:
 * web reads it from here, and a SwiftUI/Compose home has to place a `block`
 * at the same width or the three renderings drift. It used to be a single
 * table sized for the 2-column phone and reused verbatim at 4 and 6 columns,
 * which made the anchor shape a 2-of-6 stamp on a desktop grid — the widest
 * viewport got the smallest-looking anchor.
 */
describe('unitsForColumns', () => {
  it('is defined for every tier the stylesheet renders', () => {
    expect([...HOME_COLUMN_TIERS]).toEqual([2, 4, 6])
  })

  it('maps the phone tier to the base table', () => {
    for (const shape of HOME_SECTION_SHAPES) {
      expect(unitsForColumns(2)(shape)).toEqual(SHAPE_UNITS[shape])
    }
  })

  it('widens the spans proportionally at the 6-column tier', () => {
    const at6 = unitsForColumns(6)
    expect(at6('micro')).toEqual({ cols: 2, rows: 1 })
    expect(at6('tall')).toEqual({ cols: 2, rows: 2 })
    expect(at6('wide')).toEqual({ cols: 3, rows: 1 })
    expect(at6('block')).toEqual({ cols: 3, rows: 2 })
    expect(at6('hero')).toEqual({ cols: 6, rows: 3 })
  })

  it('widens only the hero at the 4-column tier', () => {
    const at4 = unitsForColumns(4)
    expect(at4('micro')).toEqual({ cols: 1, rows: 1 })
    expect(at4('tall')).toEqual({ cols: 1, rows: 2 })
    expect(at4('wide')).toEqual({ cols: 2, rows: 1 })
    expect(at4('block')).toEqual({ cols: 2, rows: 2 })
    expect(at4('hero')).toEqual({ cols: 4, rows: 3 })
  })

  /** An anchor has to READ as the anchor at every width. Stated as a ratio so
   *  it keeps holding if a tier's column count is ever retuned. */
  it('keeps an anchor at least half the grid, and a micro well under it', () => {
    for (const columns of HOME_COLUMN_TIERS) {
      const units = unitsForColumns(columns)
      expect(units('block').cols / columns).toBeGreaterThanOrEqual(0.5)
      expect(units('micro').cols / columns).toBeLessThanOrEqual(0.5)
      expect(units('micro').cols).toBeLessThan(units('wide').cols)
    }
  })

  /** Unknown column counts are not a crash: a future tier falls back to the
   *  base table rather than returning undefined spans. */
  it('falls back to the base table for a tier it does not know', () => {
    for (const shape of HOME_SECTION_SHAPES) {
      expect(unitsForColumns(3)(shape)).toEqual(SHAPE_UNITS[shape])
    }
  })
})

/**
 * A section whose body is a LIST needs a tile it can be a list in. `unfinished`
 * shipped as `wide`-only — one row — so its rows had nowhere to go. The
 * two-row shape is offered ALONGSIDE `wide`, not instead of it: `defaultShape`
 * is what a stored document resolves to when it omits one, so changing that
 * would silently re-shape every saved layout.
 */
describe('the unfinished entry', () => {
  const meta = HOME_SECTION_REGISTRY.find((m) => m.kind === 'unfinished')!

  it('offers a two-row shape for its list body', () => {
    expect(meta.allowedShapes).toContain('block')
  })

  it('still defaults to the one-row shape saved layouts already resolve to', () => {
    expect(meta.defaultShape).toBe('wide')
  })
})
