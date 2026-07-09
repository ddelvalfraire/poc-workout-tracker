'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { isSameLocalDay } from '@/lib/local-day'

interface TodayWorkout {
  id: string
  name: string | null
  startedAt: Date
}

// "Today" must be the USER'S calendar day, so the filter runs client-side.
// During SSR/hydration we render nothing (server "today" may differ from the
// browser's); the section appears after mount. useSyncExternalStore is the
// hydration-safe mounted check — no effect + setState cascade.
const subscribeNever = () => () => {}
const useMounted = () =>
  useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )

// en-US to match formatWorkoutDate — the app commits to one locale for all
// date/time display rather than mixing US dates with browser-locale times.
const timeFormat = new Intl.DateTimeFormat('en-US', { timeStyle: 'short' })

/** The sessions already logged today, as a compact "done" strip above history. */
export function TodayWorkouts({ workouts }: { workouts: TodayWorkout[] }) {
  const mounted = useMounted()
  if (!mounted) return null

  const now = new Date()
  const today = workouts.filter((w) => isSameLocalDay(new Date(w.startedAt), now))
  if (today.length === 0) return null

  return (
    <section className="mt-6 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">Done today</p>
      <ul className="mt-1.5 space-y-1.5">
        {today.map((w) => (
          <li key={w.id}>
            <Link href={`/workout/${w.id}`} className="flex items-center gap-2 text-sm">
              <Check
                aria-hidden="true"
                strokeWidth={2.5}
                className="size-4 shrink-0 text-primary"
              />
              <span className="min-w-0 truncate font-medium">{w.name ?? 'Workout'}</span>
              <span className="ml-auto shrink-0 text-muted-foreground tnum">
                {timeFormat.format(new Date(w.startedAt))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
