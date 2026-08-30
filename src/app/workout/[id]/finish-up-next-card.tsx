import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { NextProgramDay } from '@/db/programs'
import type { FinishUpNext } from '@/lib/finish-up-next'
import { UpNextAnchor } from '@/components/home/up-next-anchor'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

/**
 * The just-finished summary's follow-up card: the home hero's "up next"
 * answer, restated at the moment the question actually arises. Unlike
 * the home StatusHero this stays a server component — "Start when ready" is a
 * LINK home (where the hero owns the one-tap start), never an instantiate:
 * a mis-tap seconds after finishing must not mint tomorrow's workout row.
 *
 * Both variants keep the volt on type, not buttons — the page's one volt
 * CTA (Repeat workout, in WorkoutActions below) is unchallenged.
 */
export function FinishUpNextCard({
  state,
}: {
  state: Exclude<FinishUpNext<NextProgramDay>, { kind: 'none' }>
}) {
  const t = useTranslations('FinishUpNextCard')
  const { next } = state

  if (state.kind === 'block-complete') {
    return (
      <section className="mt-4 border-b border-b-border/60 py-5 motion-safe:animate-rise-in">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          {t('blockComplete.badge')}
        </p>

        {/* The achievement is the PROGRAM — same poster type as the home
            banner, so the moment reads identically on both surfaces. */}
        <h2 className="mt-2 font-display text-3xl uppercase leading-none tracking-wide">
          {next.programName}
        </h2>

        <div className="mt-3 flex items-baseline justify-between gap-3">
          <p className="text-sm text-muted-foreground tnum">
            {t('blockComplete.summary', { weeks: next.mesocycleWeeks })}
          </p>
          <Link
            href={`/programs/${next.programId}/stats`}
            className="flex shrink-0 items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('blockComplete.action')}
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </section>
    )
  }

  const exerciseCount = next.exerciseNames.length
  return (
    <section className="mt-4 border-b border-b-border/60 py-5 motion-safe:animate-rise-in">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">
        {/* Same schedule anchor as the home hero (up-next-anchor.tsx): the two
            surfaces restate one answer, so they must agree on its wording. */}
        {next.weekdays.length > 0 ? (
          <UpNextAnchor weekdays={next.weekdays} week={next.week} />
        ) : (
          t('upNext.anchor', { week: next.week })
        )}
      </p>

      <h2 className="mt-2 font-display text-3xl uppercase leading-none tracking-wide">
        {next.dayName}
      </h2>

      <p className="mt-2 text-sm text-muted-foreground tnum">
        {t('upNext.summary', { count: exerciseCount, programName: next.programName })}
      </p>

      <div className="mt-4">
        <Link
          href="/"
          className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
        >
          {t('upNext.action')}
        </Link>
      </div>
    </section>
  )
}
