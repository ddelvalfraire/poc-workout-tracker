import Link from 'next/link'
import { getRollingMuscleVolume } from '@/db/muscle-volume'
import { getPlannedWeeklyVolume } from '@/db/planned-volume'
import { aggregateVolumeBalance } from '@/lib/home/balance'
import { getTranslations } from 'next-intl/server'
import { cache } from 'react'

/** This widget's content, or null when it has nothing to say — the ONE
 *  emptiness decision, read by the grid before it packs a cell and again by
 *  the component below, so the two can never disagree. Every reader inside is
 *  request-memoized, so the second read costs no query. See
 *  renderHomeSections. */
export const laggingGroupContent = cache(async (userId: string) => {
  const [performed, planned] = await Promise.all([
    getRollingMuscleVolume(userId),
    getPlannedWeeklyVolume(userId),
  ])
  if (planned === null) return null
  // Both guards, and the second is the interesting one: a user with a plan
  // and nothing lagging is the widget's designed ABSENCE, not an error.
  const balance = aggregateVolumeBalance(performed.groups, planned.groups)
  return balance?.lagging == null ? null : balance.lagging
})

/**
 * The verdict from muscle-balance without the chart, for anyone who wants the
 * answer rather than the evidence.
 *
 * Renders NOTHING when every group has met its plan — absence, not a green
 * all-clear. A widget whose only job is to name a problem should disappear
 * when there is no problem rather than spend a cell saying so.
 *
 * Shares both reads with MuscleBalance (each is request-memoized), so running
 * the two together costs no extra query.
 */
export async function LaggingGroup({ userId }: { userId: string }) {
  const t = await getTranslations('LaggingGroup')
  const lagging = await laggingGroupContent(userId)
  if (lagging === null) return null
  const short = Math.round(lagging.plannedSets - lagging.doneSets)

  return (
    <Link href="/stats" className="flex h-full flex-col transition-colors active:bg-muted/60">
      <span className="min-w-0 truncate font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
        {t('title')}
      </span>
      <span className="mt-auto flex flex-col justify-end">
        <span className="flex items-baseline gap-1">
          <span className="font-display text-[2.1rem] font-semibold leading-[0.82] tnum">
            &minus;{short}
          </span>
          <span className="text-[0.68rem] font-medium text-muted-foreground">
            {t('unit', { group: lagging.group })}
          </span>
        </span>
        <span className="mt-1.5 block text-[0.7rem] text-muted-foreground tnum">
          {t('caption', {
            done: Math.round(lagging.doneSets),
            planned: Math.round(lagging.plannedSets),
          })}
        </span>
      </span>
    </Link>
  )
}
