import Link from 'next/link'
import { ChevronRight, RotateCcw } from 'lucide-react'
import type { WorkoutSummary } from '@/db/workouts'
import type { WeightUnit } from '@/lib/units'
import { formatVolume, formatWorkoutDuration } from '@/lib/format'
import { buttonVariants } from '@/components/ui/button'
import { DividerList } from '@/components/ui/divider-list'
import { GuardedStartLink } from '@/components/guarded-start-link'
import type { SessionSummary } from '@/components/session-conflict-dialog'
import { rowEmphasisPct } from './history/history-view'
import { useLocale, useTranslations } from 'next-intl'
import { renderMessage } from '@/lib/message'
import { cn } from '@/lib/utils'

// en-US matches formatWorkoutDate — one locale for all date display.
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short' })

/**
 * The completed-workouts list — the rows home's demoted History section and
 * the full /history page share, moved intact from the old home page (calendar
 * anchors, summary links, guarded Repeat). Completed only by contract:
 * unfinished rows live in home's Unfinished section, never here.
 *
 * The split, deliberately: /history's month grouping and sticky headers live
 * in /history/page.tsx (one section = one HistoryList), and the volume
 * emphasis bar only renders when the caller passes `maxVolumeKg` — home's
 * compact last-5 passes neither, so its render is byte-identical to before.
 * One shared row component, two densities; no API break.
 */
export function HistoryList({
  workouts,
  unit,
  guardSession,
  maxVolumeKg,
}: {
  workouts: WorkoutSummary[]
  unit: WeightUnit
  /** Single-active-session guard for the Repeat starts. */
  guardSession: SessionSummary | null
  /** LIST-max volume (across ALL months, not this slice) for the hairline
   *  emphasis bar; omit (home) to render rows without it. */
  maxVolumeKg?: number
}) {
  const t = useTranslations('HistoryList')
  const tFormat = useTranslations('Format')
  const locale = useLocale()
  return (
    <DividerList>
      {workouts.map((w) => (
        // gap-1 gives the Repeat link's expanded hit inset dead space
        // to land in — without it the inset overlaps the row link.
        <li key={w.id} className="flex items-center gap-1">
          <Link
            // Completed only in this list, so every row goes to its summary.
            href={`/workout/${w.id}`}
            className="flex min-w-0 flex-1 items-center gap-4 py-3.5 transition-colors active:bg-muted/60"
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
              <span className="block truncate font-medium">{w.name ?? t('untitledWorkout')}</span>
              <span className="mt-0.5 block truncate text-sm text-muted-foreground tnum">
                {[
                  renderMessage(tFormat, formatWorkoutDuration(w.startedAt, w.completedAt)),
                  t('setCount', { count: w.setCount }),
                  w.volumeKg > 0 ? formatVolume(w.volumeKg, unit, locale) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {/* Quiet hierarchy, not decoration: session size relative to
                  the list max, muted ink only (volt stays with actions and
                  achievements). The number itself is in the meta line above —
                  the bar is emphasis, so it hides from readers. */}
              {maxVolumeKg !== undefined && maxVolumeKg > 0 && (
                <span
                  aria-hidden="true"
                  className="mt-1.5 block h-0.5 w-full overflow-hidden rounded-full bg-muted"
                >
                  <span
                    className="block h-full rounded-full bg-muted-foreground/50"
                    style={{ width: `${rowEmphasisPct(w.volumeKg, maxVolumeKg)}%` }}
                  />
                </span>
              )}
            </span>
            <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          </Link>
          {/* Repeat starts a NEW session seeded from this one — so it
              goes through the same guard as the other start CTAs. */}
          <GuardedStartLink
            href={`/workout/new?from=${w.id}`}
            session={guardSession}
            aria-label={t('repeatLabel', { name: w.name ?? t('untitledWorkout') })}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
              // Invisible inset lifts the 36px visual button toward the
              // 44px HIG target without growing the row.
              'relative shrink-0 text-muted-foreground before:absolute before:-inset-1',
            )}
          >
            <RotateCcw aria-hidden="true" className="size-5" />
          </GuardedStartLink>
        </li>
      ))}
    </DividerList>
  )
}
