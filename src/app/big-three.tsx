import Link from 'next/link'
import { getBigThree } from '@/db/home-records'
import { getWeightUnit } from '@/db/preferences'
import { formatVolumeParts } from '@/lib/format'
import type { HomeSectionShape } from '@/lib/home/registry'
import type { CanonicalLift } from '@/lib/trophy-kinds'
import { getTranslations } from 'next-intl/server'
import { cache } from 'react'

/** The order the total is read in, and the order the rows are listed in. */
const LIFTS: readonly CanonicalLift[] = ['squat', 'bench', 'deadlift']

/** This widget's content, or null when it has nothing to say — the ONE
 *  emptiness decision, read by the grid before it packs a cell and again by
 *  the component below, so the two can never disagree. Every reader inside is
 *  request-memoized, so the second read costs no query. See
 *  renderHomeSections. */
export const bigThreeContent = cache(async (userId: string) => {
  const [{ bests, totalKg }, unit] = await Promise.all([getBigThree(userId), getWeightUnit(userId)])
  return totalKg === null ? null : { bests, totalKg, unit }
})

/**
 * Estimated squat + bench + deadlift total — the powerlifting anchor, and the
 * catalog's first `block`.
 *
 * Renders nothing until all three lifts have a scored best, because the
 * headline IS the total and a total missing a lift is not a total. Someone
 * who only benches gets no tile rather than a misleading one; the per-lift
 * records still live on the exercise pages.
 */
export async function BigThree({ userId, shape }: { userId: string; shape: HomeSectionShape }) {
  const t = await getTranslations('BigThree')
  const content = await bigThreeContent(userId)
  if (content === null) return null
  const { bests, totalKg, unit } = content
  const total = formatVolumeParts(totalKg, unit)

  return (
    <Link href="/trophies" className="flex h-full flex-col transition-colors active:bg-muted/60">
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
          {t('title')}
        </span>
        <span className="shrink-0 text-[0.6rem] uppercase tracking-[0.08em] text-muted-foreground">
          {t('more')}
        </span>
      </span>

      <span className="mt-2 flex flex-col">
        <span className="flex items-baseline gap-1">
          <span className="font-display text-[3.9rem] font-bold leading-[0.82] tnum">
            {total.value}
          </span>
          <span className="text-[0.68rem] font-medium text-muted-foreground">{total.unit}</span>
        </span>
      </span>

      {/* Only the taller shapes have room for the per-lift breakdown; a
          `wide` cell shows the total alone rather than three cramped rows. */}
      {shape !== 'wide' && shape !== 'micro' && (
        <span className="mt-auto flex flex-col">
          {LIFTS.map((lift) => {
            const best = bests[lift]!
            const value = formatVolumeParts(best.e1rmKg, unit)
            return (
              <span
                key={lift}
                className="flex items-baseline justify-between gap-2 border-b border-b-border/60 py-1.5 text-[0.73rem] last:border-b-0"
              >
                <span className="text-muted-foreground">{t(`lift.${lift}`)}</span>
                <span className="font-medium tnum">
                  {value.value} {value.unit}
                </span>
              </span>
            )
          })}
        </span>
      )}
    </Link>
  )
}
