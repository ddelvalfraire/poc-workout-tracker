import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import {
  getProgramDetail,
  nextProgramWeek,
  deriveDayPrescription,
  getNextProgramDay,
  listProgramWorkouts,
} from '@/db/programs'
import { getWeightUnit } from '@/db/preferences'
import { listWorkoutSummaries } from '@/db/workouts'
import { listWorkoutDrafts } from '@/db/workout-drafts'
import { resolveActiveSession } from '@/lib/active-session'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatVolume, formatWorkoutDate, formatWorkoutDuration } from '@/lib/format'
import { formatTargetLine, groupDerivedSets } from './derived-format'
import { parseWeekParam, resolveDayState } from './week-view'
import { StartDayButton } from './start-day-button'
import { ProgramActions } from './program-actions'

export default async function ProgramDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ week?: string | string[] }>
}) {
  const userId = await requireUserId()
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const [program, unit] = await Promise.all([getProgramDetail(userId, id), getWeightUnit(userId)])
  if (!program) notFound()

  const [currentWeek, nextDay, summaries, drafts, programWorkouts] = await Promise.all([
    nextProgramWeek(userId, program.id, program.mesocycleWeeks),
    getNextProgramDay(userId),
    listWorkoutSummaries(userId),
    listWorkoutDrafts(userId),
    listProgramWorkouts(userId, program.id),
  ])
  // Week is URL state (`?week=N`) so a specific week is linkable/back-buttonable;
  // the default is the week the user is actually in, and garbage clamps/falls
  // back rather than erroring — see parseWeekParam.
  const selectedWeek = parseWeekParam(sp.week, currentWeek, program.mesocycleWeeks)
  const isCurrentWeek = selectedWeek === currentWeek
  const isPastWeek = selectedWeek < currentWeek

  // Same active-session projection as the home page: starting a day here
  // creates a real workout row immediately, so with a session already live
  // every Start button must raise the continue-or-discard dialog instead of
  // silently minting a second session.
  const activeSession = resolveActiveSession(drafts, summaries, new Date())
  const guardSession = activeSession && {
    key: activeSession.key,
    name: activeSession.name,
    setCount: activeSession.setCount,
    completedSetCount: activeSession.completedSetCount,
  }
  // One volt CTA per screen (the design system's spine): only the day the
  // user would actually train next keeps the primary variant; the rest
  // demote to outline. A non-active program has no "next", so all demote.
  const nextDayId = nextDay?.programId === program.id ? nextDay.dayId : null
  // Each day's fate for the selected week, from the program's workout rows
  // bucketed by (day, week). resolveDayState arbitrates historical duplicates:
  // completed beats in-progress, freshest wins within a state. Computed
  // BEFORE prescriptions so derivation can skip resolved days.
  const dayStates = program.days.map((day) =>
    resolveDayState(
      programWorkouts.filter((w) => w.programDayId === day.id && w.programWeek === selectedWeek),
    ),
  )
  // getProgramDetail days carry no back-ref to the program row, so the
  // DayForDerivation `program` slice is attached inline per day. Targets are
  // derived for the SELECTED week — the whole point of the week switcher —
  // but ONLY for untouched days: Done and In-progress cards never render
  // targets, and each derivation costs real history reads per exercise.
  const prescriptions = await Promise.all(
    program.days.map((day, i) =>
      dayStates[i]
        ? Promise.resolve([])
        : deriveDayPrescription(
            userId,
            {
              exercises: day.exercises,
              program: { mesocycleWeeks: program.mesocycleWeeks, deloadWeek: program.deloadWeek },
            },
            selectedWeek,
          ),
    ),
  )
  // Which weeks carry at least one finished session — feeds the tiny progress
  // dot under each week pill, so the selector doubles as a mesocycle map.
  const completedWeeks = new Set(
    programWorkouts
      .filter((w) => w.completedAt !== null && w.programWeek !== null)
      .map((w) => w.programWeek as number),
  )
  // A past week nobody touched collapses to one quiet line — a stack of
  // per-day "Skipped" cards would shout about absence.
  const isFullySkippedWeek = isPastWeek && dayStates.every((state) => state === null)

  const status = (
    program.status === 'active' || program.status === 'archived' ? program.status : 'draft'
  ) as 'draft' | 'active' | 'archived'
  const weeks = Array.from({ length: Math.max(1, program.mesocycleWeeks) }, (_, i) => i + 1)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={program.name}
        leading={
          <Link
            href="/programs"
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
        {/* "You are here" stays anchored to the CURRENT week even while browsing
            another one — the pills say what's selected, this says what's real. */}
        <p className="mt-4 text-sm text-muted-foreground">
          Week {currentWeek} of {program.mesocycleWeeks}
          {program.deloadWeek !== null && ` · deload wk ${program.deloadWeek}`}
        </p>

        {/* Week selector: plain links so the browser owns the state (share,
            back button, reload all just work). Sits tight under the header
            meta (they're one thought); bleeds to the screen edge (-mx-5/px-5)
            so the scroll gutter isn't visibly clipped mid-pill; scrollbar
            hidden — the pill row itself signals scrollability. */}
        <nav
          aria-label="Mesocycle week"
          className="-mx-5 mt-2 overflow-x-auto px-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="flex w-max gap-2 py-1">
            {weeks.map((week) => {
              const isSelected = week === selectedWeek
              const hasCompleted = completedWeeks.has(week)
              return (
                <Link
                  key={week}
                  href={`/programs/${program.id}?week=${week}`}
                  aria-current={isSelected ? 'page' : undefined}
                  // The dot and DL marker are visual shorthand; the label
                  // spells them out for screen readers.
                  aria-label={`Week ${week}${hasCompleted ? ', has completed sessions' : ''}${
                    week === program.deloadWeek ? ', deload' : ''
                  }`}
                  // before:-inset-1 grows the invisible hit target past the
                  // visible pill (repo precedent: rest/plate sheet pills);
                  // pill + dot stack the link to ~44px effective height.
                  className="relative flex shrink-0 flex-col items-center gap-1 before:absolute before:-inset-1"
                >
                  <span
                    className={cn(
                      'flex h-9 items-baseline gap-1.5 rounded-full border px-3.5 pt-2 text-sm font-semibold tnum transition-colors',
                      isSelected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground',
                    )}
                  >
                    Wk {week}
                    {/* Deload is a fact about the plan, not an active state,
                        so the marker stays quiet even on the selected pill. */}
                    {week === program.deloadWeek && (
                      <span
                        className={cn(
                          'text-[10px] font-semibold uppercase tracking-widest',
                          isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground',
                        )}
                      >
                        DL
                      </span>
                    )}
                  </span>
                  {/* Mesocycle progress at a glance: volt dot = at least one
                      finished session that week. Transparent (not hidden)
                      otherwise so the pills don't shift baseline. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1 rounded-full',
                      hasCompleted ? 'bg-primary' : 'bg-transparent',
                    )}
                  />
                </Link>
              )
            })}
          </div>
        </nav>

        {/* Breathing room before the week's content — the selector belongs to
            the header, the heading opens the body. Deliberately non-uniform. */}
        <div className="mt-8 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl uppercase leading-none tracking-wide">
            Week {selectedWeek}
          </h2>
          {selectedWeek === program.deloadWeek && (
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Deload week
            </span>
          )}
        </div>

        {isFullySkippedWeek ? (
          // One quiet line for a week that never happened: the fact ("nothing
          // trained") once, day names dot-joined — not a card per absence.
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing trained this week — {program.days.map((d) => d.name).join(' · ')} skipped.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {program.days.map((day, dayIndex) => {
              const dayState = dayStates[dayIndex]
              const workout = dayState?.workout ?? null
              // The page's primary object: the day the user would actually
              // train next, in the week they're actually in. It alone gets
              // presence (bigger name, full-size volt Start); everything else
              // recedes so state — not uniform padding — drives the eye.
              const isNextUp = isCurrentWeek && dayState === null && day.id === nextDayId

              const header = (
                <h3 className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground tnum">
                    Day {dayIndex + 1}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 truncate font-display uppercase leading-tight tracking-wide',
                      isNextUp ? 'text-2xl' : 'text-lg',
                    )}
                  >
                    {day.name}
                  </span>
                </h3>
              )

              if (dayState?.state === 'completed' && workout && workout.completedAt) {
                // Results-first: volume (or sets, for volume-less duration
                // days) as the big numeral — the app's established pattern
                // (program list weeks, history date blocks) — with duration/
                // sets demoted to a muted secondary line and the date smallest.
                // formatVolume renders "9,210 kg"; split once so numeral and
                // unit label can take different type scales.
                const [numeral, numeralLabel] =
                  workout.volumeKg > 0
                    ? formatVolume(workout.volumeKg, unit).split(' ')
                    : [String(workout.setCount), workout.setCount === 1 ? 'set' : 'sets']
                const secondary = [
                  formatWorkoutDuration(workout.startedAt, workout.completedAt),
                  workout.volumeKg > 0
                    ? `${workout.setCount} set${workout.setCount === 1 ? '' : 's'}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')

                return (
                  <section
                    key={day.id}
                    className="rounded-2xl border border-primary/50 bg-card p-4"
                  >
                    {/* The whole card links to the workout summary — the
                        results ARE the affordance, no extra button needed. */}
                    <Link href={`/workout/${workout.id}`} className="block">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
                          Done
                        </p>
                        <span className="shrink-0 text-xs text-muted-foreground tnum">
                          {formatWorkoutDate(workout.completedAt)}
                        </span>
                      </div>
                      <div className="mt-1">{header}</div>
                      <p className="mt-2 flex items-baseline gap-1.5">
                        <span className="font-display text-2xl leading-none tnum">{numeral}</span>
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                          {numeralLabel}
                        </span>
                      </p>
                      {secondary && (
                        <p className="mt-1 text-sm text-muted-foreground tnum">{secondary}</p>
                      )}
                      {/* The plan is the past once the day is done — one
                          collapsed muted line, not the full target list. */}
                      <p className="mt-2 min-w-0 truncate text-sm text-muted-foreground">
                        {day.exercises.map((e) => e.name).join(' · ')}
                      </p>
                    </Link>
                  </section>
                )
              }

              if (dayState?.state === 'in-progress' && workout) {
                return (
                  <section
                    key={day.id}
                    className="rounded-2xl border border-primary/50 bg-card p-4"
                  >
                    {/* Same live-session voice as the home resume banner:
                        volt border, pulsing volt dot (motion-safe ping over a
                        static dot, so reduced-motion still reads "live").
                        The link resumes the logger. */}
                    <Link href={`/workout/${workout.id}/edit`} className="block">
                      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-primary">
                        <span aria-hidden="true" className="relative flex size-2">
                          <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-primary opacity-60" />
                          <span className="relative inline-flex size-2 rounded-full bg-primary" />
                        </span>
                        In progress
                      </p>
                      <div className="mt-1">{header}</div>
                      <p className="mt-1 text-sm text-muted-foreground tnum">
                        {workout.completedSetCount} of {workout.setCount} set
                        {workout.setCount === 1 ? '' : 's'}
                      </p>
                    </Link>
                    {/* No target list here: the live session (one tap away)
                        already carries the targets as ghost placeholders. */}
                  </section>
                )
              }

              if (isPastWeek) {
                // Skipped is a non-event: one quiet line per day, no target
                // list — the quietest thing on the page by design.
                return (
                  <section
                    key={day.id}
                    className="flex min-w-0 items-baseline justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3"
                  >
                    {header}
                    <span className="shrink-0 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Skipped
                    </span>
                  </section>
                )
              }

              return (
                <section
                  key={day.id}
                  className={cn(
                    'rounded-2xl border bg-card p-4',
                    // Volt border only on the primary object; plain and
                    // future-week cards stay quiet.
                    isNextUp ? 'border-primary/40' : 'border-border',
                  )}
                >
                  {header}

                  <div className="mt-3 space-y-3">
                    {day.exercises.map((exercise, exerciseIndex) => (
                      <div key={exercise.id}>
                        <p className="text-sm font-medium">{exercise.name}</p>
                        <div className="mt-1 space-y-0.5">
                          {groupDerivedSets(prescriptions[dayIndex][exerciseIndex]).map(
                            (group, groupIndex) => (
                              <p
                                key={groupIndex}
                                className="flex items-baseline gap-2 text-sm text-muted-foreground"
                              >
                                <span className="tnum">
                                  {formatTargetLine(group.set, group.count, unit)}
                                </span>
                                {group.set.derivedFrom === 'deload' && (
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
                                    Deload
                                  </span>
                                )}
                                {group.set.technique && (
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
                                    {group.set.technique.kind}
                                  </span>
                                )}
                              </p>
                            ),
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Start only exists on the CURRENT week: sessions belong to
                      the week the user is in (provenance is stamped at
                      instantiation), so starting a future week from here
                      would forge history. Future weeks are a preview, and
                      the CTA's absence is what says so. */}
                  {isCurrentWeek && (
                    <div className="mt-4">
                      <StartDayButton
                        programDayId={day.id}
                        size={isNextUp ? 'default' : 'sm'}
                        variant={isNextUp ? 'default' : 'outline'}
                        activeSession={guardSession}
                      />
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}

        <ProgramActions id={program.id} status={status} />
      </main>
    </div>
  )
}
