'use client'

import { useEffect, useState } from 'react'
import { Flame } from 'lucide-react'
import { streakWeekTicks, weeklyStreak, type WeekTickState } from '@/lib/goal-progress'
import { cn } from '@/lib/utils'

interface ConsistencyProgressProps {
  completedAtTimes: number[]
  scheduledWeekdays: number[]
  allowedMissesPerWeek: number
  targetWeeks: number
}

/**
 * The consistency card's live readout: the big week count + the week-tick
 * row (one cell per target week — survived weeks fill volt, grace-burned
 * weeks half-fill, the live week pulses), computed CLIENT-side after mount
 * because a "week" is the user's calendar week, not the server's
 * (local-day.ts principle). Until mounted it shows the target line only —
 * no zero flashes, no SSR mismatch. Count and ticks both come from
 * lib/goal-progress's ONE streak walk, so they can never disagree.
 */
export function ConsistencyProgress({
  completedAtTimes,
  scheduledWeekdays,
  allowedMissesPerWeek,
  targetWeeks,
}: ConsistencyProgressProps) {
  const [derived, setDerived] = useState<{ weeks: number; ticks: WeekTickState[] } | null>(null)

  useEffect(() => {
    const input = {
      scheduledWeekdays,
      completions: completedAtTimes.map((t) => new Date(t)),
      allowedMissesPerWeek,
      now: new Date(),
    }
    setDerived({ weeks: weeklyStreak(input), ticks: streakWeekTicks(input, targetWeeks) })
  }, [completedAtTimes, scheduledWeekdays, allowedMissesPerWeek, targetWeeks])

  if (derived === null) {
    return <p className="text-sm text-muted-foreground tnum">Target {targetWeeks} weeks</p>
  }

  return (
    <div>
      {/* The one big number — real weeks survived, nothing invented. */}
      <p className="flex items-baseline gap-1.5">
        <span className="font-display text-4xl leading-none tnum">{derived.weeks}</span>
        <span className="text-xl text-muted-foreground">wks</span>
        {derived.weeks > 0 && (
          <Flame aria-hidden="true" className="size-4 self-center text-primary" />
        )}
      </p>

      {/* Week ticks: every cell is a real calendar week of the goal. */}
      <div
        role="img"
        aria-label={`${derived.weeks} of ${targetWeeks} streak weeks complete`}
        className="mt-3 flex flex-wrap gap-1"
      >
        {derived.ticks.map((state, i) => (
          <span
            // Position IS the identity — a tick row has no stable ids.
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            className={cn(
              'h-2.5 min-w-2.5 flex-1 rounded-full',
              state === 'clean' && 'bg-primary',
              // Grace-burned: the week counted, but not cleanly — half fill.
              state === 'grace' &&
                'bg-[linear-gradient(90deg,var(--primary)_50%,var(--muted)_50%)]',
              state === 'current' &&
                'border border-primary bg-transparent motion-safe:animate-pulse',
              state === 'future' && 'bg-muted',
            )}
          />
        ))}
      </div>

      <p className="mt-2 text-sm text-muted-foreground tnum">
        {derived.weeks} of {targetWeeks} weeks
      </p>

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
