import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getExerciseStats, getExerciseSessions } from '@/db/exercise-stats'
import { activeStrengthGoalForExercise } from '@/db/goals'
import { getWeightUnit } from '@/db/preferences'
import { formatE1RM, formatLoggedSet, formatWorkoutDate } from '@/lib/format'
import { kgToDisplay } from '@/lib/units'
import { MAX_RELIABLE_REPS } from '@/lib/one-rep-max'
import { TrendChart } from '@/components/charts/trend-chart'
import { StatTile, type StatDelta } from '@/components/stat-tile'
import { listCustomExercises } from '@/db/custom-exercises'
import { CustomExerciseEditor } from '../../custom-exercise-editor'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { ShareCardButton } from '@/components/share-card-button'
import { buttonVariants } from '@/components/ui/button'
import { EmptyWords } from '@/components/ui/empty-words'
import { cn } from '@/lib/utils'
import { parseExerciseRef } from '../../exercise-ref'
import {
  buildTrendChartPoints,
  formatStandingTime,
  prWorkoutIds,
  recentE1rmDelta,
  sessionSummary,
} from './detail-view'

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

  const [stats, sessions, unit, strengthGoal] = await Promise.all([
    getExerciseStats(userId, ref.source, ref.wgerExerciseId),
    getExerciseSessions(userId, ref.source, ref.wgerExerciseId, {
      limit: HISTORY_PAGE,
      offset: (page - 1) * HISTORY_PAGE,
    }),
    getWeightUnit(userId),
    // Active strength goal for THIS exercise → the trend gains a target line.
    activeStrengthGoalForExercise(userId, ref.source, ref.wgerExerciseId),
  ])
  if (!stats) notFound()
  const goalTargetKg =
    strengthGoal !== null && 'e1rmKg' in strengthGoal.target ? strengthGoal.target.e1rmKg : null

  // A custom exercise's definition is the user's to edit — fetch it only for
  // custom refs (the list is tiny; a dedicated get can come with real scale).
  const customDef =
    ref.source === 'custom'
      ? ((await listCustomExercises(userId)).find((c) => c.id === ref.wgerExerciseId) ?? null)
      : null

  const { records, trend } = stats
  const hasLoadRecords = records.bestE1rm !== null || records.heaviestLoadKg !== null
  const now = new Date()
  // Record-setting sessions (running-max advances) mark both the chart's volt
  // dots and the history's PR chips — one derivation, two surfaces agreeing.
  const prIds = prWorkoutIds(trend)
  // Chart points built server-side: epoch x (layoffs read as gaps), dates
  // pre-formatted, kg → display unit.
  const trendPoints = buildTrendChartPoints(trend, unit, prIds)
  // Progress context for the headline record: best-of-last-3 sessions vs the
  // best before them; short histories fall back to the vs-first story.
  const delta = recentE1rmDelta(trend, now)
  const e1rmDelta: StatDelta | undefined =
    delta !== null
      ? {
          text:
            `+${kgToDisplay(delta.gainKg, unit)} ${unit} ` +
            (delta.basis === 'first'
              ? 'vs first session'
              : delta.withinMonth
                ? 'this month'
                : 'vs earlier sessions'),
          tone: 'positive',
        }
      : undefined
  /** "· held N months" caption suffix, or '' while a record is still news. */
  const standing = (since: Date): string => {
    const held = formatStandingTime(since, now)
    return held !== null ? ` · ${held}` : ''
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={stats.exercise.name}
        leading={
          // backHref doubles as fallback: the logger's stats sheet links here
          // with ?from=<logger path> so a cold entry still returns to the
          // session; a warm entry pops there anyway.
          <BackLink fallback={backHref} />
        }
        trailing={
          // Share the strength story: trend card once there's a line to show,
          // PR card otherwise; no e1RM record → nothing to share.
          records.bestE1rm !== null ? (
            <ShareCardButton
              cardUrl={
                trend.length >= 2
                  ? `/api/cards/trend/${ref.source}/${ref.wgerExerciseId}`
                  : `/api/cards/pr/${ref.source}/${ref.wgerExerciseId}`
              }
              shareTitle={`${stats.exercise.name} ${trend.length >= 2 ? 'progress' : 'PR'}`}
              className="-mr-2"
            />
          ) : undefined
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
                // De-carded: the headline record leads bare on a muted
                // hairline (revisit surface — no volt hairlines here per the
                // #163 precedent; the delta TEXT already carries the volt).
                <div className="col-span-2 border-b border-b-border/60 pb-4 motion-safe:animate-rise-in">
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
                      formatWorkoutDate(records.bestE1rm.performedAt) +
                      standing(records.bestE1rm.performedAt)}
                  </dd>
                </div>
              )}
              {records.heaviestLoadKg && (
                <StatTile
                  label="Heaviest load"
                  value={String(kgToDisplay(records.heaviestLoadKg.weightKg, unit))}
                  unit={unit}
                  caption={`×${records.heaviestLoadKg.reps} · ${formatWorkoutDate(records.heaviestLoadKg.performedAt)}${standing(records.heaviestLoadKg.performedAt)}`}
                />
              )}
              {records.mostReps && (
                <StatTile
                  label="Most reps"
                  value={String(records.mostReps.reps)}
                  caption={`${formatWorkoutDate(records.mostReps.performedAt)}${standing(records.mostReps.performedAt)}`}
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
                  caption={`${formatWorkoutDate(records.bestSessionVolumeKg.performedAt)}${standing(records.bestSessionVolumeKg.performedAt)}`}
                />
              )}
            </dl>
          ) : (
            <p className="mt-2 border-b border-b-border/60 px-1 py-8 text-center text-sm text-muted-foreground">
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
              {goalTargetKg !== null && ` · target ${kgToDisplay(goalTargetKg, unit)} ${unit}`}
            </h2>
            {/* De-carded: the chart sits between its header and a muted
                hairline — the divider does the framing the shell used to. */}
            <div className="mt-3 border-b border-b-border/60 pb-4">
              <TrendChart
                points={trendPoints}
                unit={unit}
                valueLabel="Est. 1RM"
                ariaLabel={`Estimated 1RM across ${trend.length} sessions, currently ${formatE1RM(trend[trend.length - 1].e1rm, unit)}`}
                {...(goalTargetKg !== null
                  ? { targetValue: kgToDisplay(goalTargetKg, unit), targetLabel: 'Target' }
                  : {})}
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
            <EmptyWords className="mt-2">
              {page > 1 ? 'No older sessions.' : 'No sessions yet.'}
            </EmptyWords>
          ) : (
            <ul className="mt-2">
              {sessions.map((session) => {
                // Collapsed to one line per session — date · best set ·
                // e1RM · set count; the set wall is one tap away on the
                // workout page. Same best-set picker as the logger's stats
                // sheet, so the two surfaces can never disagree.
                const { best, setCount } = sessionSummary(session.sets, stats.exercise.loggingType)
                const bestSet = best !== null ? session.sets[best.index] : null
                // Volt is reserved for record-setting sessions — an ordinary
                // session best is context, not achievement.
                const isPr =
                  best !== null && best.e1rmKg !== null && prIds.has(session.workoutId)
                return (
                  <li key={session.workoutId}>
                    <Link
                      href={`/workout/${session.workoutId}`}
                      // Divider row (Things-3 shape): muted hairline, no
                      // shell — PR sessions are marked by the volt TEXT chip
                      // alone, never a volt hairline (#163 precedent).
                      className="block border-b border-b-border/60 py-3 transition-colors active:bg-muted/60"
                    >
                      <div className="flex items-baseline gap-3">
                        <span className="shrink-0 text-sm font-semibold">
                          {formatWorkoutDate(session.performedAt)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {session.workoutName}
                        </span>
                        {best !== null && best.e1rmKg !== null && (
                          <span
                            className={cn(
                              'shrink-0 text-xs font-semibold tnum',
                              isPr ? 'text-primary' : 'text-muted-foreground',
                            )}
                          >
                            {isPr && (
                              <>
                                PR<span className="sr-only"> (personal record)</span> ·{' '}
                              </>
                            )}
                            {formatE1RM(best.e1rmKg, unit)} e1RM
                          </span>
                        )}
                      </div>
                      <p className="mt-1 flex items-baseline gap-2 text-sm tnum">
                        {bestSet !== null && (
                          <span className="min-w-0 truncate">
                            {formatLoggedSet(bestSet, unit, stats.exercise.loggingType)}
                          </span>
                        )}
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {setCount} set{setCount === 1 ? '' : 's'}
                        </span>
                      </p>
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
