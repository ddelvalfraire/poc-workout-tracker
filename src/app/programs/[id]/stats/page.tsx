import { notFound } from 'next/navigation'
import { requireUserId } from '@/lib/auth'
import { getProgramStats, type ProgramExercisePR } from '@/db/program-stats'
import { getWeightUnit } from '@/db/preferences'
import { formatSet, formatVolume, formatE1RM } from '@/lib/format'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { BlockSegment } from '@/components/block-map'
import { cn } from '@/lib/utils'
import {
  e1rmSparkline,
  visibleWeeks,
  volumeBarWidthPct,
  hasAnyTraining,
  prDeltaKg,
  programVerdict,
  isHighRepEstimate,
  topPRs,
} from './stats-view'

/**
 * The one-screen block check-in: week position + adherence, per-week volume,
 * and per-exercise progression — everything scoped to THIS program's sessions
 * (provenance-filtered by the data layer). Read-only server component, no
 * client islands; the program page owns week browsing, this is the whole-block
 * lens. All weights arrive canonical kg and convert only in format helpers.
 */
export default async function ProgramStatsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const userId = await requireUserId()
  const { id } = await params
  const [stats, unit] = await Promise.all([getProgramStats(userId, id), getWeightUnit(userId)])
  if (!stats) notFound()

  const status = stats.program.status
  const trained = hasAnyTraining(stats.weeks)
  const weeks = visibleWeeks(stats.weeks, stats.currentWeek)
  const maxTonnage = weeks.reduce((max, w) => Math.max(max, w.tonnageKg), 0)
  // Only exercises with a load-scorable week claim a PR row — rep-fallback
  // lifts have no e1RM to compare, and an empty PRs table teaches nothing.
  // Type predicate so the render below needs no non-null assertion.
  const prExercises = stats.exercises.filter(
    (e): e is (typeof stats.exercises)[number] & { pr: ProgramExercisePR } => e.pr !== null,
  )
  // Real gains lead the PR section (celebration first, sorted by delta);
  // single-week baselines follow in appearance order — context, not wins.
  const gains = topPRs(stats.exercises, stats.exercises.length)
  const gainKeys = new Set(gains.map((e) => `${e.source}:${e.wgerExerciseId}`))
  const prRows = [
    ...gains,
    ...prExercises.filter((e) => !gainKeys.has(`${e.source}:${e.wgerExerciseId}`)),
  ]
  const verdict = programVerdict(stats.weeks, stats.currentWeek, gains.length)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Program Stats"
        leading={
          <BackLink fallback={`/programs/${stats.program.id}`} />
        }
        trailing={
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide',
              status === 'active'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {status}
          </span>
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {/* Verdict hero: the block's status in words (stats-view copy table),
            then position. Program name stays quiet — the header already
            carries the surface's identity. */}
        <section aria-label="Block verdict" className="mt-6">
          <p className="text-sm text-muted-foreground">{stats.program.name}</p>
          <h2 className="mt-1 font-display text-4xl uppercase leading-none tracking-wide">
            {verdict.headline}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground tnum">{verdict.context}</p>
          <p className="mt-0.5 text-sm text-muted-foreground tnum">
            Week {stats.currentWeek} of {stats.program.mesocycleWeeks}
          </p>
        </section>

        {!trained ? (
          // Whole-page teach state, not a stack of zeroed sections.
          <p className="mt-6 text-sm text-muted-foreground">
            No sessions from this program yet — start a day and stats build themselves.
          </p>
        ) : (
          <>
            {prRows.length > 0 && (
              <section aria-label="PRs" className="mt-8">
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  PRs
                </h3>
                <ul className="mt-2 space-y-2.5">
                  {prRows.map((exercise) => {
                    const pr = exercise.pr
                    const delta = prDeltaKg(pr)
                    const isSingleWeek = pr.baseline.week === pr.best.week
                    // Either endpoint estimated past the reliable rep range
                    // gets flagged — the flag names the shakier rep count.
                    const highRepPoint = isHighRepEstimate(pr.best)
                      ? pr.best
                      : isHighRepEstimate(pr.baseline)
                        ? pr.baseline
                        : null
                    return (
                      <li key={`${exercise.source}:${exercise.wgerExerciseId}`}>
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="min-w-0 truncate text-sm font-medium">{exercise.name}</p>
                          <p className="shrink-0 text-sm tnum">
                            {isSingleWeek ? (
                              <>
                                <span aria-hidden="true" className="text-muted-foreground">
                                  ~
                                </span>
                                {formatE1RM(pr.baseline.e1rm, unit)}
                                <span className="text-muted-foreground"> · wk {pr.baseline.week}</span>
                              </>
                            ) : (
                              <>
                                <span aria-hidden="true" className="text-muted-foreground">
                                  ~
                                </span>
                                {formatE1RM(pr.baseline.e1rm, unit)}
                                <span aria-hidden="true" className="text-muted-foreground">
                                  {' → '}
                                </span>
                                <span className="sr-only"> to </span>
                                <span aria-hidden="true" className="text-muted-foreground">
                                  ~
                                </span>
                                {formatE1RM(pr.best.e1rm, unit)}
                              </>
                            )}
                          </p>
                        </div>
                        {/* The verdict line: gain in the display unit. Volt is
                            earned here — a PR is the page's one celebration,
                            and it now leads the page at display scale. */}
                        {!isSingleWeek && delta > 0 && (
                          <p className="mt-0.5 text-right font-display text-2xl uppercase leading-none tracking-wide text-primary tnum">
                            +{formatE1RM(delta, unit)}
                          </p>
                        )}
                        {highRepPoint && (
                          <p className="mt-0.5 text-right text-xs text-muted-foreground tnum">
                            est. from {highRepPoint.reps} reps
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            {/* One row per week: day-fill + volume bar + tonnage — adherence
                and volume merged into a single glance. Deload weeks render
                hollow with a DL tag (a planned easy week must never read as
                slacking); the current week is ringed. */}
            <section aria-label="Weeks" className="mt-8">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Weeks
              </h3>
              <ul className="mt-2 space-y-1">
                {weeks.map((w) => {
                  const unfinished = w.daysStarted - w.daysCompleted
                  const isDeload = w.week === stats.program.deloadWeek
                  const isCurrent = w.week === stats.currentWeek
                  return (
                    <li
                      key={w.week}
                      className={cn(
                        '-mx-2 rounded-xl border border-transparent px-2 py-1.5',
                        // "You are here" ring — matches the program page's
                        // anchored current-week voice.
                        isCurrent && 'border-primary/40',
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            'w-11 shrink-0 text-[11px] font-semibold uppercase tracking-widest tnum',
                            isCurrent ? 'text-primary' : 'text-muted-foreground',
                          )}
                        >
                          Wk {w.week}
                        </span>
                        {/* Day-fill via the shared block-map segment (same
                            geometry as the programs list hero and the detail
                            week strip); the numbers stay real text. */}
                        {w.plannedDays > 0 && (
                          <BlockSegment
                            dayCountDone={w.daysCompleted}
                            dayCountTotal={w.plannedDays}
                            isDeload={isDeload}
                            className="w-14 shrink-0"
                          />
                        )}
                        <span className="text-sm tnum">
                          {w.daysCompleted}/{w.plannedDays}
                        </span>
                        {/* Started counts, flagged visually — never silently
                            excluded. */}
                        {unfinished > 0 && (
                          <span className="text-sm text-muted-foreground tnum">
                            +{unfinished} unfinished
                          </span>
                        )}
                        {isDeload && (
                          <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                            DL
                          </span>
                        )}
                        {/* Zero-tonnage weeks with sets are real training
                            (maxed stack machines log null weight) — sets
                            always show. */}
                        <span className="ml-auto shrink-0 text-sm text-muted-foreground tnum">
                          {w.tonnageKg > 0 && `${formatVolume(w.tonnageKg, unit)} · `}
                          {w.completedSets} set{w.completedSets === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div
                        className={cn(
                          'mt-1.5 h-2 overflow-hidden rounded-full',
                          isDeload ? 'border border-border bg-transparent' : 'bg-muted',
                        )}
                      >
                        <div
                          className={cn(
                            'h-full rounded-full',
                            isDeload ? 'border border-primary/60 bg-transparent' : 'bg-primary',
                          )}
                          style={{ width: `${volumeBarWidthPct(w.tonnageKg, maxTonnage)}%` }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>

            {stats.exercises.length > 0 && (
              <section aria-label="Progression" className="mt-8">
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Progression
                </h3>
                <div className="mt-2 space-y-4">
                  {stats.exercises.map((exercise) => {
                    // Server-rendered inline SVG, no chart lib: weeks on x
                    // (time-true), e1RM on y, volt dots on new running maxes.
                    // Decorative — the numeric rows below are the detail.
                    const spark = e1rmSparkline(exercise.weeks, 120, 32)
                    return (
                    <div key={`${exercise.source}:${exercise.wgerExerciseId}`}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-medium">{exercise.name}</p>
                        {spark && (
                          <svg
                            viewBox="0 0 120 32"
                            aria-hidden="true"
                            className="h-8 w-[120px] shrink-0 text-muted-foreground"
                          >
                            <path
                              d={spark.path}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.5}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            {spark.points
                              .filter((p) => p.isRunningMax)
                              .map((p) => (
                                <circle
                                  key={p.week}
                                  cx={p.x}
                                  cy={p.y}
                                  r={2.5}
                                  className="fill-primary"
                                />
                              ))}
                          </svg>
                        )}
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {exercise.weeks.map((point) => (
                          <li key={point.week} className="flex items-baseline gap-3 text-sm">
                            <span className="w-11 shrink-0 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground tnum">
                              Wk {point.week}
                            </span>
                            {point.best?.kind === 'e1rm' ? (
                              <>
                                <span className="tnum">
                                  {/* ScoredBestSet.weightKg is the EFFECTIVE
                                      load — for BW types that's bodyweight ±
                                      assist, which must not read as a barbell
                                      line; the rep count is the honest fact. */}
                                  {exercise.loggingType === 'weight_reps'
                                    ? formatSet(point.best.reps, point.best.weightKg, unit)
                                    : `${point.best.reps} reps`}
                                </span>
                                <span className="text-muted-foreground tnum">
                                  <span aria-hidden="true">~</span>
                                  {formatE1RM(point.best.e1rm, unit)}
                                </span>
                              </>
                            ) : point.best ? (
                              // Rep fallback: nothing load-scorable (maxed
                              // stack, BW lift without a stored bodyweight) —
                              // the best effort still gets its readout.
                              <span className="tnum">{point.best.reps} reps</span>
                            ) : (
                              // Null best ≠ nothing happened: a week of
                              // unloggable sets still shows the effort.
                              <span className="text-muted-foreground tnum">
                                {point.completedSets} set{point.completedSets === 1 ? '' : 's'}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                    )
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}
