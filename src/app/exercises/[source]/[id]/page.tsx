import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getExerciseStats, getExerciseSessions } from '@/db/exercise-stats'
import { activeStrengthGoalForExercise } from '@/db/goals'
import { getWeightUnit } from '@/db/preferences'
import { formatE1RM, formatLoggedSet, formatWorkoutDate } from '@/lib/format'
import { formatDistanceInput, formatDurationInput } from '@/lib/duration'
import { kgToDisplay } from '@/lib/units'
import { MAX_RELIABLE_REPS } from '@/lib/one-rep-max'
import { TrendChart } from '@/components/charts/trend-chart'
import { StatTile, type StatDelta } from '@/components/stat-tile'
import { listCustomExercises } from '@/db/custom-exercises'
import { getExerciseNote } from '@/db/exercise-notes'
import { listNotes } from '@/db/notes'
import { buildNoteView, groupNotesByThread } from '@/components/notes/note-view'
import { NoteRow } from '@/components/notes/note-row'
import { DividerList } from '@/components/ui/divider-list'
import { CustomExerciseEditor } from '../../custom-exercise-editor'
import { ExerciseNoteSection } from './exercise-note-section'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { ShareCardButton } from '@/components/share-card-button'
import { buttonVariants } from '@/components/ui/button'
import { EmptyWords } from '@/components/ui/empty-words'
import { cn } from '@/lib/utils'
import { parseExerciseRef } from '../../exercise-ref'
import {
  buildTrendChartPoints,
  standingTime,
  prWorkoutIds,
  recentE1rmDelta,
  sessionSummary,
} from './detail-view'
import { getTranslations } from 'next-intl/server'
import { renderMessage } from '@/lib/message'
import { resolveLocale } from '@/i18n/request'

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
  const t = await getTranslations('ExerciseStats')
  const tFormat = await getTranslations('Format')
  const locale = await resolveLocale()
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

  const [stats, sessions, unit, strengthGoal, note, sessionNotes] = await Promise.all([
    getExerciseStats(userId, ref.source, ref.wgerExerciseId),
    getExerciseSessions(userId, ref.source, ref.wgerExerciseId, {
      limit: HISTORY_PAGE,
      offset: (page - 1) * HISTORY_PAGE,
    }),
    getWeightUnit(userId),
    // Active strength goal for THIS exercise → the trend gains a target line.
    activeStrengthGoalForExercise(userId, ref.source, ref.wgerExerciseId),
    // Identity note (seat pins, cues) — the note that follows the exercise.
    getExerciseNote(userId, ref.source, ref.wgerExerciseId),
    // The reverse index: every SESSION note ever anchored to this exercise
    // identity (any instance, any workout — directly or via one of its sets).
    listNotes(userId, { exercise: { source: ref.source, exerciseId: ref.wgerExerciseId } }),
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
  // Cardio trio (duration-mode sets): longest duration leads when there's no
  // e1RM headline (a pure cardio exercise); mixed histories keep the lifting
  // headline and the cardio records join the grid as tiles.
  const longestDuration = records.longestDuration ?? null
  const longestDistance = records.longestDistance ?? null
  const bestPace = records.bestPace ?? null
  const hasCardioRecords = longestDuration !== null || longestDistance !== null
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
          // Three whole messages: the basis is not a phrase appended to a
          // gain, it changes the shape of the sentence.
          text: t(
            delta.basis === 'first'
              ? 'deltaFirst'
              : delta.withinMonth
                ? 'deltaMonth'
                : 'deltaEarlier',
            { gain: kgToDisplay(delta.gainKg, unit), unit },
          ),
          tone: 'positive',
        }
      : undefined
  /** The "held N months" caption segment, or null while a record is news. */
  const standing = (since: Date): string | null => {
    const held = standingTime(since, now)
    return held === null ? null : t(`standing.${held.unit}`, { count: held.count })
  }
  /** Caption segments joined by the app's dot separator — a LIST, so each
   *  piece stays a whole message and order is the only thing composed. */
  const caption = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ')
  // Same rounding + grouping as formatVolume, minus the unit suffix — StatTile
  // renders the unit slot itself. Hoisted out of the markup because the locale
  // tag is an identifier, not copy.
  const bestSessionVolume = records.bestSessionVolumeKg
    ? Math.round(kgToDisplay(records.bestSessionVolumeKg.volumeKg, unit)).toLocaleString('en-US')
    : null
  // Reverse-index rows, session-threaded like the /notes browser. The
  // exercise segment drops from breadcrumbs — this page IS the exercise.
  const noteThreads = groupNotesByThread(
    sessionNotes.map((n) => buildNoteView(n, unit, now, { omitExercise: true })),
  )

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
              shareTitle={
                trend.length >= 2
                  ? t('shareTitleProgress', { name: stats.exercise.name })
                  : t('shareTitlePr', { name: stats.exercise.name })
              }
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

        {/* Identity note: view + edit; the same note the logger's chip
            resurfaces when pinned. */}
        <ExerciseNoteSection
          source={ref.source}
          exerciseId={ref.wgerExerciseId}
          exerciseName={stats.exercise.name}
          note={note ? { body: note.body, pinned: note.pinned } : null}
        />

        {/* All-time records. Lifting records stay reps_weight-only; duration
            work claims the cardio trio (longest duration/distance, best
            pace) instead — the two families never double-claim a set. */}
        <section aria-label={t('records.ariaLabel')}>
          <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('records.title')}
          </h2>
          {hasLoadRecords || records.mostReps !== null || hasCardioRecords ? (
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
                    {t('records.bestE1rmLabel')}
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
                    {caption(
                      records.bestE1rm.reps > MAX_RELIABLE_REPS
                        ? t('records.highRepEstimate')
                        : null,
                      `${kgToDisplay(records.bestE1rm.weightKg, unit)} ${unit} × ${records.bestE1rm.reps}`,
                      formatWorkoutDate(records.bestE1rm.performedAt, locale),
                      standing(records.bestE1rm.performedAt),
                    )}
                  </dd>
                </div>
              )}
              {records.heaviestLoadKg && (
                <StatTile
                  label={t('records.heaviestLoadLabel')}
                  value={String(kgToDisplay(records.heaviestLoadKg.weightKg, unit))}
                  unit={unit}
                  caption={caption(
                    `×${records.heaviestLoadKg.reps}`,
                    formatWorkoutDate(records.heaviestLoadKg.performedAt, locale),
                    standing(records.heaviestLoadKg.performedAt),
                  )}
                />
              )}
              {records.mostReps && (
                <StatTile
                  label={t('records.mostRepsLabel')}
                  value={String(records.mostReps.reps)}
                  caption={caption(
                    formatWorkoutDate(records.mostReps.performedAt, locale),
                    standing(records.mostReps.performedAt),
                  )}
                />
              )}
              {records.bestSessionVolumeKg && (
                <StatTile
                  label={t('records.bestVolumeLabel')}
                  value={bestSessionVolume ?? ''}
                  unit={unit}
                  caption={caption(
                    formatWorkoutDate(records.bestSessionVolumeKg.performedAt, locale),
                    standing(records.bestSessionVolumeKg.performedAt),
                  )}
                />
              )}
              {/* Cardio trio. With no e1RM headline the longest duration
                  takes the poster slot (a pure cardio exercise's page leads
                  with ITS number); mixed histories keep it as a tile. */}
              {longestDuration && records.bestE1rm === null && (
                <div className="col-span-2 border-b border-b-border/60 pb-4 motion-safe:animate-rise-in">
                  <dt className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {t('records.longestDurationLabel')}
                  </dt>
                  <dd className="mt-2 font-display text-6xl leading-none tracking-tight tnum">
                    {formatDurationInput(longestDuration.durationSec)}
                  </dd>
                  <dd className="mt-1 text-xs text-muted-foreground tnum">
                    {caption(
                      formatWorkoutDate(longestDuration.performedAt, locale),
                      standing(longestDuration.performedAt),
                    )}
                  </dd>
                </div>
              )}
              {longestDuration && records.bestE1rm !== null && (
                <StatTile
                  label={t('records.longestDurationLabel')}
                  value={formatDurationInput(longestDuration.durationSec)}
                  caption={caption(
                    formatWorkoutDate(longestDuration.performedAt, locale),
                    standing(longestDuration.performedAt),
                  )}
                />
              )}
              {longestDistance && (
                <StatTile
                  label={t('records.longestDistanceLabel')}
                  value={formatDistanceInput(longestDistance.distanceM)}
                  unit={t('records.distanceUnit')}
                  caption={caption(
                    formatWorkoutDate(longestDistance.performedAt, locale),
                    standing(longestDistance.performedAt),
                  )}
                />
              )}
              {bestPace && (
                <StatTile
                  label={t('records.bestPaceLabel')}
                  value={formatDurationInput(Math.round(bestPace.secPerKm))}
                  unit={t('records.paceUnit')}
                  caption={caption(
                    formatWorkoutDate(bestPace.performedAt, locale),
                    standing(bestPace.performedAt),
                  )}
                />
              )}
            </dl>
          ) : (
            <p className="mt-2 border-b border-b-border/60 px-1 py-8 text-center text-sm text-muted-foreground">
              {t('records.empty')}
            </p>
          )}
        </section>

        {/* Trend — needs at least two points to be a line. */}
        {trendPoints.length >= 2 && (
          <section aria-label={t('trend.ariaLabel')}>
            <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {caption(
                t('trend.title', { sessions: trend.length }),
                goalTargetKg !== null
                  ? t('trend.target', { value: kgToDisplay(goalTargetKg, unit), unit })
                  : null,
              )}
            </h2>
            {/* De-carded: the chart sits between its header and a muted
                hairline — the divider does the framing the shell used to. */}
            <div className="mt-3 border-b border-b-border/60 pb-4">
              <TrendChart
                points={trendPoints}
                unit={unit}
                valueLabel={t('trend.valueLabel')}
                ariaLabel={t('trend.chartAriaLabel', {
                  sessions: trend.length,
                  current: formatE1RM(trend[trend.length - 1].e1rm, unit, locale),
                })}
                {...(goalTargetKg !== null
                  ? {
                      targetValue: kgToDisplay(goalTargetKg, unit),
                      targetLabel: t('trend.targetLabel'),
                    }
                  : {})}
              />
            </div>
          </section>
        )}

        {/* Session history — display truth: every set of each completed
            workout, including unchecked and duration rows. */}
        <section aria-label={t('history.ariaLabel')}>
          <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('history.title')}
          </h2>
          {sessions.length === 0 ? (
            <EmptyWords className="mt-2">
              {page > 1 ? t('history.emptyOlder') : t('history.empty')}
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
                          {formatWorkoutDate(session.performedAt, locale)}
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
                                {t.rich('history.prChip', {
                                  sr: (chunks) => <span className="sr-only">{chunks}</span>,
                                })}
                                {' · '}
                              </>
                            )}
                            {t('history.e1rmChip', {
                              value: formatE1RM(best.e1rmKg, unit, locale),
                            })}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 flex items-baseline gap-2 text-sm tnum">
                        {bestSet !== null && (
                          <span className="min-w-0 truncate">
                            {renderMessage(
                              tFormat,
                              formatLoggedSet(bestSet, unit, stats.exercise.loggingType, locale),
                            )}
                          </span>
                        )}
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t('history.setCount', { count: setCount })}
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
                {t('history.newer')}
              </Link>
            ) : (
              <span />
            )}
            {sessions.length === HISTORY_PAGE && (
              <Link
                href={withFrom(page + 1)}
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-mr-2')}
              >
                {t('history.older')}
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
            )}
          </div>
        </section>

        {/* The reverse index: every note ever anchored here (any instance,
            any workout), threaded by session like the /notes browser. An
            exercise with no notes shows no section — the identity note block
            above already owns authoring. */}
        {noteThreads.length > 0 && (
          <section aria-label={t('notes.ariaLabel')}>
            <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t('notes.title')}
            </h2>
            {noteThreads.map((thread) => (
              <div key={thread.key}>
                <div className="flex items-baseline justify-between gap-3 px-1 pb-1 pt-3">
                  <h3 className="min-w-0 truncate text-xs font-semibold text-muted-foreground">
                    {thread.title}
                  </h3>
                  <span className="shrink-0 text-xs text-muted-foreground tnum">
                    {thread.dateLabel}
                  </span>
                </div>
                <DividerList>
                  {thread.notes.map((note) => (
                    <NoteRow key={note.id} note={note} />
                  ))}
                </DividerList>
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  )
}
