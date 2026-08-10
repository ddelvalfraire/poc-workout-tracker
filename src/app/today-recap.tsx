'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Check, ChevronRight } from 'lucide-react'
import { isSameLocalDay } from '@/lib/local-day'
import { formatVolume, formatWorkoutDuration } from '@/lib/format'
import type { WeightUnit } from '@/lib/units'

/**
 * The TODAY recap — celebration, not a list row (spike §3): each session
 * completed on the user's LOCAL today gets a card (name · duration · volume)
 * linking to its summary. Absorbs TodayWorkouts' job with designed weight;
 * PR chips wait for a cheap PR read (spike §5 — the facts aren't in home's
 * summaries today, and no new home queries is a hard rule).
 *
 * "Today" is the USER'S calendar day, so the filter runs client-side after
 * mount — the same useSyncExternalStore pattern the old strip used.
 */
const subscribeNever = () => () => {}
const useMounted = () =>
  useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )

// en-US matches formatWorkoutDate — one locale for all date/time display.
const timeFormat = new Intl.DateTimeFormat('en-US', { timeStyle: 'short' })

export interface RecapWorkout {
  id: string
  name: string | null
  /** Instants as epoch ms — stable RSC serialization. */
  startedAtMs: number
  completedAtMs: number
  volumeKg: number
}

export function TodayRecap({
  workouts,
  unit,
  size = 'md',
}: {
  workouts: RecapWorkout[]
  unit: WeightUnit
  /** Layout size class: sm renders one compact line; md the full cards. */
  size?: 'sm' | 'md'
}) {
  const mounted = useMounted()
  if (!mounted) return null

  const now = new Date()
  const today = workouts.filter((w) => isSameLocalDay(new Date(w.completedAtMs), now))
  if (today.length === 0) return null

  // sm: one line — the check, the session count, the latest name. Same card
  // vocabulary as the md cells, just one of them for the whole day.
  if (size === 'sm') {
    const latest = today[0]
    return (
      <section aria-label="Completed today" className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-primary">Today</h2>
        <ul className="mt-2">
          <li>
            <Link
              href={`/workout/${latest.id}`}
              className="flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 transition-colors active:bg-primary/10"
            >
              <Check
                aria-hidden="true"
                strokeWidth={2.5}
                className="size-5 shrink-0 text-primary"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium tnum">
                  {today.length === 1 ? '1 session today' : `${today.length} sessions today`}
                </span>
                <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                  {latest.name ?? 'Workout'}
                </span>
              </span>
            </Link>
          </li>
        </ul>
      </section>
    )
  }

  return (
    <section aria-label="Completed today" className="mt-6">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-primary">Today</h2>
      <ul className="mt-2 space-y-2">
        {today.map((w) => {
          const facts = [
            formatWorkoutDuration(new Date(w.startedAtMs), new Date(w.completedAtMs)),
            w.volumeKg > 0 ? formatVolume(w.volumeKg, unit) : null,
          ].filter((p): p is string => p !== null)
          return (
            <li key={w.id}>
              <Link
                href={`/workout/${w.id}`}
                className="flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 transition-colors active:bg-primary/10"
              >
                <Check
                  aria-hidden="true"
                  strokeWidth={2.5}
                  className="size-5 shrink-0 text-primary"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{w.name ?? 'Workout'}</span>
                  <span className="mt-0.5 block truncate text-sm text-muted-foreground tnum">
                    {/* Implausible durations and zero volume drop out — the
                        completion time stands in so the line never goes empty. */}
                    {facts.length > 0
                      ? facts.join(' · ')
                      : timeFormat.format(new Date(w.completedAtMs))}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-5 shrink-0 text-muted-foreground"
                />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
