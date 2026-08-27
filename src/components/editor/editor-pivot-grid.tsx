import Link from 'next/link'
import { useTranslations } from 'next-intl'

import type { PivotCell, PivotRow } from '@/app/programs/[id]/editor/pivot-view'
import { EmptyWords } from '@/components/ui/empty-words'
import type { WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'
import type { EditorWeek } from './editor-model'
import { PinRail } from './editor-pin-rail'

/**
 * The block read EXERCISE-WISE — one row per movement, one column per week.
 *
 * The day pane answers "what am I doing on Thursday". This answers the question
 * that surface structurally cannot: does this movement climb, and where did I
 * step in by hand. Both are readings of the same address, which is why the
 * pivot is pane 2's other face rather than a route of its own — the day, the
 * week and the inspected exercise all stay exactly where they were.
 *
 * IT IS A REAL TABLE. Sets, reps and loads are homogeneous and compared down
 * columns, which is what tables exist for, and the alignment IS the mechanism:
 * a load that fails to climb shows up as a flat column and in no other way. It
 * also buys row and column headers for screen readers for free — a grid of divs
 * would have to restate both on every cell.
 *
 * AUTHORED VERSUS DERIVED IS MARKED BY POSITION. `PinRail` carries it, at a
 * fixed x in every cell, so a run of pins reads as a vertical spine. Derived is
 * the unmarked default at FULL contrast: dimming it measured 2.27:1, under the
 * 3:1 WCAG 1.4.1 asks of a non-colour distinction, and tuning greys cannot
 * rescue a channel that was never strong enough.
 *
 * EDITING is separated from pinned by GEOMETRY rather than intensity — a full
 * enclosing ring against a single leading edge — so a cell that is both shows
 * both at once and nothing has to arbitrate.
 *
 * A CELL IS A LINK, NOT A FIELD. Inline grid editing is not built: the only
 * write this surface has is the per-week override the day pane's set rows post,
 * and a cell that looked like an input would promise a second write path that
 * does not exist. So a cell navigates to its own (week × exercise) address,
 * which is where the fields are, and the ring marks the cell you are on.
 */
interface EditorPivotGridProps {
  /** The addressed day's name, or null when no day is addressed. */
  dayName: string | null
  /** The block's weeks, in the same order as every row's cells. */
  weeks: readonly EditorWeek[]
  rows: readonly PivotRow[]
  /** The week the editor is on — one half of the ringed cell. */
  selectedWeek: number
  /** The inspected exercise, or null when the ring has no row to sit on. */
  selectedExercise: number | null
  /** The address for one cell: that week, that exercise. */
  hrefForCell: (exercise: number, week: number) => string
  /** Declared once, in the corner — never per cell. */
  unit: WeightUnit
  className?: string
}

/** The cell's two lines: the scheme, then the load. */
function CellValue({ cell, unit }: { cell: PivotCell; unit: WeightUnit }) {
  const t = useTranslations('ProgramEditor')

  // A cell whose counted sets DISAGREE prints the count and stops. Collapsing
  // "8, 8, 5" into one rep target would state a prescription nobody wrote, and
  // the honest summary of a mixed row is how many sets are in it.
  const scheme =
    cell.setCount === 0
      ? t('pivotNothing')
      : !cell.repsUniform || (cell.repMin === null && cell.repMax === null)
        ? t('setCount', { count: cell.setCount })
        : t('pivotScheme', {
            sets: cell.setCount,
            reps:
              cell.repMin !== null && cell.repMax !== null && cell.repMin !== cell.repMax
                ? t('pivotRepRange', { min: cell.repMin, max: cell.repMax })
                : t('pivotRepExact', { reps: cell.repMax ?? cell.repMin ?? 0 }),
          })

  const load =
    cell.loadLow === null || cell.loadHigh === null
      ? null
      : cell.loadLow === cell.loadHigh
        ? t('pivotLoad', { load: cell.loadLow })
        : t('pivotLoadRange', { low: cell.loadLow, high: cell.loadHigh })

  return (
    <>
      <span className="block tnum">{scheme}</span>
      {load !== null && (
        <span className="block tnum">
          {load}
          {/* The unit is declared once, in the corner header — repeating it in
              every cell is the noise that stopped the old grid fitting on a
              screen. A screen reader arrives at a cell out of that context,
              so it gets the unit and sighted readers do not. */}
          <span className="sr-only"> {unit}</span>
        </span>
      )}
    </>
  )
}

function EditorPivotGrid({
  dayName,
  weeks,
  rows,
  selectedWeek,
  selectedExercise,
  hrefForCell,
  unit,
  className,
}: EditorPivotGridProps) {
  const t = useTranslations('ProgramEditor')

  if (dayName === null) {
    return (
      <div className={cn('px-5 pb-10', className)}>
        <EmptyWords className="mt-10">{t('pivotUnaddressed')}</EmptyWords>
      </div>
    )
  }

  return (
    <div className={cn('px-5 pb-10', className)}>
      <header className="mt-6">
        <h1 className="font-display text-2xl uppercase leading-tight tracking-wide">
          {t('pivotHeading', { day: dayName })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pivotHint')}</p>
      </header>

      {rows.length === 0 ? (
        <EmptyWords>{t('pivotEmpty')}</EmptyWords>
      ) : (
        // The grid is the one thing here that legitimately exceeds the column,
        // so it scrolls inside its own box rather than making the page scroll
        // sideways.
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t('pivotCaption', { day: dayName })}</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="border-r border-r-border/60 border-b-2 border-b-border/60 py-2 pr-3 text-left text-xs font-semibold tracking-widest text-muted-foreground uppercase"
                >
                  {t('pivotMovement', { unit })}
                </th>
                {weeks.map((entry) => (
                  <th
                    key={entry.week}
                    scope="col"
                    className={cn(
                      'border-b-2 border-b-border/60 px-3 py-2 text-center text-xs font-semibold tracking-widest text-muted-foreground uppercase tnum',
                      entry.week === selectedWeek && 'text-foreground',
                    )}
                  >
                    <span className="whitespace-nowrap">{t('weekShort', { week: entry.week })}</span>
                    {/* Deload and past-the-block say so in WORDS. A dashed
                        border alone is a distinction only a sighted reader
                        gets. */}
                    {entry.isDeload && <span className="ml-1 whitespace-nowrap">{t('deload')}</span>}
                    {entry.isBeyondBlock && (
                      <span className="ml-1 whitespace-nowrap tracking-normal normal-case">
                        {t('beyondBlock')}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.position}>
                  <th
                    scope="row"
                    className="border-r border-r-border/60 border-b border-b-border/60 py-2 pr-3 text-left font-medium"
                  >
                    <span className="block max-w-44 truncate">{row.name}</span>
                  </th>
                  {row.cells.map((cell) => {
                    const isFocused = cell.week === selectedWeek && row.position === selectedExercise
                    return (
                      <td key={cell.week} className="border-b border-b-border/60 p-0">
                        <Link
                          href={hrefForCell(row.position, cell.week)}
                          aria-current={isFocused ? 'true' : undefined}
                          aria-label={t('pivotCellLabel', { exercise: row.name, week: cell.week })}
                          className={cn(
                            'relative block min-h-11 py-2 pr-3 pl-3.5 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden [@media(pointer:fine)_and_(min-width:840px)]:min-h-8',
                            // Editing is a full enclosing ring; pinned is a
                            // single leading edge. Different geometry, so a
                            // cell that is both needs no arbitration.
                            isFocused && 'ring-2 ring-primary ring-inset',
                          )}
                        >
                          {cell.pinned && <PinRail className="left-1" />}
                          <CellValue cell={cell} unit={unit} />
                        </Link>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* The legend matches the thing it explains — an actual leading rule and
          an actual ring, not swatches in a shape that appears nowhere above. */}
      <ul className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <li className="flex items-center gap-2">
          <span className="relative block h-5 w-8 border border-border/60">
            <PinRail className="left-1" />
          </span>
          {t('pivotLegendPinned')}
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="block h-5 w-8 border border-border/60" />
          {t('pivotLegendDerived')}
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="block h-5 w-8 ring-2 ring-primary ring-inset" />
          {t('pivotLegendEditing')}
        </li>
      </ul>
    </div>
  )
}

export { EditorPivotGrid }
