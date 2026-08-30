import Link from 'next/link'
import { listBodyweightLogs } from '@/db/bodyweight'
import { getWeightUnit } from '@/db/preferences'
import { bodyweightDeltaKg, trendWeightSeries } from '@/lib/bodyweight-trend'
import { kgToDisplay } from '@/lib/units'
import { getTranslations } from 'next-intl/server'
import { cache } from 'react'

/** The window the rate is measured over. Seven days matches the drawer's
 *  bodyweight delta, so the two surfaces never disagree. */
const RATE_DAYS = 7

/** Below this much movement per week the sign is noise, not a direction. */
const HOLDING_THRESHOLD = 0.05

/** This widget's content, or null when it has nothing to say — the ONE
 *  emptiness decision, read by the grid before it packs a cell and again by
 *  the component below, so the two can never disagree. Every reader inside is
 *  request-memoized, so the second read costs no query. See
 *  renderHomeSections. */
export const weightTrendContent = cache(async (userId: string) => {
  const [logs, unit] = await Promise.all([listBodyweightLogs(userId), getWeightUnit(userId)])
  if (logs.length === 0) return null
  // BOTH guards belong here, not just the first: a single weigh-in gives a
  // series with no rate, and a cell packed on "has logs" would still render
  // nothing.
  const trend = trendWeightSeries(logs)
  const rateKg = bodyweightDeltaKg(trend, RATE_DAYS)
  return rateKg === null ? null : { trend, rateKg, unit }
})

/**
 * Bodyweight as a RATE, not a number.
 *
 * A cut is a rate problem: the scale moves for reasons that have nothing to do
 * with fat, so any single day's reading is noise and the direction is the
 * signal. The headline is therefore change per week over the TREND series (a
 * time-decayed average, so two weigh-ins in one day do not count double), and
 * the absolute weight is demoted to the qualifier.
 *
 * Silent until the rate can actually be computed — with a single weigh-in
 * there is a weight but no trend, and a rate of "0.00" would be a fabrication.
 */
export async function WeightTrend({ userId }: { userId: string }) {
  const t = await getTranslations('WeightTrend')
  const content = await weightTrendContent(userId)
  if (content === null) return null
  const { trend, rateKg, unit } = content

  const rate = kgToDisplay(rateKg, unit)
  const latest = kgToDisplay(trend[0].weightKg, unit)
  const holding = Math.abs(rate) < HOLDING_THRESHOLD

  return (
    <Link href="/body" className="flex h-full flex-col transition-colors active:bg-muted/60">
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
          {t('title')}
        </span>
        <span className="shrink-0 text-[0.6rem] uppercase tracking-[0.08em] text-muted-foreground">
          {t('window')}
        </span>
      </span>

      <span className="mt-auto flex flex-col justify-end">
        <span className="flex items-baseline gap-1">
          <span className="font-display text-[2.6rem] font-semibold leading-[0.82] tnum">
            {holding ? t('holding') : `${rate > 0 ? '+' : '−'}${Math.abs(rate).toFixed(2)}`}
          </span>
          {!holding && (
            <span className="text-[0.68rem] font-medium text-muted-foreground">
              {t('perWeek', { unit })}
            </span>
          )}
        </span>
        <span className="mt-1.5 block text-[0.7rem] text-muted-foreground tnum">
          {t('caption', { weight: latest.toFixed(1), unit })}
        </span>
      </span>
    </Link>
  )
}
