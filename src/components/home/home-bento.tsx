import type { CSSProperties, ReactNode } from 'react'
import { packSections } from '@/lib/home/pack'
import { HOME_COLUMN_TIERS, unitsForColumns, type HomeSectionShape } from '@/lib/home/registry'

/**
 * The bento SHELL: shapes in, placed cells out.
 *
 * Deliberately knows nothing about home's sections. It takes bodies already
 * rendered by whoever owns the kind → renderer map (src/app/home-sections.tsx)
 * and is responsible only for geometry. That split is not tidiness: the widget
 * map reaches the database through a dozen async RSCs, so a shell that imported
 * it could never be rendered in a browser test — which is where the only bugs
 * this shell can have are visible. See home-bento.stories.tsx.
 *
 * Columns widen with the viewport — 2 on the phone, 4 from `md`, 6 from `xl` —
 * and the packer runs once per tier. Rows are a fixed unit (`--home-cell-row`)
 * because a bento needs real row spans: a tall cell that runs past its
 * neighbour is the whole reason the grid stops reading as a list.
 *
 * Placement is emitted as inline `grid-row` / `grid-column` rather than
 * Tailwind classes for two reasons: the values are computed per layout, so
 * they cannot be enumerated for the JIT compiler; and pinning them explicitly
 * means the browser never re-derives a placement of its own that could drift
 * from what a native client will compute from the same packer.
 */

export interface HomeBentoItem {
  /** Stable key — the section's layout-document id. */
  id: string
  shape: HomeSectionShape
  /** The rendered widget. Callers should drop bodies they KNOW are empty
   *  before handing them over — an empty cell is not invisible, it is a
   *  reserved hole with a hairline. A caller cannot always know: a body that
   *  is an async component decides its own emptiness after this point, and
   *  such a cell is still reserved. See renderHomeSections. */
  body: ReactNode
}

export function HomeBento({ items }: { items: readonly HomeBentoItem[] }) {
  // One pass per breakpoint, keyed by id so the three placements can be
  // attached to the same cell. Each tier packs with its OWN span table: the
  // shapes are relative weights, not absolute column counts.
  const placements = new Map<string, Record<string, string>>()
  for (const columns of HOME_COLUMN_TIERS) {
    const { cells } = packSections(items, columns, unitsForColumns(columns))
    for (const cell of cells) {
      const vars = placements.get(cell.section.id) ?? {}
      vars[`--r${columns}`] = `${cell.row + 1} / span ${cell.rowSpan}`
      vars[`--c${columns}`] = `${cell.col + 1} / span ${cell.colSpan}`
      placements.set(cell.section.id, vars)
    }
  }
  return (
    <div className="home-bento">
      {items.map((item) => (
        // `?? {}` rather than a bare cast: the cast is for the custom
        // properties (csstype has no index signature for `--*`), and must not
        // also swallow a Map miss. Every item IS placed at every tier today,
        // so a miss means the two loops above have drifted apart — which
        // should render unplaced, not silently typecheck.
        <div key={item.id} style={(placements.get(item.id) ?? {}) as CSSProperties}>
          <HomeCell>{item.body}</HomeCell>
        </div>
      ))}
    </div>
  )
}

/**
 * The cell shell — every widget is a body, never a body plus hand-tuned
 * chrome. Frameless by default: no border, no fill, no radius. A bento gets
 * its compartments from the jump in type scale, the gutters, and the closing
 * hairline; drawing a box around each one is a card grid with the fill turned
 * off, which is what the de-card vocabulary in DESIGN.md already forbids.
 *
 * Every value it paints with is a token (globals.css `.home-cell`), so a
 * future theme can turn fills and radii back on without touching a widget.
 * That stylesheet is also where the cell is made to FILL its grid track,
 * which is what lets a body use `h-full` and `mt-auto` and what makes
 * `overflow: hidden` above actually clip something.
 */
function HomeCell({ children }: { children: ReactNode }) {
  return <div className="home-cell">{children}</div>
}
