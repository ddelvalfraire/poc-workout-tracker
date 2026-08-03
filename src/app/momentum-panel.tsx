import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
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
 * Server component: everything here is tz-free (rolling windows) or already
 * client-delegated (StreakChip computes its weeks after mount). The page
 * skips the panel entirely only on true day one — the fresh StatusHero
 * already invites, and two stacked invitations would compete.
 */
export interface MomentumPanelProps {
  weekSets: number
  weekSessions: number
  /** Seven rolling 24h buckets, oldest first (bucketDaySets). */
  daySets: number[]
  /** The top active goal's line, pre-formatted server-side (goalLabel). */
  goal: {
    activeCount: number
    label: string
    streak: {
      completedAtTimes: number[]
      scheduledWeekdays: number[]
      allowedMissesPerWeek: number
    } | null
  } | null
}

export function MomentumPanel({ weekSets, weekSessions, daySets, goal }: MomentumPanelProps) {
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
