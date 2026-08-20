'use client'

import { Flame } from 'lucide-react'
import { streakWeekTicks, weeklyStreak, type WeekTickState } from '@/lib/goal-progress'
import { useMounted } from '@/lib/use-mounted'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

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
  const t = useTranslations('ConsistencyProgress')
  // Derived at render behind the mounted gate, not pushed into state by an
  // effect: both readouts are pure functions of the props and the user's
  // clock. Count and ticks still come from ONE walk of the same input, so
  // they cannot disagree.
  const mounted = useMounted()
  const derived: { weeks: number; ticks: WeekTickState[] } | null = (() => {
    if (!mounted) return null
    const input = {
      scheduledWeekdays,
      completions: completedAtTimes.map((t) => new Date(t)),
      allowedMissesPerWeek,
      now: new Date(),
    }
    return { weeks: weeklyStreak(input), ticks: streakWeekTicks(input, targetWeeks) }
  })()

  if (derived === null) {
    return (
      <p className="text-sm text-muted-foreground tnum">
        {t('targetSummary', { weeks: targetWeeks })}
      </p>
    )
  }

  return (
    <div>
      {/* The one big number — real weeks survived, nothing invented. */}
      <p className="flex items-baseline gap-1.5">
        <span className="font-display text-4xl leading-none tnum">{derived.weeks}</span>
        <span className="text-xl text-muted-foreground">{t('weeksUnit')}</span>
        {derived.weeks > 0 && (
          <Flame aria-hidden="true" className="size-4 self-center text-primary" />
        )}
      </p>

      {/* Week ticks: every cell is a real calendar week of the goal. */}
      <div
        role="img"
        aria-label={t('progressLabel', { completed: derived.weeks, target: targetWeeks })}
        className="mt-3 flex flex-wrap gap-1"
      >
        {derived.ticks.map((state, i) => (
          <span
            // Position IS the identity — a tick row has no stable ids.
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
        {t('progressSummary', { completed: derived.weeks, target: targetWeeks })}
      </p>

      {scheduledWeekdays.length === 0 && (
        // The honest empty state: without scheduled weekdays there is nothing
        // to adhere to — point at the fix instead of showing a dead zero.
        <p className="mt-2 text-xs text-muted-foreground">
          {t('scheduleHint')}
        </p>
      )}
    </div>
  )
}
