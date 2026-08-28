import Link from 'next/link'
import { getRollingVolumeTotals } from '@/db/muscle-volume'
import { cardioWeek } from '@/lib/home/cardio-week'
import type { HomeSectionShape } from '@/lib/home/registry'
import { getTranslations } from 'next-intl/server'

/**
 * Conditioning minutes for the rolling week, with the week-over-week delta.
 *
 * Self-fetching RSC like MomentumPanel, and free: `getRollingVolumeTotals` is
 * request-memoized, and the panel already calls it, so this widget adds no
 * query. The seconds it reads have been computed on every home request since
 * cardio logging shipped and thrown away every time.
 *
 * Renders nothing when the week holds no cardio — the catalog's absence rule.
 * A lifter who never logs a duration set gets no tile, not an empty one.
 */
export async function CardioWeek({ userId, shape }: { userId: string; shape: HomeSectionShape }) {
  const t = await getTranslations('CardioWeek')
  const totals = await getRollingVolumeTotals(userId)
  const week = cardioWeek(totals.currentCardioSec, totals.previousCardioSec)
  if (week === null) return null

  return (
    <Link href="/stats" className="flex h-full flex-col transition-colors active:bg-muted/60">
      <span className="font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
        {t('title')}
      </span>
      <span className="mt-auto flex flex-col justify-end">
        <span className="flex items-baseline gap-1">
          {/* The one big number. Oswald at this size is the type mass that
              makes a frameless cell read as a compartment. */}
          <span className="font-display text-[2.1rem] font-semibold leading-[0.82] tnum">
            {week.minutes}
          </span>
          <span className="text-[0.68rem] font-medium text-muted-foreground">{t('unit')}</span>
        </span>
        {week.deltaMinutes !== null && (
          <span
            className={
              week.deltaMinutes > 0
                ? 'mt-1.5 block text-[0.7rem] text-primary tnum'
                : 'mt-1.5 block text-[0.7rem] text-muted-foreground tnum'
            }
          >
            {/* One ICU message with a select, not a sign glued to a number:
                the comparison reads differently once translated. */}
            {t('delta', { direction: week.deltaMinutes > 0 ? 'up' : 'down', count: Math.abs(week.deltaMinutes) })}
          </span>
        )}
        {/* `wide` has room for the qualifier even when there is no delta. */}
        {shape !== 'micro' && week.deltaMinutes === null && (
          <span className="mt-1.5 block text-[0.7rem] text-muted-foreground">{t('firstWeek')}</span>
        )}
      </span>
    </Link>
  )
}
