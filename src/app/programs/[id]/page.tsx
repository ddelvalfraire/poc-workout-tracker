import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { isCoachUser } from '@/lib/coach/access'
import {
  getProgramDetail,
  programWeekState,
  deriveDayPrescription,
  getNextProgramDay,
  listProgramWorkouts,
} from '@/db/programs'
import { getProgramStats } from '@/db/program-stats'
import { listProgramEvents, type ProgramEventActor } from '@/db/program-events'
import { getWeightUnit } from '@/db/preferences'
import { listWorkoutSummaries } from '@/db/workouts'
import { listWorkoutDrafts } from '@/db/workout-drafts'
import { resolveActiveSession } from '@/lib/active-session'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatE1RM, formatVolume, formatWorkoutDate, formatWorkoutDuration } from '@/lib/format'
import { formatTargetLine, groupDerivedSets } from './derived-format'
import { parseWeekParam, resolveDayState } from './week-view'
import { topPRs } from './stats/stats-view'
import { StartDayButton } from './start-day-button'
import { ProgramActions } from './program-actions'
import { ProposalActions } from './proposal-actions'
import { RestartProgramButton } from './restart-program-button'

/** Chip labels for the change log — WHO edited, in the user's own terms. */
const ACTOR_LABELS: Record<ProgramEventActor, string> = {
  ui: 'You',
  mcp: 'Claude',
  coach: 'Coach',
  wger: 'wger',
}

/** v1 cap: no pagination UI — older history stays reachable via the MCP
 *  tool's `before` cursor (list_program_changes). */
const CHANGE_LOG_LIMIT = 10

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

  const [{ currentWeek, blockComplete }, nextDay, summaries, drafts, programWorkouts, changeEvents] =
    await Promise.all([
      programWeekState(userId, program.id, program.mesocycleWeeks),
      getNextProgramDay(userId),
      listWorkoutSummaries(userId),
      listWorkoutDrafts(userId),
      listProgramWorkouts(userId, program.id),
      listProgramEvents(userId, program.id, { limit: CHANGE_LOG_LIMIT }),
    ])
  // The payoff moment costs an extra read, so only complete blocks pay it —
  // an incomplete block's page issues exactly the queries it always has.
  const stats = blockComplete ? await getProgramStats(userId, program.id) : null
  const prs = stats ? topPRs(stats.exercises, 3) : []
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
              program: {
                id: program.id,
                mesocycleWeeks: program.mesocycleWeeks,
                deloadWeek: program.deloadWeek,
                autoregulation: program.autoregulation,
              },
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
  // Proposed branches BEFORE the draft-default narrowing: a proposal must
  // never masquerade as a draft (which would surface Activate/Edit/Restart —
  // exactly the paths the forced confirm exists to block).
  const isProposed = program.status === 'proposed'
  const status = (
    program.status === 'active' || program.status === 'archived' ? program.status : 'draft'
  ) as 'draft' | 'active' | 'archived'
  const weeks = Array.from({ length: Math.max(1, program.mesocycleWeeks) }, (_, i) => i + 1)
  const hasArticleHeader =
    program.heroImageUrl !== null || program.icon !== null || program.description !== null

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
              isProposed
                ? 'border border-primary/50 bg-transparent text-primary'
                : status === 'active'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
            )}
          >
            {isProposed ? 'proposed' : status}
          </span>
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {/* Article READ surface (PRD §3): hero + icon/title + description
            lead. Renders ONLY when metadata exists — an unadorned program's
            page is byte-identical to the pre-article layout. */}
        {hasArticleHeader && (
          <header className="mt-4">
            {program.heroImageUrl !== null && (
              <div className="relative -mx-5 h-44 overflow-hidden sm:mx-0 sm:rounded-2xl">
                {/* Plain <img>: remote hosts aren't in the next/image
                    allowlist, and the URL is validated http(s) at the input
                    boundary. Decorative — the title below carries the name. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={program.heroImageUrl}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                />
                {/* Bottom-weighted scrim so the overlaid title keeps contrast
                    on any image. */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent"
                />
                <p className="absolute inset-x-5 bottom-3 flex items-baseline gap-2 sm:inset-x-4">
                  {program.icon !== null && (
                    <span aria-hidden="true" className="text-2xl leading-none">
                      {program.icon}
                    </span>
                  )}
                  <span className="min-w-0 truncate font-display text-3xl uppercase leading-none tracking-wide">
                    {program.name}
                  </span>
                </p>
              </div>
            )}
            {program.heroImageUrl === null && program.icon !== null && (
              <p className="flex items-baseline gap-2">
                <span aria-hidden="true" className="text-2xl leading-none">
                  {program.icon}
                </span>
                <span className="min-w-0 truncate font-display text-3xl uppercase leading-none tracking-wide">
                  {program.name}
                </span>
              </p>
            )}
            {program.description !== null && (
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {program.description}
              </p>
            )}
            {program.sourceUrl !== null && (
              <p className="mt-2 text-xs text-muted-foreground">
                {/* Attribution is a licensing requirement for imported
                    templates, not decoration — always rendered when present. */}
                <a
                  href={program.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 transition-colors hover:text-foreground"
                >
                  Source
                </a>
              </p>
            )}
          </header>
        )}

        {/* The forced confirm: a proposal page leads with WHO drafted it and
            the owner's three explicit choices. Everything below stays a
            read-only preview until adopted. */}
        {isProposed && (
          <section
            aria-label="Proposed program"
            className="mt-4 rounded-2xl border border-primary/50 bg-card p-4"
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
              {program.authorActor === 'coach' ? 'Proposed by your coach' : 'Proposed for you'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Review the plan below, then adopt it as a draft, start it right away, or decline.
              Nothing trains until you confirm.
            </p>
            <ProposalActions id={program.id} />
          </section>
        )}

        {/* "You are here" stays anchored to the CURRENT week even while browsing
            another one — the pills say what's selected, this says what's real. */}
        <div className="mt-4 flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-muted-foreground">
            Week {currentWeek} of {program.mesocycleWeeks}
            {program.deloadWeek !== null && ` · deload wk ${program.deloadWeek}`}
          </p>
          <div className="flex shrink-0 items-center gap-4">
            {/* Coach opens with this program as context, so "swap tomorrow's
                pressing" needs no preamble about which program is meant.
                Dev-gated: allowlist accounts only (server enforces too). */}
            {isCoachUser(userId) && (
              <Link
                href={`/coach?context=${encodeURIComponent(`program:${program.id}`)}`}
                className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <MessageCircle aria-hidden="true" className="size-4" />
                Coach
              </Link>
            )}
            <Link
              href={`/programs/${program.id}/stats`}
              className="flex items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Stats
              <ChevronRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </div>

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

        {/* The block's payoff moment: the advancement rule fired at the final
            week, so say so — with the biggest e1RM wins as evidence. Volt is
            confined to TEXT (label) and the done-card border treatment; the
            page's one volt BUTTON stays with Start below. Phase 3's Restart
            action lands in this card. */}
        {blockComplete && (
          <section
            aria-label="Block complete"
            className="mt-8 rounded-2xl border border-primary/50 bg-card p-4"
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary tnum">
              Block complete · {program.mesocycleWeeks} week
              {program.mesocycleWeeks === 1 ? '' : 's'}
            </p>
            {prs.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {prs.map((exercise) => (
                  <li
                    key={`${exercise.source}:${exercise.wgerExerciseId}`}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate font-medium">{exercise.name}</span>
                    <span className="shrink-0 tnum">
                      <span aria-hidden="true" className="text-muted-foreground">
                        ~
                      </span>
                      {formatE1RM(exercise.pr.baseline.e1rm, unit)}
                      <span aria-hidden="true" className="text-muted-foreground">
                        {' → '}
                      </span>
                      <span className="sr-only"> to </span>
                      <span aria-hidden="true" className="text-muted-foreground">
                        ~
                      </span>
                      {formatE1RM(exercise.pr.best.e1rm, unit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {/* Zero gains still gets the card — the state IS the message.
                The action row Phase 2's layout reserved: quiet Stats link
                left, outline Restart right (one-volt rule — Start below
                keeps the page's volt CTA). Restart matches ProgramActions'
                gate: never for drafts, even a fully-trained one. */}
            <div className="mt-3 flex items-center justify-between gap-3">
              <Link
                href={`/programs/${program.id}/stats`}
                className="flex items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Stats
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
              {status !== 'draft' && <RestartProgramButton id={program.id} size="sm" />}
            </div>
          </section>
        )}

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
                  <div className="flex min-w-0 items-baseline justify-between gap-3">
                    {header}
                    {/* A past-week untouched day is still a fact ("Skipped"),
                        but no longer a dead end — it keeps its targets and
                        Start so missed days can be made up. */}
                    {isPastWeek && (
                      <span className="shrink-0 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Skipped
                      </span>
                    )}
                  </div>

                  <div className="mt-3 space-y-3">
                    {day.exercises.map((exercise, exerciseIndex) => (
                      <div key={exercise.id}>
                        <p className="text-sm font-medium">{exercise.name}</p>
                        <div className="mt-1 space-y-0.5">
                          {groupDerivedSets(prescriptions[dayIndex][exerciseIndex]?.sets ?? []).map(
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

                  {/* Any untouched day of the SELECTED week is startable — the
                      workout is stamped with that exact (day, week), so
                      provenance stays the user's explicit choice and a skipped
                      day can't pin the block. Only the current week's next-up
                      day earns the volt treatment. A PROPOSED plan offers no
                      Start at all: it instantiates nothing until adopted (the
                      db layer refuses regardless — this just keeps the UI
                      honest about it). */}
                  {!isProposed && (
                    <div className="mt-4">
                      <StartDayButton
                        programDayId={day.id}
                        week={selectedWeek}
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

        {/* The plan's paper trail: who changed what, newest first. Same rows
            the coach reads via list_program_changes — one shared read path.
            Absent entirely for untouched programs (no empty-state filler);
            capped at CHANGE_LOG_LIMIT with no pager in v1. */}
        {changeEvents.length > 0 && (
          <section aria-label="Changes" className="mt-10">
            <h2 className="font-display text-xl uppercase leading-none tracking-wide">Changes</h2>
            <ul className="mt-3 space-y-2.5">
              {changeEvents.map((event) => (
                <li key={event.id} className="flex items-baseline gap-2">
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {ACTOR_LABELS[event.actor]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{event.summary}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tnum">
                    {formatWorkoutDate(event.occurredAt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* A proposal's only actions are the banner's Adopt/Decline above —
            Edit/Activate/Restart/Delete stay off until the owner confirms. */}
        {!isProposed && (
          <ProgramActions
            id={program.id}
            status={status}
            currentWeek={currentWeek}
            mesocycleWeeks={program.mesocycleWeeks}
          />
        )}
      </main>
    </div>
  )
}
