'use client'

import { useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import { scheduleAnchor } from '@/lib/schedule-anchor'

/**
 * The hero eyebrow's text for a SCHEDULED next day: "Today · Week N",
 * "Tomorrow · Week N", or "Friday · Week N". Only the browser knows the
 * user's calendar day (the server renders in UTC — lib/local-day.ts), so the
 * anchor is computed after mount; SSR/hydration show the pre-schedule
 * "Up next · Week N", which the anchor replaces in the hydration frame.
 * Unscheduled days never mount this component — the parent renders the plain
 * literal so that path stays byte-identical to the pre-schedule markup.
 *
 * Same useSyncExternalStore mounted pattern as status-hero.tsx.
 */
const subscribeNever = () => () => {}
const useMounted = () =>
  useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )

export function UpNextAnchor({ weekdays, week }: { weekdays: number[]; week: number }) {
  const t = useTranslations('UpNextAnchor')
  const mounted = useMounted()
  const anchor = mounted ? scheduleAnchor(weekdays, new Date()) : null
  // ONE message: the anchor word, the separator and the week number sit in a
  // language-specific order — concatenating them here would freeze English.
  return <>{t('summary', { anchor: anchor ?? t('fallbackAnchor'), week })}</>
}
