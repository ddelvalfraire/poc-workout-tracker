import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getExerciseStats, getExerciseSessions } from '@/db/exercise-stats'
import { getWeightUnit } from '@/db/preferences'
import { formatE1RM, formatLoggedSet, formatWorkoutDate } from '@/lib/format'
import { kgToDisplay } from '@/lib/units'
import { MAX_RELIABLE_REPS } from '@/lib/one-rep-max'
import { sessionBestSet } from '@/lib/session-best-set'
import { TrendChart } from '@/components/charts/trend-chart'
import { StatTile, type StatDelta } from '@/components/stat-tile'
import { listCustomExercises } from '@/db/custom-exercises'
import { CustomExerciseEditor } from '../../custom-exercise-editor'
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
  searchParams: Promise<{ page?: string | string[]; from?: string | string[] }>
}) {
  const userId = await requireUserId()
  const [{ source, id }, { page: rawPage, from: rawFrom }] = await Promise.all([
    params,
    searchParams,
  ])
  const ref = parseExerciseRef(source, id)
  if (!ref) notFound()

  // Return address for the back arrow: the live logger's stats sheet links
  // here with ?from=<its path> so Back resumes the session instead of dumping
  // the lifter on the exercises list. Whitelisted to in-app workout paths —
  // an arbitrary query value must never become a navigation target.
  const fromParam = Array.isArray(rawFrom) ? rawFrom[0] : rawFrom
  const backHref =
    fromParam !== undefined && /^\/workout\/[\w-]+(\/edit)?$/.test(fromParam)
      ? fromParam
      : '/exercises'
  const withFrom = (page: number) =>
    `?page=${page}${backHref !== '/exercises' ? `&from=${encodeURIComponent(backHref)}` : ''}`

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

  // A custom exercise's definition is the user's to edit — fetch it only for
  // custom refs (the list is tiny; a dedicated get can come with real scale).
  const customDef =
    ref.source === 'custom'
      ? ((await listCustomExercises(userId)).find((c) => c.id === ref.wgerExerciseId) ?? null)
      : null

  const { records, trend } = stats
  const hasLoadRecords = records.bestE1rm !== null || records.heaviestLoadKg !== null
  // Chart points built server-side: dates pre-formatted, kg → display unit.
  const trendPoints = trend.map((p) => ({
    label: formatWorkoutDate(p.performedAt),
    value: kgToDisplay(p.e1rm, unit),
  }))
  // Progress context for the headline record: best vs the FIRST e1rm-scorable
  // session. Shown only when there are ≥2 points and a real gain — a flat or
  // single-session history has no story to tell.
  const e1rmGainKg =
    records.bestE1rm && trend.length >= 2 ? records.bestE1rm.e1rm - trend[0].e1rm : 0
  const e1rmDelta: StatDelta | undefined =
    e1rmGainKg > 0
      ? { text: `+${kgToDisplay(e1rmGainKg, unit)} ${unit} vs first session`, tone: 'positive' }
      : undefined

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={stats.exercise.name}
        leading={
          <Link
            href={backHref}
            aria-label="Back"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ml-2')}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 space-y-6 px-5 pb-safe pt-6">
        {customDef && (
          <CustomExerciseEditor
            id={customDef.id}
            name={customDef.name}
            category={customDef.category}
            muscles={customDef.muscles ?? []}
            musclesSecondary={customDef.musclesSecondary ?? []}
          />
        )}

        {/* All-time records. reps_weight-only by design — duration work shows
            in history below but claims no records until the cardio feature. */}
        <section aria-label="All-time records">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            All-time records
          </h2>
          {hasLoadRecords || records.mostReps !== null ? (
            <dl className="mt-2 grid grid-cols-2 gap-3">
              {/* The headline record leads full-width in poster type — the
                  grid below is context, this is the number the page is for.
                  Proportional figures on the value (tnum is for columns). */}
              {records.bestE1rm && (
                <div className="col-span-2 rounded-2xl border border-border bg-card p-5 motion-safe:animate-rise-in">
                  <dt className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Best est. 1RM
                  </dt>
                  <dd className="mt-2 font-display text-6xl leading-none tracking-tight">
                    {kgToDisplay(records.bestE1rm.e1rm, unit)}
                    <span className="ml-2 text-xl text-muted-foreground">{unit}</span>
                  </dd>
                  {e1rmDelta && (
                    <dd
                      className={cn(
                        'mt-2 text-sm font-medium',
                        e1rmDelta.tone === 'positive' ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      {e1rmDelta.text}
                    </dd>
                  )}
                  <dd className="mt-1 text-xs text-muted-foreground tnum">
                    {(records.bestE1rm.reps > MAX_RELIABLE_REPS ? 'High-rep est. · ' : '') +
                      `${kgToDisplay(records.bestE1rm.weightKg, unit)} ${unit} × ${records.bestE1rm.reps} · ` +
                      formatWorkoutDate(records.bestE1rm.performedAt)}
                  </dd>
                </div>
              )}
              {records.heaviestLoadKg && (
                <StatTile
                  label="Heaviest load"
                  value={String(kgToDisplay(records.heaviestLoadKg.weightKg, unit))}
                  unit={unit}
                  caption={`×${records.heaviestLoadKg.reps} · ${formatWorkoutDate(records.heaviestLoadKg.performedAt)}`}
                />
              )}
              {records.mostReps && (
                <StatTile
                  label="Most reps"
                  value={String(records.mostReps.reps)}
                  caption={formatWorkoutDate(records.mostReps.performedAt)}
                />
              )}
              {records.bestSessionVolumeKg && (
                <StatTile
                  label="Best session volume"
                  // Same rounding + grouping as formatVolume, minus the unit
                  // suffix — StatTile renders the unit slot itself.
                  value={Math.round(
                    kgToDisplay(records.bestSessionVolumeKg.volumeKg, unit),
                  ).toLocaleString('en-US')}
                  unit={unit}
                  caption={formatWorkoutDate(records.bestSessionVolumeKg.performedAt)}
                />
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
              {sessions.map((session) => {
                // Same picker as the logger's stats sheet — the two surfaces
                // must agree on which set was the session's best.
                const best = sessionBestSet(session.sets, stats.exercise.loggingType)
                return (
                  <li key={session.workoutId}>
                    <Link
                      href={`/workout/${session.workoutId}`}
                      className="block rounded-2xl border border-border bg-card p-4 transition-colors active:bg-muted/60"
                    >
                      <div className="flex items-baseline gap-3">
                        <span className="shrink-0 text-sm font-semibold">
                          {formatWorkoutDate(session.performedAt)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {session.workoutName}
                        </span>
                        {best !== null && best.e1rmKg !== null && (
                          <span className="shrink-0 text-xs font-semibold text-primary tnum">
                            {formatE1RM(best.e1rmKg, unit)} e1RM
                          </span>
                        )}
                      </div>
                      <ul className="mt-2 space-y-1">
                        {session.sets.map((set, index) => (
                          <li
                            key={set.setNumber}
                            className={cn(
                              'flex items-baseline gap-2 text-sm tnum',
                              set.completed
                                ? 'text-foreground'
                                : 'text-muted-foreground line-through',
                              index === best?.index && 'font-semibold',
                            )}
                          >
                            <span className="w-6 shrink-0 text-xs font-normal text-muted-foreground">
                              {set.setNumber}
                            </span>
                            {formatLoggedSet(set, unit, stats.exercise.loggingType)}
                            {index === best?.index && (
                              <>
                                <span
                                  aria-hidden="true"
                                  className="size-1.5 shrink-0 self-center rounded-full bg-primary"
                                />
                                <span className="sr-only">Best set</span>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}

          {/* Pagination: the URL is the state. */}
          <div className="mt-3 flex items-center justify-between">
            {page > 1 ? (
              <Link
                href={withFrom(page - 1)}
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
                href={withFrom(page + 1)}
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
