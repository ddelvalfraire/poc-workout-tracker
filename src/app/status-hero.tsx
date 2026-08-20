'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { activeSessionHref } from '@/lib/active-session'
import {
  statusForHome,
  type HomeStatusFacts,
  type StatusHeroKey,
  type StatusHeroLine,
} from '@/lib/home-status'
import { renderLine } from '@/lib/i18n/message'
import { weeklyStreak } from '@/lib/goal-progress'
import type { WeightUnit } from '@/lib/units'
import { StartDayButton } from '@/app/programs/[id]/start-day-button'
import { GuardedStartLink } from '@/components/guarded-start-link'
import type { SessionSummary } from '@/components/session-conflict-dialog'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

/**
 * The STATUS zone — home's always-rendered hero (spike §3): an editorial
 * font-display headline + one context sentence + the state's CTA. It replaces
 * NextWorkoutCard, ResumeSessionCard, TrainedTodayGate-as-remover and
 * ProgramReminderCard: the trained-today moment is now a STATE ("Done for
 * today."), never an absence.
 *
 * Client component because every fork here is a LOCAL-calendar question
 * (trained today? drifting how long? scheduled today?) — only the browser
 * knows the user's day (lib/local-day.ts). Same useSyncExternalStore mounted
 * pattern as the old gate; pre-mount we hold the hero's slot with an empty
 * placeholder so the page below doesn't jump when the status pops in.
 */
const subscribeNever = () => () => {}
const useMounted = () =>
  useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )

export interface StatusHeroProps {
  /** The live session — carries the resume key on top of the status facts. */
  session: {
    key: string
    name: string | null
    setCount: number
    completedSetCount: number
  } | null
  nextDay: {
    dayId: string
    programId: string
    programName: string
    dayName: string
    week: number
    mesocycleWeeks: number
    weekdays: number[]
    blockComplete: boolean
  } | null
  /** Completion instants from the last 48h (epoch ms) — trained-today evidence. */
  recentCompletedAtTimes: number[]
  /** Carries the workout id on top of the status facts — the trained-today
   *  state links to the day's completed session. */
  lastCompleted: { id: string; name: string | null; completedAtMs: number; volumeKg: number } | null
  lastTimeVolumeKg: number | null
  /** Consistency-goal streak evidence (weeks computed here, client-side). */
  streak: {
    completedAtTimes: number[]
    scheduledWeekdays: number[]
    allowedMissesPerWeek: number
  } | null
  /** Single-active-session guard for every start CTA (same as history Repeat). */
  guardSession: SessionSummary | null
  unit: WeightUnit
}

export function StatusHero(props: StatusHeroProps) {
  const t = useTranslations('StatusHero')
  const mounted = useMounted()
  if (!mounted) {
    // Hold the slot (approx. hero height) so MomentumPanel doesn't jump when
    // the status arrives in the hydration frame — the accepted local-day
    // tradeoff, minus the old gate's layout shift.
    return <section aria-hidden="true" className="mt-6 min-h-44" />
  }

  const now = new Date()
  const streakWeeks = props.streak
    ? weeklyStreak({
        scheduledWeekdays: props.streak.scheduledWeekdays,
        completions: props.streak.completedAtTimes.map((t) => new Date(t)),
        allowedMissesPerWeek: props.streak.allowedMissesPerWeek,
        now,
      })
    : null

  const facts: HomeStatusFacts = {
    session: props.session,
    nextDay: props.nextDay,
    recentCompletedAtTimes: props.recentCompletedAtTimes,
    lastCompleted: props.lastCompleted,
    lastTimeVolumeKg: props.lastTimeVolumeKg,
    streakWeeks,
  }
  const status = statusForHome(facts, props.unit, now)
  // The status brain returns descriptors (docs/I18N-KEYS.md §9); the words
  // are resolved here, where the translator lives.
  const line = (l: StatusHeroLine) => renderLine<StatusHeroKey>(t, l)

  // Volt rides live/achievement eyebrows only (the narrow-vocabulary rule);
  // the rest-day eyebrow is the program name, a fact, and stays muted.
  const eyebrowIsVolt = status.state !== 'rest-day'

  return (
    <section aria-label={t('sectionLabel')} className="mt-6 motion-safe:animate-rise-in">
      {status.eyebrow !== null && (
        <p
          className={cn(
            'flex items-center gap-2 text-xs font-semibold uppercase tracking-widest',
            eyebrowIsVolt ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {status.state === 'session-live' && (
            /* Pulsing dot: the one earned motion — "live right now". */
            <span aria-hidden="true" className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
          )}
          {line(status.eyebrow)}
        </p>
      )}

      <h2 className="mt-2 font-display text-4xl uppercase leading-none tracking-wide">
        {line(status.headline)}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground tnum">{line(status.context)}</p>

      {status.state === 'session-live' && props.session && (
        <>
          {props.session.setCount > 0 && (
            <div
              role="progressbar"
              aria-label={t('setsProgressLabel')}
              aria-valuemin={0}
              aria-valuemax={props.session.setCount}
              aria-valuenow={props.session.completedSetCount}
              className="mt-3 h-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{
                  width: `${(props.session.completedSetCount / props.session.setCount) * 100}%`,
                }}
              />
            </div>
          )}
          <Link
            href={activeSessionHref(props.session.key)}
            className={cn(
              buttonVariants({ size: 'lg' }),
              'mt-4 w-full font-semibold uppercase tracking-wide',
            )}
          >
            {t('resumeAction')}
          </Link>
        </>
      )}

      {status.state === 'program-due' && props.nextDay && (
        <div className="mt-4">
          {/* No activeSession guard needed: program-due only renders when no
              session is live (session-live wins the state selection). */}
          <StartDayButton
            programDayId={props.nextDay.dayId}
            size="lg"
            label={t('startDayAction', { day: props.nextDay.dayName })}
          />
        </div>
      )}

      {status.state === 'drifting' &&
        (props.nextDay && !props.nextDay.blockComplete ? (
          <div className="mt-4">
            <StartDayButton
              programDayId={props.nextDay.dayId}
              size="lg"
              label={t('startDayAction', { day: props.nextDay.dayName })}
            />
          </div>
        ) : (
          <GuardedStartLink
            href="/workout/new"
            session={props.guardSession}
            className={cn(
              buttonVariants({ size: 'lg' }),
              'mt-4 w-full font-semibold uppercase tracking-wide',
            )}
          >
            {t('startAction')}
          </GuardedStartLink>
        ))}

      {status.state === 'fresh' && (
        <>
          <GuardedStartLink
            href="/workout/new"
            session={props.guardSession}
            className={cn(
              buttonVariants({ size: 'lg' }),
              'mt-4 w-full text-base font-semibold uppercase tracking-wide',
            )}
          >
            {t('startActionFresh')}
          </GuardedStartLink>
          {/* The old ProgramReminderCard's door, demoted to a quiet line —
              its copy lives in the context sentence above. */}
          <Link
            href="/programs"
            className="mt-3 flex w-fit items-center gap-0.5 text-sm text-muted-foreground underline-offset-2 active:underline"
          >
            {t('programsLink')}
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        </>
      )}

      {status.state === 'trained-today' && props.lastCompleted && (
        /* The day's receipt: the headline says done, this door shows the work. */
        <Link
          href={`/workout/${props.lastCompleted.id}`}
          className="mt-4 flex w-fit items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('sessionLink')}
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      )}

      {(status.state === 'trained-today' || status.state === 'rest-day') && (
        /* Quiet by design (spike table): the day's work is done or not due —
           the door stays open without volt shouting. Same muted-link
           vocabulary as Browse programs / See results, not a chip. */
        <GuardedStartLink
          href="/workout/new"
          session={props.guardSession}
          className={cn(
            'flex w-fit items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground',
            status.state === 'trained-today' ? 'mt-2' : 'mt-4',
          )}
        >
          {status.state === 'trained-today' ? t('logMoreLink') : t('quickLogLink')}
          <ChevronRight aria-hidden="true" className="size-4" />
        </GuardedStartLink>
      )}

      {status.state === 'block-complete' && props.nextDay && (
        <Link
          href={`/programs/${props.nextDay.programId}/stats`}
          className="mt-4 flex w-fit items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('resultsLink')}
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      )}
    </section>
  )
}
