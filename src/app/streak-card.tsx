import Link from 'next/link'
import { getGoalsHomeSummary } from '@/lib/goals'
import { StreakChip } from '@/components/streak-chip'
import { getTranslations } from 'next-intl/server'

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
  const summary = await getGoalsHomeSummary(userId)
  if (summary?.streak == null) return null

  return (
    <Link href="/goals" className="flex h-full flex-col transition-colors active:bg-muted/60">
      <span className="font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
        {t('title')}
      </span>
      <span className="mt-auto flex flex-col justify-end gap-2">
        <StreakChip
          completedAtTimes={summary.streak.completedAtTimes}
          scheduledWeekdays={summary.streak.scheduledWeekdays}
          allowedMissesPerWeek={summary.streak.allowedMissesPerWeek}
        />
      </span>
    </Link>
  )
}
