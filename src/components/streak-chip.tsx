'use client'

import { useEffect, useState } from 'react'
import { Flame } from 'lucide-react'
import { weeklyStreak } from '@/lib/goal-progress'

interface StreakChipProps {
  /** Completion instants (epoch ms — stable RSC serialization). */
  completedAtTimes: number[]
  /** Scheduled weekdays 0–6 Sunday-first (active program's union). */
  scheduledWeekdays: number[]
  /** The consistency goal's own grace setting. */
  allowedMissesPerWeek: number
}

/**
 * The streak flame — honest gamification's one ornament: a count of real
 * weeks trained to schedule (within the goal's grace), nothing invented.
 * Weeks are the USER'S calendar weeks, so the count is computed client-side
 * after mount (the local-day.ts principle — the server's week boundary is
 * not the user's). Renders nothing until mounted and nothing for a zero
 * streak: an unlit flame is noise, not motivation.
 */
export function StreakChip({
  completedAtTimes,
  scheduledWeekdays,
  allowedMissesPerWeek,
}: StreakChipProps) {
  const [weeks, setWeeks] = useState<number | null>(null)

  useEffect(() => {
    setWeeks(
      weeklyStreak({
        scheduledWeekdays,
        completions: completedAtTimes.map((t) => new Date(t)),
        allowedMissesPerWeek,
        now: new Date(),
      }),
    )
  }, [completedAtTimes, scheduledWeekdays, allowedMissesPerWeek])

  if (weeks === null || weeks === 0) return null

  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-primary tnum">
      <Flame aria-hidden="true" className="size-3.5" />
      {weeks} wk
      <span className="sr-only">
        {weeks === 1 ? 'week' : 'weeks'} training streak
      </span>
    </span>
  )
}
