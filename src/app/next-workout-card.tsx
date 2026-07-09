import Link from 'next/link'
import type { NextProgramDay } from '@/db/programs'
import { StartDayButton } from '@/app/programs/[id]/start-day-button'

/**
 * The home screen's hero: the next day to train in the user's active program,
 * startable in one tap. Replaces the 4-tap Programs → program → day → start
 * path for the common case of "just give me today's session".
 */
export function NextWorkoutCard({ next }: { next: NextProgramDay }) {
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
