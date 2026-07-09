'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { isSameLocalDay } from '@/lib/local-day'

/**
 * Renders its children (the Up-next hero) ONLY when none of the given
 * completion instants fall on the user's LOCAL calendar day. "Trained today"
 * is a calendar question, and only the browser knows the user's calendar:
 * the server's rolling-hours approximation (the old completedWithinLastHours
 * check) let yesterday evening's session suppress this morning's hero — and
 * "no hero at all" is exactly the bug the user hit ("Right now it's cooked
 * there is no hero card on my app").
 *
 * Same useSyncExternalStore mounted pattern as today-workouts.tsx: we render
 * null during SSR/hydration (server HTML can't know the local day), so the
 * hero pops in after hydration — the same accepted tradeoff as the
 * "Done today" strip, and the two flip in the same frame for the same reason.
 */
const subscribeNever = () => () => {}
const useMounted = () =>
  useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )

export function TrainedTodayGate({
  completedAtTimes,
  children,
}: {
  /** Completion instants as epoch ms (serialization-stable across RSC). */
  completedAtTimes: number[]
  children: ReactNode
}) {
  const mounted = useMounted()
  if (!mounted) return null

  const now = new Date()
  const trainedToday = completedAtTimes.some((t) => isSameLocalDay(new Date(t), now))
  if (trainedToday) return null

  return <>{children}</>
}
