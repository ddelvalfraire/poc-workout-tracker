import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getExerciseStats, getExerciseSessions } from '@/db/exercise-stats'
import { getWeightUnit } from '@/db/preferences'
import { formatE1RM, formatLoggedSet, formatVolume, formatWorkoutDate } from '@/lib/format'
import { kgToDisplay } from '@/lib/units'
import { MAX_RELIABLE_REPS } from '@/lib/one-rep-max'
import { TrendChart } from '@/components/charts/trend-chart'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { parseExerciseRef } from '../../exercise-ref'

/** Sessions per history page. length === HISTORY_PAGE drives the "Older" link —
 *  at an exact multiple that shows one empty final page; accepted POC trade-off
 *  over a count query per view. */
const HISTORY_PAGE = 10

/**
 * One exercise's all-time story: records, per-session e1RM trend, and the
 * paginated session history — everything the block-scoped program stats can't
 * answer. Read-only server component; page number is URL state. All weights
 * arrive canonical kg and convert only in format helpers.
 */
export default async function ExerciseStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ source: string; id: string }>
  searchParams: Promise<{ page?: string | string[] }>
}) {
  const userId = await requireUserId()
  const [{ source, id }, { page: rawPage }] = await Promise.all([params, searchParams])
  const ref = parseExerciseRef(source, id)
  if (!ref) notFound()

  // Bad ?page= silently reads as page 1 — a mistyped query string shouldn't 404
  // a page that exists; the path params above are the identity and DO 404.
  // Repeated keys arrive as an array (house rule: first one wins).
  const pageParam = Array.isArray(rawPage) ? rawPage[0] : rawPage
  const page =
    /^\d+$/.test(pageParam ?? '') && parseInt(pageParam!, 10) >= 1 ? parseInt(pageParam!, 10) : 1

  const [stats, sessions, unit] = await Promise.all([
    getExerciseStats(userId, ref.source, ref.wgerExerciseId),
    getExerciseSessions(userId, ref.source, ref.wgerExerciseId, {
      limit: HISTORY_PAGE,
      offset: (page - 1) * HISTORY_PAGE,
    }),
    getWeightUnit(userId),
  ])
  if (!stats) notFound()

  const { records, trend } = stats
  const hasLoadRecords = records.bestE1rm !== null || records.heaviestLoadKg !== null
  // Chart points built server-side: dates pre-formatted, kg → display unit.
  const trendPoints = trend.map((p) => ({
    label: formatWorkoutDate(p.performedAt),
    value: kgToDisplay(p.e1rm, unit),
  }))

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={stats.exercise.name}
        leading={
          <Link
            href="/exercises"
            aria-label="Back"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ml-2')}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 space-y-6 px-5 pb-safe pt-6">
        {/* All-time records. reps_weight-only by design — duration work shows
            in history below but claims no records until the cardio feature. */}
        <section aria-label="All-time records">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            All-time records
          </h2>
          {hasLoadRecords || records.mostReps !== null ? (
            <dl className="mt-2 grid grid-cols-2 gap-3">
              {records.bestE1rm && (
                <div className="rounded-2xl border border-border bg-card p-4">
                  <dt className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Best est. 1RM
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tnum">
                    {formatE1RM(records.bestE1rm.e1rm, unit)}
                  </dd>
                  <dd className="mt-0.5 text-xs text-muted-foreground">
                    {records.bestE1rm.reps > MAX_RELIABLE_REPS && 'High-rep est. · '}
                    {formatWorkoutDate(records.bestE1rm.performedAt)}
                  </dd>
                </div>
              )}
              {records.heaviestLoadKg && (
                <div className="rounded-2xl border border-border bg-card p-4">
                  <dt className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Heaviest load
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tnum">
                    {kgToDisplay(records.heaviestLoadKg.weightKg, unit)} {unit}
                  </dd>
                  <dd className="mt-0.5 text-xs text-muted-foreground">
                    ×{records.heaviestLoadKg.reps} ·{' '}
                    {formatWorkoutDate(records.heaviestLoadKg.performedAt)}
                  </dd>
                </div>
              )}
              {records.mostReps && (
                <div className="rounded-2xl border border-border bg-card p-4">
                  <dt className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Most reps
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tnum">{records.mostReps.reps}</dd>
                  <dd className="mt-0.5 text-xs text-muted-foreground">
                    {formatWorkoutDate(records.mostReps.performedAt)}
                  </dd>
                </div>
              )}
              {records.bestSessionVolumeKg && (
                <div className="rounded-2xl border border-border bg-card p-4">
                  <dt className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Best session volume
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tnum">
                    {formatVolume(records.bestSessionVolumeKg.volumeKg, unit)}
                  </dd>
                  <dd className="mt-0.5 text-xs text-muted-foreground">
                    {formatWorkoutDate(records.bestSessionVolumeKg.performedAt)}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="mt-2 rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
              No load records yet — log weight (or set your bodyweight in Settings for bodyweight
              movements) and PRs land here.
            </p>
          )}
        </section>

        {/* Trend — needs at least two points to be a line. */}
        {trendPoints.length >= 2 && (
          <section aria-label="Estimated 1RM trend">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Est. 1RM trend · {trend.length} sessions
            </h2>
            <div className="mt-2 rounded-2xl border border-border bg-card p-4">
              <TrendChart
                points={trendPoints}
                unit={unit}
                valueLabel="Est. 1RM"
                ariaLabel={`Estimated 1RM across ${trend.length} sessions, currently ${formatE1RM(trend[trend.length - 1].e1rm, unit)}`}
              />
            </div>
          </section>
        )}

        {/* Session history — display truth: every set of each completed
            workout, including unchecked and duration rows. */}
        <section aria-label="Session history">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            History
          </h2>
          {sessions.length === 0 ? (
            <p className="mt-2 px-1 py-6 text-center text-sm text-muted-foreground">
              {page > 1 ? 'No older sessions.' : 'No sessions yet.'}
            </p>
          ) : (
            <ul className="mt-2 space-y-3">
              {sessions.map((session) => (
                <li key={session.workoutId}>
                  <Link
                    href={`/workout/${session.workoutId}`}
                    className="block rounded-2xl border border-border bg-card p-4 transition-colors active:bg-muted/60"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold">
                        {formatWorkoutDate(session.performedAt)}
                      </span>
                      {session.workoutName && (
                        <span className="min-w-0 truncate text-xs text-muted-foreground">
                          {session.workoutName}
                        </span>
                      )}
                    </div>
                    <ul className="mt-2 space-y-1">
                      {session.sets.map((set) => (
                        <li
                          key={set.setNumber}
                          className={cn(
                            'flex items-baseline gap-2 text-sm tnum',
                            set.completed
                              ? 'text-foreground'
                              : 'text-muted-foreground line-through',
                          )}
                        >
                          <span className="w-6 shrink-0 text-xs text-muted-foreground">
                            {set.setNumber}
                          </span>
                          {formatLoggedSet(set, unit, stats.exercise.loggingType)}
                        </li>
                      ))}
                    </ul>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* Pagination: the URL is the state. */}
          <div className="mt-3 flex items-center justify-between">
            {page > 1 ? (
              <Link
                href={`?page=${page - 1}`}
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2')}
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
                Newer
              </Link>
            ) : (
              <span />
            )}
            {sessions.length === HISTORY_PAGE && (
              <Link
                href={`?page=${page + 1}`}
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-mr-2')}
              >
                Older
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
