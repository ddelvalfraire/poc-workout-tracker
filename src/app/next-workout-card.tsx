import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { NextProgramDay } from '@/db/programs'
import { StartDayButton } from '@/app/programs/[id]/start-day-button'

/**
 * The home screen's hero: the next day to train in the user's active program,
 * startable in one tap. Replaces the 4-tap Programs → program → day → start
 * path for the common case of "just give me today's session".
 *
 * A finished block swaps the Start CTA for a compact completion banner — the
 * full payoff (PR deltas, restart) lives on the program page and stats; the
 * hero only announces it. Re-running the final week stays possible from the
 * program page's day cards, so no StartDayButton in that variant.
 */
export function NextWorkoutCard({ next }: { next: NextProgramDay }) {
  if (next.blockComplete) {
    return (
      <section className="mt-6 rounded-2xl border border-primary/50 bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          Block complete
        </p>

        {/* Same poster type as the day variant, but the achievement is the
            PROGRAM — the block is the thing that finished. */}
        <h2 className="mt-2 font-display text-3xl uppercase leading-none tracking-wide">
          {next.programName}
        </h2>

        <div className="mt-3 flex items-baseline justify-between gap-3">
          <p className="text-sm text-muted-foreground tnum">
            {next.mesocycleWeeks} week{next.mesocycleWeeks === 1 ? '' : 's'}
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

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="shrink-0 text-xs font-semibold uppercase tracking-widest text-primary">
          Up next · Week {next.week}
        </p>
        <Link
          href={`/programs/${next.programId}`}
          className="min-w-0 truncate text-xs text-muted-foreground underline-offset-2 active:underline"
        >
          {next.programName}
        </Link>
      </div>

      {/* Poster type: this is the session the lifter came to do — it reads
          like a gym card, not a list row. */}
      <h2 className="mt-2 font-display text-3xl uppercase leading-none tracking-wide">
        {next.dayName}
      </h2>

      {next.exerciseNames.length > 0 && (
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {next.exerciseNames.join(' · ')}
        </p>
      )}

      <div className="mt-4">
        {/* Always the volt CTA: the card only renders when no session is
            live and nothing was completed today, so it owns the screen.
            No activeSession guard needed for the same reason — this card and
            a live session are mutually exclusive by construction (home only
            renders it when resolveActiveSession returned null). */}
        <StartDayButton programDayId={next.dayId} size="lg" label={`Start ${next.dayName}`} />
      </div>
    </section>
  )
}
