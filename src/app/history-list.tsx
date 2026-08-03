import Link from 'next/link'
import { ChevronRight, RotateCcw } from 'lucide-react'
import type { WorkoutSummary } from '@/db/workouts'
import type { WeightUnit } from '@/lib/units'
import { formatVolume, formatWorkoutDuration } from '@/lib/format'
import { buttonVariants } from '@/components/ui/button'
import { GuardedStartLink } from '@/components/guarded-start-link'
import type { SessionSummary } from '@/components/session-conflict-dialog'
import { cn } from '@/lib/utils'

// en-US matches formatWorkoutDate — one locale for all date display.
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short' })

/**
 * The completed-workouts list — the rows home's demoted History section and
 * the full /history page share, moved intact from the old home page (calendar
 * anchors, summary links, guarded Repeat). Completed only by contract:
 * unfinished rows live in home's Unfinished section, never here.
 */
export function HistoryList({
  workouts,
  unit,
  guardSession,
}: {
  workouts: WorkoutSummary[]
  unit: WeightUnit
  /** Single-active-session guard for the Repeat starts. */
  guardSession: SessionSummary | null
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
      {workouts.map((w) => (
        // gap-1 gives the Repeat link's expanded hit inset dead space
        // to land in — without it the inset overlaps the row link.
        <li key={w.id} className="flex items-center gap-1">
          <Link
            // Completed only in this list, so every row goes to its summary.
            href={`/workout/${w.id}`}
            className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3.5 transition-colors active:bg-muted/60"
          >
            {/* Stacked calendar block: scanning history is a date
                lookup first — give the eye a fixed tabular anchor
                instead of burying the date mid-sentence. */}
            <span className="flex w-9 shrink-0 flex-col items-center">
              <span className="font-display text-xl leading-none tnum">
                {w.startedAt.getDate()}
              </span>
              <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {monthFormat.format(w.startedAt)}
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{w.name ?? 'Workout'}</span>
              <span className="mt-0.5 block truncate text-sm text-muted-foreground tnum">
                {[
                  formatWorkoutDuration(w.startedAt, w.completedAt),
                  `${w.setCount} set${w.setCount === 1 ? '' : 's'}`,
                  w.volumeKg > 0 ? formatVolume(w.volumeKg, unit) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          </Link>
          {/* Repeat starts a NEW session seeded from this one — so it
              goes through the same guard as the other start CTAs. */}
          <GuardedStartLink
            href={`/workout/new?from=${w.id}`}
            session={guardSession}
            aria-label={`Repeat ${w.name ?? 'Workout'}`}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
              // Invisible inset lifts the 36px visual button toward the
              // 44px HIG target without growing the row.
              'relative mr-2 shrink-0 text-muted-foreground before:absolute before:-inset-1',
            )}
          >
            <RotateCcw aria-hidden="true" className="size-5" />
          </GuardedStartLink>
        </li>
      ))}
    </ul>
  )
}
