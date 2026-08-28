import { SHAPE_UNITS, type HomeSectionShape } from './registry'

/**
 * The bento packer — turns the one-dimensional layout document into explicit
 * two-dimensional placement.
 *
 * WHY THIS EXISTS AT ALL. Storage stays a flat ordered list with no x/y
 * coordinates (the SwiftUI/Compose-renderable contract): a section says what
 * SHAPE it is, never where it sits. Something still has to decide where a
 * 1x2 tall cell lands relative to the 1x1 that follows it, and that decision
 * has to be identical on web, iOS and Android. Doing it here — as arithmetic
 * over the ordered list — is the only version that ports. CSS grid's own
 * auto-placement would give the same answer on web today, but nothing on a
 * native client implements it, and relying on a subtle browser behaviour to
 * define a cross-platform layout is how three renderings drift apart.
 *
 * THE RULE. Walk the sections in order. Place each one at the first free
 * position at or after the previous section's own start, scanning row-major.
 * "At or after" is what keeps the result predictable: a later small cell may
 * fill the gap beside the tall cell above it, but it can never jump the queue
 * and land before a section that precedes it. That is the sparse behaviour,
 * deliberately — `grid-auto-flow: dense` fills every hole at the cost of
 * reordering, and the order you set must be the order you see.
 *
 * A shape wider than the grid is narrowed to fit rather than dropped: a
 * `block` on a one-column viewport becomes one column wide. Callers that
 * care can see it in `clamped`.
 */

/** All the packer needs of a section. Stated structurally rather than as
 *  `ResolvedHomeSection` so the bento shell can pack ALREADY-RENDERED items
 *  without inventing the layout-document fields it has no use for. */
export interface Packable {
  shape: HomeSectionShape
}

export interface PackedSection<T extends Packable = Packable> {
  section: T
  /** Zero-based. Add 1 for CSS `grid-row` / `grid-column`, which are 1-based. */
  row: number
  col: number
  rowSpan: number
  colSpan: number
  /** True when the shape was too wide for the grid and had to be narrowed. */
  clamped: boolean
}

export interface PackedGrid<T extends Packable = Packable> {
  cells: PackedSection<T>[]
  /** Total rows occupied — what a fixed-height container needs to size itself. */
  rows: number
}

/** Column occupancy, one row of booleans per grid row. Grown on demand so the
 *  packer never needs to know the height up front. */
function rowAt(grid: boolean[][], row: number, columns: number): boolean[] {
  while (grid.length <= row) grid.push(new Array<boolean>(columns).fill(false))
  return grid[row]
}

function fits(
  grid: boolean[][],
  row: number,
  col: number,
  rowSpan: number,
  colSpan: number,
  columns: number,
): boolean {
  if (col + colSpan > columns) return false
  for (let r = row; r < row + rowSpan; r++) {
    const cells = rowAt(grid, r, columns)
    for (let c = col; c < col + colSpan; c++) {
      if (cells[c]) return false
    }
  }
  return true
}

function occupy(
  grid: boolean[][],
  row: number,
  col: number,
  rowSpan: number,
  colSpan: number,
  columns: number,
): void {
  for (let r = row; r < row + rowSpan; r++) {
    const cells = rowAt(grid, r, columns)
    for (let c = col; c < col + colSpan; c++) cells[c] = true
  }
}

/**
 * Packs sections into `columns`, preserving order. Pure: builds fresh
 * structures and never mutates its input. Hidden sections are the caller's
 * problem — filter before packing, or they take up space.
 */
export function packSections<T extends Packable>(
  sections: readonly T[],
  columns: number,
  unitsFor: (shape: HomeSectionShape) => { cols: number; rows: number } = (shape) =>
    SHAPE_UNITS[shape],
): PackedGrid<T> {
  if (columns < 1) return { cells: [], rows: 0 }
  const grid: boolean[][] = []
  const cells: PackedSection<T>[] = []
  // The scan floor: never look at a position earlier than the previous
  // section's own start, which is what stops a later cell jumping the queue.
  let cursorRow = 0
  let cursorCol = 0

  for (const section of sections) {
    const units = unitsFor(section.shape)
    const colSpan = Math.min(units.cols, columns)
    const rowSpan = units.rows
    const clamped = colSpan < units.cols

    let row = cursorRow
    let col = cursorCol
    while (!fits(grid, row, col, rowSpan, colSpan, columns)) {
      col++
      if (col >= columns) {
        col = 0
        row++
      }
    }
    occupy(grid, row, col, rowSpan, colSpan, columns)
    cells.push({ section, row, col, rowSpan, colSpan, clamped })
    cursorRow = row
    cursorCol = col
  }

  return { cells, rows: grid.length }
}
