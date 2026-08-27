import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { EmptyWords } from '@/components/ui/empty-words'
import { cn } from '@/lib/utils'
import type { EditorDay, EditorWeek } from './editor-model'

/**
 * Pane 1 — the editor's table of contents: the block's weeks, then the
 * program's days.
 *
 * Below the pane breakpoint this IS the editor's landing page and its day rows
 * NAVIGATE; at or above it the same rows SELECT and the day appears beside
 * them. Nothing here knows which of those is happening: both are the same links
 * to the same addresses, built by the caller with `editorHref`, which is what
 * makes the two projections one implementation rather than two.
 *
 * Rows are a 44px touch target by default and compact to 32px ONLY where the
 * input is a pointer AND the pane projection is on — the narrow allowance
 * DESIGN.md grants, expressed as the condition it is granted under rather than
 * as a width test that would shrink rows under a finger on a tablet.
 */
interface EditorStructurePaneProps {
  weeks: readonly EditorWeek[]
  selectedWeek: number
  hrefForWeek: (week: number) => string
  days: readonly EditorDay[]
  /** 0-based position of the addressed day, or null for the structure-only view. */
  selectedDay: number | null
  hrefForDay: (day: number) => string
  className?: string
}

/** The row geometry both lists share (see the class note above). */
const ROW =
  'flex min-h-11 items-center gap-2 px-1 py-2 text-sm transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden [@media(pointer:fine)_and_(min-width:840px)]:min-h-8 [@media(pointer:fine)_and_(min-width:840px)]:py-1'

function EditorStructurePane({
  weeks,
  selectedWeek,
  hrefForWeek,
  days,
  selectedDay,
  hrefForDay,
  className,
}: EditorStructurePaneProps) {
  const t = useTranslations('ProgramEditor')

  return (
    <div className={cn('px-4 pb-10', className)}>
      <nav aria-label={t('weeksLabel')} className="mt-6">
        <h2 className="font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
          {t('weeksTitle')}
        </h2>
        <ul className="mt-1 divide-y divide-border/60 border-b border-b-border/60">
          {weeks.map((entry) => {
            const isSelected = entry.week === selectedWeek
            return (
              <li key={entry.week}>
                <Link
                  href={hrefForWeek(entry.week)}
                  aria-current={isSelected ? 'page' : undefined}
                  className={cn(ROW, isSelected && 'font-semibold text-foreground')}
                >
                  <span className="tnum">{t('week', { week: entry.week })}</span>
                  {entry.isDeload && (
                    <span className="text-xs uppercase tracking-widest text-muted-foreground">
                      {t('deload')}
                    </span>
                  )}
                  {entry.isBeyondBlock && (
                    <span className="text-xs text-muted-foreground">{t('beyondBlock')}</span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <nav aria-label={t('daysLabel')} className="mt-8">
        <h2 className="font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
          {t('daysTitle')}
        </h2>
        {days.length === 0 ? (
          <EmptyWords>{t('daysEmpty')}</EmptyWords>
        ) : (
          <ul className="mt-1 divide-y divide-border/60 border-b border-b-border/60">
            {days.map((day) => {
              const isSelected = day.position === selectedDay
              return (
                <li key={day.position}>
                  <Link
                    href={hrefForDay(day.position)}
                    aria-current={isSelected ? 'page' : undefined}
                    className={cn(
                      ROW,
                      'justify-between',
                      // The surface's ONE volt moment: which day you are on.
                      // Weeks and exercises mark selection with weight and a
                      // rule instead, so the accent never stacks.
                      isSelected && 'font-semibold text-primary',
                    )}
                  >
                    <span className="min-w-0 truncate">{day.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tnum">
                      {t('exerciseCount', { count: day.exerciseCount })}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </nav>
    </div>
  )
}

export { EditorStructurePane }
