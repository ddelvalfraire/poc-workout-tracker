import Link from 'next/link'
import { getGoalsHomeSummary } from '@/lib/goals'
import { StreakChip } from '@/components/streak-chip'
import { getTranslations } from 'next-intl/server'
import { cache } from 'react'

/** This widget's content, or null when it has nothing to say — the ONE
 *  emptiness decision, read by the grid before it packs a cell and again by
 *  the component below, so the two can never disagree. Every reader inside is
 *  request-memoized, so the second read costs no query. See
 *  renderHomeSections. */
export const streakCardContent = cache(async (userId: string) => {
  const summary = await getGoalsHomeSummary(userId)
  return summary?.streak ?? null
})

/**
 * Scheduled-day consistency, with the user's own grace setting honoured.
 *
 * Silent unless a consistency goal exists — a streak against no schedule is a
 * number with nothing behind it, and the goals read only carries the evidence
 * when there is a schedule to measure against.
 *
 * The weeks themselves are computed CLIENT-side by StreakChip: "this week" is
 * the user's calendar, not the server's (the local-day principle), so the
 * server hands over evidence rather than a verdict.
 */
export async function StreakCard({ userId }: { userId: string }) {
  const t = await getTranslations('StreakCard')
  const streak = await streakCardContent(userId)
  if (streak === null) return null

  return (
    <Link href="/goals" className="flex h-full flex-col transition-colors active:bg-muted/60">
      <span className="font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
        {t('title')}
      </span>
      <span className="mt-auto flex flex-col justify-end gap-2">
        <StreakChip
          completedAtTimes={streak.completedAtTimes}
          scheduledWeekdays={streak.scheduledWeekdays}
          allowedMissesPerWeek={streak.allowedMissesPerWeek}
        />
      </span>
    </Link>
  )
}
