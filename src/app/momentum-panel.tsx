import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { listWorkoutSummaries } from '@/db/workouts'
import { getWeightUnit } from '@/db/preferences'
import { getRollingVolumeTotals } from '@/db/muscle-volume'
import { getGoalsHomeSummary } from '@/lib/goals'
import { goalLabel } from '@/lib/goal-progress'
import { bucketDaySets } from '@/lib/drawer-status'
import { momentumSessionsLine, momentumWeekDeltaLine, type MomentumKey } from '@/lib/home-status'
import { renderLine } from '@/lib/message'
import { Sparkbar } from '@/components/sparkbar'
import { StreakChip } from '@/components/streak-chip'
import { getTranslations } from 'next-intl/server'
import { cache } from 'react'

/**
 * The MOMENTUM panel — ONE designed surface replacing the goals + this-week
 * teaser rows (spike §3: kill the uniform quiet-card grammar). The week's set
 * count is the oversized number (WHOOP's one-big-number rule), the 7-day
 * sparkbar is the drawer's, the goal line + streak flame carry honest
 * gamification. Top block links to /stats, the goal line to /goals.
 *
 * Self-fetching server section: every reader below is request-memoized
 * (React cache — per-request only), so summaries/unit/goals dedupe against
 * the page's own reads; only the rolling totals read belongs to this panel.
 * Net queries per request are identical to when the page fanned everything
 * out itself. Everything here is tz-free (rolling windows) or already
 * client-delegated (StreakChip computes its weeks after mount).
 */
export interface MomentumPanelProps {
  userId: string
  /** The page's request "now" (epoch ms — serializable, and one instant for
   *  the whole surface) so the sparkbar buckets match the history sections. */
  nowMs: number
  /** Layout size class: sm renders only the one big number + streak flame;
   *  md (default) renders the full panel; lg adds the week-over-week line
   *  (from the previous rolling window the totals read already carries). */
  /** Presentational density, chosen by the renderer from the cell's
   *  shape — not the layout vocabulary itself. */
  size?: 'sm' | 'md' | 'lg'
}

/** This widget's content, or null when it has nothing to say — the ONE
 *  emptiness decision, read by the grid before it packs a cell and again by
 *  the component below, so the two can never disagree. Every reader inside is
 *  request-memoized, so the second read costs no query. See
 *  renderHomeSections. */
export const momentumContent = cache(async (userId: string) => {
  const [summaries, goalsSummary] = await Promise.all([
    listWorkoutSummaries(userId),
    getGoalsHomeSummary(userId),
  ])
  // True day one — nothing completed and no goals. The fresh StatusHero
  // already invites, and two stacked invitations would compete.
  const completed = summaries.filter((w) => w.completedAt !== null)
  return completed.length === 0 && goalsSummary === null ? null : { summaries, goalsSummary }
})

export async function MomentumPanel({ userId, nowMs, size = 'md' }: MomentumPanelProps) {
  const t = await getTranslations('MomentumPanel')
  const tGoals = await getTranslations('Goals')
  // ONE parallel round, as before: gating the other two reads behind the
  // content await would serialise them for no gain — and on true day one the
  // grid has already dropped this section, so the component never runs at all.
  const [content, unit, weekTotals] = await Promise.all([
    momentumContent(userId),
    getWeightUnit(userId),
    getRollingVolumeTotals(userId),
  ])
  if (content === null) return null
  const { summaries, goalsSummary } = content

  const weekSets = weekTotals.currentSets
  const weekSessions = weekTotals.currentSessions
  const weekDelta = momentumWeekDeltaLine(weekTotals.currentSets, weekTotals.previousSets)
  const daySets = bucketDaySets(summaries, new Date(nowMs))
  const topGoal = goalsSummary?.topGoal ? goalLabel(goalsSummary.topGoal, unit) : null
  const goal =
    goalsSummary !== null && topGoal !== null
      ? {
          activeCount: goalsSummary.activeCount,
          // Rendered from the GOALS namespace, not this panel's: the label is
          // the goals feature's copy, merely displayed here.
          label: tGoals(topGoal.key, topGoal.values),
          streak: goalsSummary.streak,
        }
      : null

  // sm: the one big number + streak flame ONLY — same card, same type
  // styles, everything else (sparkbar, sessions line, goal line) dropped.
  if (size === 'sm') {
    return (
      <section aria-label={t('title')} className="mt-6 border-b border-b-border/60 md:mt-10">
        <Link href="/stats" className="block py-5 transition-colors active:bg-muted/60">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('title')}
          </span>
          <span className="mt-3 flex items-baseline gap-2">
            <span className="font-display text-6xl leading-none tnum">{weekSets}</span>
            <span className="text-sm font-medium text-muted-foreground">
              {t('setsUnit', { count: weekSets })}
            </span>
          </span>
          {goal?.streak && (
            <span className="mt-3 block">
              <StreakChip
                completedAtTimes={goal.streak.completedAtTimes}
                scheduledWeekdays={goal.streak.scheduledWeekdays}
                allowedMissesPerWeek={goal.streak.allowedMissesPerWeek}
              />
            </span>
          )}
        </Link>
      </section>
    )
  }

  return (
    <section aria-label={t('title')} className="mt-6 border-b border-b-border/60 md:mt-10">
      <Link href="/stats" className="block py-5 transition-colors active:bg-muted/60">
        <span className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('title')}
          </span>
          <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        </span>
        <span className="mt-3 flex items-end justify-between gap-4">
          <span className="min-w-0">
            <span className="flex items-baseline gap-2">
              {/* The one big number — arm's-length legible (WHOOP's ~72pt
                  move, scaled to a phone card). tnum keeps it steady. */}
              <span className="font-display text-6xl leading-none tnum">{weekSets}</span>
              <span className="text-sm font-medium text-muted-foreground">
                {t('setsUnit', { count: weekSets })}
              </span>
            </span>
            <span className="mt-1.5 block text-sm text-muted-foreground tnum">
              {weekSets > 0
                ? renderLine<MomentumKey>(t, momentumSessionsLine(weekSessions))
                : t('emptyWeek')}
            </span>
            {/* lg only: the week-over-week fact, from the previous window the
                totals read already fetched (zero new queries). Null (empty
                last week) renders nothing — silence over a hollow compare. */}
            {size === 'lg' && weekDelta !== null && (
              <span className="mt-0.5 block text-sm text-muted-foreground tnum">
                {renderLine<MomentumKey>(t, weekDelta)}
              </span>
            )}
          </span>
          {daySets.length > 0 && (
            <Sparkbar daySets={daySets} className="h-10 shrink-0 gap-1.5" barClassName="w-2.5" />
          )}
        </span>
      </Link>

      {goal !== null && (
        <Link
          href="/goals"
          className="flex items-center justify-between gap-3 border-t border-border/60 py-3.5 transition-colors active:bg-muted/60"
        >
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t('goalLabel', { count: goal.activeCount })}
            </span>
            <span className="mt-0.5 block truncate text-sm">{goal.label}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {goal.streak && (
              <StreakChip
                completedAtTimes={goal.streak.completedAtTimes}
                scheduledWeekdays={goal.streak.scheduledWeekdays}
                allowedMissesPerWeek={goal.streak.allowedMissesPerWeek}
              />
            )}
            <ChevronRight aria-hidden="true" className="size-5 text-muted-foreground" />
          </span>
        </Link>
      )}
    </section>
  )
}
