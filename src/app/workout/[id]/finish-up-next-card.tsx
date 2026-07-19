import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { NextProgramDay } from '@/db/programs'
import type { FinishUpNext } from '@/lib/finish-up-next'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The just-finished summary's follow-up card: the home hero's "up next"
 * answer, restated at the moment the question actually arises. Unlike
 * NextWorkoutCard this stays a server component — "Start when ready" is a
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
  const { next } = state

  if (state.kind === 'block-complete') {
    return (
      <section className="mt-4 rounded-2xl border border-primary/50 bg-card p-5 motion-safe:animate-rise-in">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          Block complete
        </p>

        {/* The achievement is the PROGRAM — same poster type as the home
            banner, so the moment reads identically on both surfaces. */}
        <h2 className="mt-2 font-display text-3xl uppercase leading-none tracking-wide">
          {next.programName}
        </h2>

        <div className="mt-3 flex items-baseline justify-between gap-3">
          <p className="text-sm text-muted-foreground tnum">
            Every week trained · {next.mesocycleWeeks} week
            {next.mesocycleWeeks === 1 ? '' : 's'}
          </p>
          <Link
            href={`/programs/${next.programId}/stats`}
            className="flex shrink-0 items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            See results
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </section>
    )
  }

  const exerciseCount = next.exerciseNames.length
  return (
    <section className="mt-4 rounded-2xl border border-border bg-card p-5 motion-safe:animate-rise-in">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">
        Up next · Week {next.week}
      </p>

      <h2 className="mt-2 font-display text-3xl uppercase leading-none tracking-wide">
        {next.dayName}
      </h2>

      <p className="mt-2 text-sm text-muted-foreground tnum">
        {exerciseCount} exercise{exerciseCount === 1 ? '' : 's'} · {next.programName}
      </p>

      <div className="mt-4">
        <Link
          href="/"
          className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
        >
          Start when ready
        </Link>
      </div>
    </section>
  )
}
