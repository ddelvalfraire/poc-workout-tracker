import { describe, it, expect } from 'vitest'
import { packSections, type PackedSection } from './pack'
import type { ResolvedHomeSection } from './layout'
import type { HomeSectionShape } from './registry'

/**
 * The packer is the layout's cross-platform contract: web, SwiftUI and
 * Compose all have to place a 1x2 tall cell the same way. These assert the
 * ALGORITHM, so they use bare shapes rather than the registry's kinds —
 * nothing shipped today is `tall` or `hero`, and the packer must still be
 * right about them before a widget arrives that is.
 */
function s(id: string, shape: HomeSectionShape): ResolvedHomeSection {
  return { id, kind: id, shape, hidden: false }
}

/** Compact placement view: [id, row, col, rowSpan, colSpan]. `packSections`
 *  is generic over what it packs, so this names the section type it is given
 *  rather than reaching for the return type's unresolved constraint. */
function placement(cells: readonly PackedSection<ResolvedHomeSection>[]) {
  return cells.map((c) => [c.section.id, c.row, c.col, c.rowSpan, c.colSpan])
}

describe('packSections', () => {
  it('lays full-width cells out as a simple stack', () => {
    const { cells, rows } = packSections([s('a', 'wide'), s('b', 'wide')], 2)
    expect(placement(cells)).toEqual([
      ['a', 0, 0, 1, 2],
      ['b', 1, 0, 1, 2],
    ])
    expect(rows).toBe(2)
  })

  it('pairs two micros on one row', () => {
    const { cells, rows } = packSections([s('a', 'micro'), s('b', 'micro')], 2)
    expect(placement(cells)).toEqual([
      ['a', 0, 0, 1, 1],
      ['b', 0, 1, 1, 1],
    ])
    expect(rows).toBe(1)
  })

  it('fills the column beside a tall cell rather than below it', () => {
    // The vertical break: `a` occupies column 0 across two rows, so the two
    // micros stack beside it instead of waiting for it to finish.
    const { cells, rows } = packSections([s('a', 'tall'), s('b', 'micro'), s('c', 'micro')], 2)
    expect(placement(cells)).toEqual([
      ['a', 0, 0, 2, 1],
      ['b', 0, 1, 1, 1],
      ['c', 1, 1, 1, 1],
    ])
    expect(rows).toBe(2)
  })

  it('starts a new row when the next shape cannot fit the remaining columns', () => {
    const { cells } = packSections([s('a', 'micro'), s('b', 'wide')], 2)
    expect(placement(cells)).toEqual([
      ['a', 0, 0, 1, 1],
      // `b` needs both columns, so it drops rather than squeezing beside `a`
      ['b', 1, 0, 1, 2],
    ])
  })

  it('never lets a later cell jump ahead of an earlier one', () => {
    // `b` leaves a hole at (0,1) that `c` could fill — the sparse rule
    // forbids it, because the order you set must be the order you see.
    const { cells } = packSections([s('a', 'wide'), s('b', 'micro'), s('c', 'wide')], 2)
    expect(placement(cells)).toEqual([
      ['a', 0, 0, 1, 2],
      ['b', 1, 0, 1, 1],
      ['c', 2, 0, 1, 2],
    ])
  })

  it('does not backfill a hole that sits before the cursor', () => {
    const { cells } = packSections([s('a', 'tall'), s('b', 'wide'), s('c', 'micro')], 2)
    expect(placement(cells)).toEqual([
      ['a', 0, 0, 2, 1],
      // `b` needs two columns; (0,1) is free but too narrow, so it lands below
      ['b', 2, 0, 1, 2],
      // `c` WOULD fit the hole at (0,1) — dense placement would put it there.
      // It goes after `b` instead.
      ['c', 3, 0, 1, 1],
    ])
  })

  it('widens with the column count: the same list packs differently at 4 and 6', () => {
    const list = [s('a', 'block'), s('b', 'micro'), s('c', 'micro'), s('d', 'wide')]
    expect(placement(packSections(list, 4).cells)).toEqual([
      ['a', 0, 0, 2, 2],
      ['b', 0, 2, 1, 1],
      ['c', 0, 3, 1, 1],
      ['d', 1, 2, 1, 2],
    ])
    expect(packSections(list, 4).rows).toBe(2)
    expect(packSections(list, 6).rows).toBe(2)
  })

  it('narrows a shape too wide for the grid instead of dropping it', () => {
    const { cells } = packSections([s('a', 'block')], 1)
    expect(placement(cells)).toEqual([['a', 0, 0, 2, 1]])
    expect(cells[0].clamped).toBe(true)
  })

  it('reports clamped: false when every shape fits', () => {
    const { cells } = packSections([s('a', 'block')], 2)
    expect(cells[0].clamped).toBe(false)
  })

  it('is pure: the input array and its sections are untouched', () => {
    const input = [s('a', 'tall'), s('b', 'micro')]
    const snapshot = JSON.parse(JSON.stringify(input))
    packSections(input, 2)
    expect(input).toEqual(snapshot)
  })

  it('handles an empty list and a degenerate column count', () => {
    expect(packSections([], 2)).toEqual({ cells: [], rows: 0 })
    expect(packSections([s('a', 'wide')], 0)).toEqual({ cells: [], rows: 0 })
  })

  it('never overlaps two cells, for any mix of shapes', () => {
    const shapes: HomeSectionShape[] = ['micro', 'wide', 'tall', 'block', 'hero']
    const list = shapes.flatMap((shape, i) => [s(`${shape}-${i}`, shape), s(`m-${i}`, 'micro')])
    for (const columns of [2, 4, 6]) {
      const occupied = new Set<string>()
      for (const c of packSections(list, columns).cells) {
        for (let r = c.row; r < c.row + c.rowSpan; r++) {
          for (let col = c.col; col < c.col + c.colSpan; col++) {
            const key = `${r}:${col}`
            expect(occupied.has(key)).toBe(false)
            occupied.add(key)
          }
        }
      }
    }
  })
})
