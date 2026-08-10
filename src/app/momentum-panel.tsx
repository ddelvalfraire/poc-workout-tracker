import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { HomeSectionSize } from '@/lib/home/registry'
import { listWorkoutSummaries } from '@/db/workouts'
import { getWeightUnit } from '@/db/preferences'
import { getRollingVolumeTotals } from '@/db/muscle-volume'
import { getGoalsHomeSummary } from '@/lib/goals'
import { goalLabel } from '@/lib/goal-progress'
import { bucketDaySets } from '@/lib/drawer-status'
import { momentumSessionsLine } from '@/lib/home-status'
import { Sparkbar } from '@/components/sparkbar'
import { StreakChip } from '@/components/streak-chip'

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
   *  md (default) and lg render the full panel. */
  size?: HomeSectionSize
}

export async function MomentumPanel({ userId, nowMs, size = 'md' }: MomentumPanelProps) {
  const [summaries, unit, goalsSummary, weekTotals] = await Promise.all([
    listWorkoutSummaries(userId),
    getWeightUnit(userId),
    getGoalsHomeSummary(userId),
    getRollingVolumeTotals(userId),
  ])

  // True day one — nothing completed and no goals: skip the panel entirely
  // (moved verbatim from the page). The fresh StatusHero already invites, and
  // two stacked invitations would compete.
  const completed = summaries.filter((w) => w.completedAt !== null)
  if (completed.length === 0 && goalsSummary === null) return null

  const weekSets = weekTotals.currentSets
  const weekSessions = weekTotals.currentSessions
  const daySets = bucketDaySets(summaries, new Date(nowMs))
  const goal = goalsSummary?.topGoal
    ? {
        activeCount: goalsSummary.activeCount,
        label: goalLabel(goalsSummary.topGoal, unit),
        streak: goalsSummary.streak,
      }
    : null

  // sm: the one big number + streak flame ONLY — same card, same type
  // styles, everything else (sparkbar, sessions line, goal line) dropped.
  if (size === 'sm') {
    return (
      <section
        aria-label="This week"
        className="mt-6 overflow-hidden rounded-2xl border border-border bg-card"
      >
        <Link href="/stats" className="block p-5 transition-colors active:bg-muted/60">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            This week
          </span>
          <span className="mt-3 flex items-baseline gap-2">
            <span className="font-display text-6xl leading-none tnum">{weekSets}</span>
            <span className="text-sm font-medium text-muted-foreground">
              {weekSets === 1 ? 'set' : 'sets'}
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
    <section
      aria-label="This week"
      className="mt-6 overflow-hidden rounded-2xl border border-border bg-card"
    >
      <Link href="/stats" className="block p-5 transition-colors active:bg-muted/60">
        <span className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            This week
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
                {weekSets === 1 ? 'set' : 'sets'}
              </span>
            </span>
            <span className="mt-1.5 block text-sm text-muted-foreground tnum">
              {weekSets > 0
                ? momentumSessionsLine(weekSessions)
                : 'The week is wide open — log a session.'}
            </span>
          </span>
          {daySets.length > 0 && (
            <Sparkbar daySets={daySets} className="h-10 shrink-0 gap-1.5" barClassName="w-2.5" />
          )}
        </span>
      </Link>

      {goal !== null && (
        <Link
          href="/goals"
          className="flex items-center justify-between gap-3 border-t border-border px-5 py-3.5 transition-colors active:bg-muted/60"
        >
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {goal.activeCount === 1 ? 'Goal' : `Goals · ${goal.activeCount}`}
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
