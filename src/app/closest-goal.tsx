import Link from 'next/link'
import { getGoalsHomeSummary } from '@/lib/goals'
import { getWeightUnit } from '@/db/preferences'
import { goalLabel } from '@/lib/goal-progress'
import { getTranslations } from 'next-intl/server'
import { cache } from 'react'

/** This widget's content, or null when it has nothing to say — the ONE
 *  emptiness decision, read by the grid before it packs a cell and again by
 *  the component below, so the two can never disagree. Every reader inside is
 *  request-memoized, so the second read costs no query. See
 *  renderHomeSections. */
export const closestGoalContent = cache(async (userId: string) => {
  const [summary, unit] = await Promise.all([getGoalsHomeSummary(userId), getWeightUnit(userId)])
  if (summary?.topGoal == null) return null
  return { topGoal: summary.topGoal, activeCount: summary.activeCount, unit }
})

/**
 * The goal currently being worked toward.
 *
 * This is the NEWEST unachieved goal, which is what the home goals read
 * already carries. The catalog called for the goal nearest to FALLING
 * (`sortGoalsByTension`), and that is the better ordering — but tension needs
 * evaluated progress for every goal, which is a read per goal that home does
 * not make today. Ordering by tension is a follow-up with its own query, not
 * something to fake by relabelling this one.
 *
 * Silent for anyone with no goals set.
 */
export async function ClosestGoal({ userId }: { userId: string }) {
  const t = await getTranslations('ClosestGoal')
  const tGoals = await getTranslations('Goals')
  const content = await closestGoalContent(userId)
  if (content === null) return null
  const label = goalLabel(content.topGoal, content.unit)

  return (
    <Link href="/goals" className="flex h-full flex-col transition-colors active:bg-muted/60">
      <span className="min-w-0 truncate font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
        {t('title', { count: content.activeCount })}
      </span>
      <span className="mt-auto flex flex-col justify-end">
        {/* Rendered from the GOALS namespace, not this widget's: the label is
            the goals feature's copy, merely displayed here. */}
        <span className="line-clamp-2 text-[0.95rem] font-medium leading-tight">
          {tGoals(label.key, label.values)}
        </span>
      </span>
    </Link>
  )
}
