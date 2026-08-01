'use client'

import { useEffect, useState } from 'react'
import { weeklyStreak } from '@/lib/goal-progress'

interface ConsistencyProgressProps {
  completedAtTimes: number[]
  scheduledWeekdays: number[]
  allowedMissesPerWeek: number
  targetWeeks: number
}

/**
 * The consistency card's live readout: streak weeks vs the target, computed
 * CLIENT-side after mount because a "week" is the user's calendar week, not
 * the server's (local-day.ts principle). Until mounted it shows the target
 * line only — no zero flashes, no SSR mismatch.
 */
export function ConsistencyProgress({
  completedAtTimes,
  scheduledWeekdays,
  allowedMissesPerWeek,
  targetWeeks,
}: ConsistencyProgressProps) {
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

  const percent =
    weeks === null ? 0 : Math.max(0, Math.min(100, Math.round((weeks / targetWeeks) * 100)))

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted-foreground tnum">
          {weeks === null ? `Target ${targetWeeks} weeks` : `${weeks} of ${targetWeeks} weeks`}
        </span>
        {weeks !== null && (
          <span className="text-xs font-semibold text-muted-foreground tnum">{percent}%</span>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuenow={weeks ?? 0}
        aria-valuemin={0}
        aria-valuemax={targetWeeks}
        aria-label="Streak progress"
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      {scheduledWeekdays.length === 0 && (
        // The honest empty state: without scheduled weekdays there is nothing
        // to adhere to — point at the fix instead of showing a dead zero.
        <p className="mt-2 text-xs text-muted-foreground">
          Schedule weekdays on your program days to start the streak.
        </p>
      )}
    </div>
  )
}
