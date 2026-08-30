import Link from 'next/link'
import { cn } from '@/lib/utils'
import { segmentFillPct, type BlockWeek } from './block-weeks'
import { useTranslations } from 'next-intl'

/**
 * The block map — the ONE shared mesocycle visualization (TrainerRoad/
 * Juggernaut pattern): a row of week segments, each filling by its
 * days-completed fraction. Learn it once on the programs list, read it
 * identically on the program detail strip and the stats week rows. Pure
 * presentation, server-renderable (Link is the only interactivity); all
 * derivation lives in ./block-weeks.
 *
 * Grammar (matches the stats page's established deload voice):
 *   fill      volt (achievement — completed weeks read solid)
 *   deload    hollow/bordered, volt-outlined fill + DL label (a planned easy
 *             week must never read as slacking)
 *   current   ringed ("you are here")
 */

type BlockMapSize = 'compact' | 'default'

interface BlockSegmentProps {
  dayCountDone: number
  dayCountTotal: number
  isDeload: boolean
  size?: BlockMapSize
  className?: string
}

/** One week's fill bar — the shared geometry the stats week rows also use. */
export function BlockSegment({
  dayCountDone,
  dayCountTotal,
  isDeload,
  size = 'compact',
  className,
}: BlockSegmentProps) {
  const pct = segmentFillPct(dayCountDone, dayCountTotal)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block overflow-hidden rounded-full',
        size === 'compact' ? 'h-1.5' : 'h-2.5',
        isDeload ? 'border border-border bg-transparent' : 'bg-muted',
        className,
      )}
    >
      {pct > 0 && (
        <span
          className={cn(
            'block h-full rounded-full',
            isDeload ? 'border border-primary/60 bg-transparent' : 'bg-primary',
          )}
          style={{ width: `${pct}%` }}
        />
      )}
    </span>
  )
}

interface BlockMapProps {
  weeks: readonly BlockWeek[]
  size?: BlockMapSize
  /** The week the surface is browsing (detail's `?week=` state) — its label
   *  emphasizes and the link gets aria-current. Distinct from isCurrent,
   *  which stays anchored to where training actually is. */
  selectedWeek?: number | null
  /** Present = each segment is a link (the detail page's week switcher);
   *  absent = a read-only strip (list hero, stats). */
  hrefForWeek?: (week: number) => string
  className?: string
}

/** ICU `select` matches strings, not booleans. */
const yesNo = (value: boolean): 'yes' | 'no' => (value ? 'yes' : 'no')

/** The whole mesocycle as one strip of week segments. */
export function BlockMap({
  weeks,
  size = 'compact',
  selectedWeek = null,
  hrefForWeek,
  className,
}: BlockMapProps) {
  const t = useTranslations('BlockMap')

  // ONE message with select arguments, not a joined list of fragments: the
  // clause order and the separator are language-specific, and a translator
  // handed five disconnected words can fix neither.
  function segmentLabel(w: BlockWeek, isSelected: boolean): string {
    return t('segmentLabel', {
      week: w.week,
      days: yesNo(w.dayCountTotal > 0),
      daysDone: w.dayCountDone,
      daysTotal: w.dayCountTotal,
      deload: yesNo(w.isDeload),
      current: yesNo(w.isCurrent),
      selected: yesNo(isSelected),
    })
  }

  return (
    <div className={cn('flex gap-1.5', className)}>
      {weeks.map((w) => {
        const isSelected = w.week === selectedWeek
        const body = (
          <>
            {/* p-px + ring wrapper so the "you are here" ring floats a hair
                off the fill instead of fusing with it. */}
            <span
              className={cn(
                'block rounded-full p-px',
                w.isCurrent && 'ring-1 ring-primary/70',
              )}
            >
              <BlockSegment
                dayCountDone={w.dayCountDone}
                dayCountTotal={w.dayCountTotal}
                isDeload={w.isDeload}
                size={size}
              />
            </span>
            {size === 'default' && (
              <span
                className={cn(
                  'flex items-baseline justify-center gap-0.5 text-[10px] font-semibold uppercase tracking-widest tnum',
                  isSelected ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {w.week}
                {w.isDeload && <span aria-hidden="true">{t('deloadBadge')}</span>}
              </span>
            )}
          </>
        )
        if (hrefForWeek) {
          return (
            <Link
              key={w.week}
              href={hrefForWeek(w.week)}
              aria-current={isSelected ? 'page' : undefined}
              aria-label={segmentLabel(w, isSelected)}
              // before:-inset grows the invisible hit target past the thin
              // strip (repo precedent: the week pills this strip replaces).
              className="relative min-w-0 flex-1 space-y-1 before:absolute before:-inset-y-2.5 before:inset-x-0"
            >
              {body}
            </Link>
          )
        }
        return (
          // role=img: the segment is one graphic whose bar is aria-hidden, so
          // the label is its whole accessible name. Without a role, `span` is
          // generic and ARIA prohibits naming it — the label was being dropped
          // by assistive tech, not merely flagged. The linked branch above
          // needs no role: <a href> is already a `link`, which permits naming.
          <span
            key={w.week}
            role="img"
            className="min-w-0 flex-1 space-y-1"
            aria-label={segmentLabel(w, false)}
          >
            {body}
          </span>
        )
      })}
    </div>
  )
}
