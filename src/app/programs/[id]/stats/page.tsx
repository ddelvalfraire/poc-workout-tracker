import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getProgramStats, type ProgramExercisePR } from '@/db/program-stats'
import { getWeightUnit } from '@/db/preferences'
import { formatSet, formatVolume, formatE1RM } from '@/lib/format'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  visibleWeeks,
  volumeBarWidthPct,
  hasAnyTraining,
  prDeltaKg,
  isHighRepEstimate,
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
  // Weeks are 1-based in a 0-based array: previous week = index currentWeek - 2.
  // "Previous" per nextProgramWeek's position math, NOT guaranteed complete —
  // the row shows its own daysCompleted/planned, so a partial week reads honestly.
  const prevWeek = stats.currentWeek >= 2 ? stats.weeks[stats.currentWeek - 2] : null

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Program Stats"
        leading={
          <Link
            href={`/programs/${stats.program.id}`}
            aria-label="Back"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ml-2')}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </Link>
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
        {/* Hero: where the block stands. Program name stays quiet — the
            header already carries the surface's identity. */}
        <section aria-label="Block position" className="mt-6">
          <p className="text-sm text-muted-foreground">{stats.program.name}</p>
          <h2 className="mt-1 font-display text-xl uppercase leading-none tracking-wide tnum">
            Week {stats.currentWeek} of {stats.program.mesocycleWeeks}
          </h2>
          {trained && prevWeek && (
            <p className="mt-1.5 text-sm text-muted-foreground tnum">
              {prevWeek.daysCompleted}/{prevWeek.plannedDays} days · wk {stats.currentWeek - 1}
            </p>
          )}
        </section>

        {!trained ? (
          // Whole-page teach state, not a stack of zeroed sections.
          <p className="mt-6 text-sm text-muted-foreground">
            No sessions from this program yet — start a day and stats build themselves.
          </p>
        ) : (
          <>
            <section aria-label="Adherence" className="mt-8">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Adherence
              </h3>
              <ul className="mt-2 space-y-1.5">
                {weeks.map((w) => {
                  const unfinished = w.daysStarted - w.daysCompleted
                  return (
                    <li key={w.week} className="flex items-baseline gap-3 text-sm">
                      <span
                        className={cn(
                          'w-11 shrink-0 text-[11px] font-semibold uppercase tracking-widest tnum',
                          // "You are here" accent — matches the program page's
                          // anchored current-week voice.
                          w.week === stats.currentWeek ? 'text-primary' : 'text-muted-foreground',
                        )}
                      >
                        Wk {w.week}
                      </span>
                      <span className="tnum">
                        {w.daysCompleted}/{w.plannedDays}
                      </span>
                      {/* Started counts, flagged visually — never silently excluded. */}
                      {unfinished > 0 && (
                        <span className="text-muted-foreground tnum">
                          +{unfinished} unfinished
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>

            <section aria-label="Weekly volume" className="mt-8">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Volume
              </h3>
              <ul className="mt-2 space-y-2.5">
                {weeks.map((w) => (
                  <li key={w.week} className="flex items-center gap-3">
                    <span className="w-11 shrink-0 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground tnum">
                      Wk {w.week}
                    </span>
                    <div className="h-2 min-w-0 flex-1 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${volumeBarWidthPct(w.tonnageKg, maxTonnage)}%` }}
                      />
                    </div>
                    {/* Zero-tonnage weeks with sets are real training (maxed
                        stack machines log null weight) — sets always show. */}
                    <span className="shrink-0 text-sm text-muted-foreground tnum">
                      {w.tonnageKg > 0 && `${formatVolume(w.tonnageKg, unit)} · `}
                      {w.completedSets} set{w.completedSets === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {prExercises.length > 0 && (
              <section aria-label="PRs" className="mt-8">
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  PRs
                </h3>
                <ul className="mt-2 space-y-2.5">
                  {prExercises.map((exercise) => {
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
                            earned here — a PR is the page's one celebration. */}
                        {!isSingleWeek && delta > 0 && (
                          <p className="mt-0.5 text-right text-sm font-semibold text-primary tnum">
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

            {stats.exercises.length > 0 && (
              <section aria-label="Progression" className="mt-8">
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Progression
                </h3>
                <div className="mt-2 space-y-4">
                  {stats.exercises.map((exercise) => (
                    <div key={`${exercise.source}:${exercise.wgerExerciseId}`}>
                      <p className="text-sm font-medium">{exercise.name}</p>
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
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}
