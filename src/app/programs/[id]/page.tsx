import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight, MessageCircle } from 'lucide-react'
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
import { getActiveShare } from '@/db/program-shares'
import { listProgramEvents, type ProgramEventActor } from '@/db/program-events'
import { getWeightUnit } from '@/db/preferences'
import { listWorkoutSummaries } from '@/db/workouts'
import { listWorkoutDrafts } from '@/db/workout-drafts'
import { resolveActiveSession } from '@/lib/active-session'
import { autoregReason } from '@/lib/autoregulate'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { BlockMap } from '@/components/block-map'
import { buildBlockWeeks } from '@/components/block-weeks'
import { cn } from '@/lib/utils'
import { formatE1RM, formatVolume, formatWorkoutDate, formatWorkoutDuration } from '@/lib/format'
import { formatTargetLine, groupDerivedSets } from './derived-format'
import { parseWeekParam, resolveDayState } from './week-view'
import {
  programStatusLine,
  parseExpandParam,
  withExpanded,
  withoutExpanded,
  shouldDeriveDay,
  collectAutoregNotes,
  collectTmResetProposals,
  groupEventsByDay,
} from './detail-view'
import { kgToDisplay } from '@/lib/units'
import { listPatchProposals } from '@/db/patch-proposals'
import { describeToolCall } from '@/lib/coach/describe-tool-call'
import { patchForDisplay } from '@/lib/patch-proposal'
import { proposalAgeLine } from '../list-view'
import { PatchProposalCard } from './patch-proposal-card'
import { TmResetButton } from './tm-reset-button'
import { topPRs } from './stats/stats-view'
import { StartDayButton } from './start-day-button'
import { ProgramActions } from './program-actions'
import { ProposalActions } from './proposal-actions'
import { SharingSection } from './sharing-section'
import { RestartProgramButton } from './restart-program-button'

/** Chip labels for the change log — WHO edited, in the user's own terms. */
const ACTOR_LABELS: Record<ProgramEventActor, string> = {
  ui: 'You',
  mcp: 'Claude',
  coach: 'Coach',
  wger: 'wger',
}

/** Distinct chip treatments per actor: your own edits stay quiet (muted),
 *  agent/coach edits carry an outline so "someone else touched the plan"
 *  reads at a glance without shouting. */
const ACTOR_CHIP_CLASSES: Record<ProgramEventActor, string> = {
  ui: 'bg-muted text-muted-foreground',
  mcp: 'border border-primary/50 text-primary',
  coach: 'border border-foreground/40 text-foreground',
  wger: 'border border-border text-muted-foreground',
}

/** v1 cap: no pagination UI — older history stays reachable via the MCP
 *  tool's `before` cursor (list_program_changes). */
const CHANGE_LOG_LIMIT = 10

export default async function ProgramDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ week?: string | string[]; expand?: string | string[] }>
}) {
  const userId = await requireUserId()
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const [program, unit] = await Promise.all([getProgramDetail(userId, id), getWeightUnit(userId)])
  if (!program) notFound()

  const [
    { currentWeek, blockComplete },
    nextDay,
    summaries,
    drafts,
    programWorkouts,
    changeEvents,
    activeShare,
    patchProposals,
  ] = await Promise.all([
    programWeekState(userId, program.id, program.mesocycleWeeks),
    getNextProgramDay(userId),
    listWorkoutSummaries(userId),
    listWorkoutDrafts(userId),
    listProgramWorkouts(userId, program.id),
    listProgramEvents(userId, program.id, { limit: CHANGE_LOG_LIMIT }),
    // The live share token for the sharing UI's copy-link (null until minted).
    getActiveShare(userId, program.id),
    // Pending batch-patch proposals awaiting the owner's combined confirm.
    listPatchProposals(userId, program.id),
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
  // Which collapsed day cards are expanded to full targets — URL state like
  // `?week=` (share/back/reload all work), parsed defensively. Resets on week
  // switch by construction: targets are week-specific, so a stale expansion
  // must not carry a derivation cost into every browsed week.
  const expanded = parseExpandParam(sp.expand)

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
  // The page's primary object, decided BEFORE derivation so the collapse
  // predicate can see it: the day the user would actually train next, in the
  // week they're actually in.
  const isNextUpByIndex = program.days.map(
    (day, i) => isCurrentWeek && dayStates[i] === null && day.id === nextDayId,
  )
  // getProgramDetail days carry no back-ref to the program row, so the
  // DayForDerivation `program` slice is attached inline per day. Targets are
  // derived for the SELECTED week — the whole point of the week switcher —
  // but ONLY for days that will actually render them: Done and In-progress
  // cards never show targets, and collapsed untouched cards (everything but
  // next-up and explicit `?expand=` days) skip derivation entirely — each
  // derivation costs real history reads per exercise (shouldDeriveDay).
  const prescriptions = await Promise.all(
    program.days.map((day, i) =>
      !shouldDeriveDay(dayStates[i] !== null, isNextUpByIndex[i], expanded.has(day.id))
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
                autoregStallPolicy: program.autoregStallPolicy,
                deloadPolicy: program.deloadPolicy,
              },
            },
            selectedWeek,
          ),
    ),
  )
  // The block map's week array — per-week distinct done-day counts derived
  // from the same programWorkouts rows the day cards already bucket (the old
  // binary completed-weeks Set, upgraded to real fractions).
  const blockWeeks = buildBlockWeeks({
    mesocycleWeeks: program.mesocycleWeeks,
    deloadWeek: program.deloadWeek,
    currentWeek,
    dayCountTotal: program.days.length,
    workouts: programWorkouts,
  })
  // The header's editorial digest — anchored to the CURRENT week regardless
  // of which week is being browsed (same anchor rule as the meta line).
  const statusLine = programStatusLine({
    currentWeek,
    mesocycleWeeks: program.mesocycleWeeks,
    deloadWeek: program.deloadWeek,
    daysDoneThisWeek: blockWeeks.find((w) => w.week === currentWeek)?.dayCountDone ?? 0,
    dayCountTotal: program.days.length,
    blockComplete,
  })
  // The engine's held/backed-off lifts, from the prescriptions derived above
  // (a collapsed day honestly contributes nothing — no extra reads).
  const autoregNotes = collectAutoregNotes(program.days, prescriptions)
  // M4 flags as owner-confirmable TM reductions (TM lifecycle §1) — same
  // derived-prescriptions source, never auto-applied; the confirm button is
  // withheld on proposals (nothing on a proposal may write).
  const tmProposals = collectTmResetProposals(program.days, prescriptions)
  // Proposed branches BEFORE the draft-default narrowing: a proposal must
  // never masquerade as a draft (which would surface Activate/Edit/Restart —
  // exactly the paths the forced confirm exists to block).
  const isProposed = program.status === 'proposed'
  const status = (
    program.status === 'active' || program.status === 'archived' ? program.status : 'draft'
  ) as 'draft' | 'active' | 'archived'
  const hasArticleHeader =
    program.heroImageUrl !== null || program.icon !== null || program.description !== null

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={program.name}
        leading={
          <BackLink fallback="/programs" />
        }
        trailing={
          /* Chip → word: status is a label, not a control — caps text, volt
             only when the plan is live (or pending the owner's confirm). */
          <span
            className={cn(
              'shrink-0 text-xs font-semibold uppercase tracking-widest',
              isProposed || status === 'active' ? 'text-primary' : 'text-muted-foreground',
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
            // De-carded: the quiet volt hairline (block-complete vocabulary)
            // frames the proposal — volt lives in the label and hairline;
            // the page's volt BUTTON stays with ProposalActions' adopt CTA.
            className="mt-6 border-b border-b-primary/30 pb-5"
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
              {/* authorActor is an OPEN value space: 'coach' and 'owner' get
                  their labels; anything else is a sharer's userId (adopted
                  via a share link) and reads "Shared program" — no Clerk
                  display-name lookup in v1. */}
              {program.authorActor === 'coach'
                ? 'Proposed by your coach'
                : program.authorActor === 'owner'
                  ? 'Proposed for you'
                  : 'Shared program'}
            </p>
            {/* Staleness affordance: the proposal's age as muted words —
                never an auto-expiry (a coach draft must not silently die). */}
            <p className="mt-0.5 text-xs text-muted-foreground first-letter:uppercase">
              {proposalAgeLine(program.createdAt, new Date())}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Review the plan below, then adopt it as a draft, start it right away, or decline.
              Nothing trains until you confirm.
            </p>
            <ProposalActions id={program.id} />
          </section>
        )}

        {/* The editorial status line: where the block ACTUALLY stands, in the
            font-display voice — anchored to the current week even while
            browsing another one (the strip says what's selected, this says
            what's real). The muted meta beneath keeps the raw numbers. */}
        <p className="mt-5 font-display text-2xl uppercase leading-none tracking-wide">
          {statusLine}
        </p>
        <div className="mt-1.5 flex items-baseline justify-between gap-3">
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

        {/* Batch-patch proposals (proposals plan §3): the chat approval-card
            idiom on the program page — the proposal's summary, one sentence
            diff per patch (describeToolCall over the stored kg-canonical args,
            re-expressed in the user's unit), and ONE combined confirm. Only an
            active program can carry these (the db layer gates propose AND
            confirm), so they never render beside the adopt banner above. */}
        {patchProposals.map((proposal) => (
          <PatchProposalCard
            key={proposal.id}
            id={proposal.id}
            eyebrow={
              proposal.authorActor === 'coach'
                ? 'Proposed by your coach'
                : 'Proposed changes'
            }
            summary={proposal.summary}
            ageLine={proposalAgeLine(proposal.createdAt, new Date())}
            sentences={proposal.patches.map((patch) => {
              const display = patchForDisplay(patch, unit)
              return describeToolCall(display.tool, display.args)
            })}
          />
        ))}

        {/* The block map, as the week switcher: every segment is a link (the
            browser owns the state — share, back button, reload all work), the
            fill is each week's days-completed fraction, deload weeks render
            hollow + DL, the current week is ringed. Same visualization as the
            list hero and the stats week rows — learn once, read everywhere.
            Replaces the old scrolling pill row: all weeks now fit one line. */}
        <nav aria-label="Mesocycle week" className="mt-4 py-1">
          <BlockMap
            weeks={blockWeeks}
            size="default"
            selectedWeek={selectedWeek}
            hrefForWeek={(week) => `/programs/${program.id}?week=${week}`}
          />
        </nav>

        {/* The block's payoff moment: the advancement rule fired at the final
            week, so say so — with the biggest e1RM wins as evidence. De-carded
            to the quiet volt hairline the summary's achievement sections wear:
            volt lives in the TEXT (label) and the hairline; the page's one
            volt BUTTON stays with Start below. Phase 3's Restart action lands
            in this section. */}
        {blockComplete && (
          <section
            aria-label="Block complete"
            className="mt-8 border-b border-b-primary/30 pb-4"
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
        {/* Hairline section header (logger grammar): the condensed-caps
            heading opens the week's divider list past its own hairline. */}
        <div className="mt-8 flex items-baseline justify-between gap-3 border-t border-border pt-6">
          <h2 className="font-display text-xl uppercase leading-none tracking-wide">
            Week {selectedWeek}
          </h2>
          {selectedWeek === program.deloadWeek && (
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Deload week
            </span>
          )}
        </div>

        {/* Auto-regulation visibility: when the engine is holding or backing
            off a lift this week, say so — quietly and honestly (muted card,
            the engine's own reason line, no volt, links nothing new). Only
            derived days can contribute, so a collapsed day never fakes a
            verdict it didn't compute. */}
        {(autoregNotes.length > 0 || tmProposals.length > 0) && (
          <section
            aria-label="Auto-regulation"
            className="mt-3 border-b border-border/60 pb-4"
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Auto-regulation
            </p>
            {autoregNotes.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {autoregNotes.map((note) => (
                  <li key={note.exerciseName} className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{note.exerciseName}</span>
                    <span aria-hidden="true"> — </span>
                    <span className="tnum">{autoregReason(note.adjustment, unit)}</span>
                  </li>
                ))}
              </ul>
            )}
            {/* M4 TM proposals: the approval-card sentence ("Week 5, Squat:
                TM 140 → 126 kg — 3 straight stalls") plus an explicit
                owner confirm. Proposed-status pages read the sentence but
                get no button — nothing on a proposal may write. */}
            {tmProposals.length > 0 && (
              <ul className="mt-2 space-y-2">
                {tmProposals.map((proposal) => (
                  <li
                    key={proposal.exerciseName}
                    className="flex items-center justify-between gap-3"
                  >
                    <p className="min-w-0 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {proposal.exerciseName}
                      </span>
                      <span aria-hidden="true"> — </span>
                      <span className="tnum">
                        Week {selectedWeek}: TM {kgToDisplay(proposal.currentTmKg, unit)} →{' '}
                        {kgToDisplay(proposal.proposedTmKg, unit)} {unit} — 3 straight stalls,
                        training max likely set too high
                      </span>
                    </p>
                    {!isProposed && (
                      <TmResetButton
                        programId={program.id}
                        dayPosition={proposal.dayPosition}
                        exercisePosition={proposal.exercisePosition}
                        exerciseName={proposal.exerciseName}
                        currentTm={kgToDisplay(proposal.currentTmKg, unit)}
                        proposedTm={kgToDisplay(proposal.proposedTmKg, unit)}
                        proposedTmKg={proposal.proposedTmKg}
                        unit={unit}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* The day list is a divider list (Things-3 shape): rows separated by
            hairlines, no shells — each row's bottom border does the work the
            card stack's gaps used to. */}
        <div className="mt-1">
            {program.days.map((day, dayIndex) => {
              const dayState = dayStates[dayIndex]
              const workout = dayState?.workout ?? null
              // The page's primary object: the day the user would actually
              // train next, in the week they're actually in. It alone gets
              // presence (bigger name, full-size volt Start); everything else
              // recedes so state — not uniform padding — drives the eye.
              // Computed pre-derivation (see isNextUpByIndex above).
              const isNextUp = isNextUpByIndex[dayIndex]

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
                    // Divider row, not a card. Muted hairline: this is a
                    // revisit surface, and volt hairlines stack per trained
                    // day (#163 precedent) — the "Done" label carries the
                    // state. In-progress below keeps volt (at most one ever).
                    className="border-b border-b-border/60 py-4"
                  >
                    {/* The whole row links to the workout summary — the
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
                    // Live work wears the same quiet volt hairline as done —
                    // the pulsing dot (not a shell) says which is which.
                    className="border-b border-b-primary/30 py-4"
                  >
                    {/* Same live-session voice as the home resume banner:
                        pulsing volt dot (motion-safe ping over a
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

              // WHOOP tier discipline: only the next-up card (and explicitly
              // expanded ones) shows full targets; other untouched days
              // collapse to name + exercise count. Collapse is also the perf
              // win — a collapsed day's prescription was never derived.
              const isExpanded = expanded.has(day.id)
              const showTargets = isNextUp || isExpanded
              const collapseValue = withoutExpanded(expanded, day.id)

              return (
                <section
                  key={day.id}
                  // Untouched days sit on the muted hairline — next-up is
                  // marked by scale (2xl name) and the page's one volt Start,
                  // not by a border treatment.
                  className="border-b border-border/60 py-4"
                >
                  <div className="flex min-w-0 items-baseline justify-between gap-3">
                    {header}
                    {/* A past-week untouched day is still a fact ("Skipped"),
                        but no longer a dead end — it keeps its Start (and
                        expandable targets) so missed days can be made up. */}
                    {isPastWeek && (
                      <span className="shrink-0 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Skipped
                      </span>
                    )}
                  </div>

                  {showTargets ? (
                    <div className="mt-3 space-y-3">
                      {day.exercises.map((exercise, exerciseIndex) => (
                        <div key={exercise.id}>
                          <p className="text-sm font-medium">{exercise.name}</p>
                          <div className="mt-1 space-y-0.5">
                            {groupDerivedSets(
                              prescriptions[dayIndex][exerciseIndex]?.sets ?? [],
                            ).map((group, groupIndex) => (
                              <p
                                key={groupIndex}
                                className="flex items-baseline gap-2 text-sm text-muted-foreground"
                              >
                                <span className="tnum">
                                  {formatTargetLine(group.set, group.count, unit)}
                                </span>
                                {/* Chips → words: deload/technique are labels
                                    on the set line, not controls — quiet caps
                                    text, no pill shell. */}
                                {group.set.derivedFrom === 'deload' && (
                                  <span className="text-[10px] font-semibold uppercase tracking-widest">
                                    Deload
                                  </span>
                                )}
                                {group.set.technique && (
                                  <span className="text-[10px] font-semibold uppercase tracking-widest">
                                    {group.set.technique.kind}
                                  </span>
                                )}
                              </p>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    // Collapsed: the plan's shape without the derivation cost.
                    // Names come from the program rows already loaded — only
                    // the engine-derived TARGETS need the history reads.
                    <p className="mt-2 min-w-0 truncate text-sm text-muted-foreground">
                      {day.exercises.length} exercise{day.exercises.length === 1 ? '' : 's'}
                      {day.exercises.length > 0 && (
                        <> · {day.exercises.map((e) => e.name).join(' · ')}</>
                      )}
                    </p>
                  )}

                  {/* Any untouched day of the SELECTED week is startable — the
                      workout is stamped with that exact (day, week), so
                      provenance stays the user's explicit choice and a skipped
                      day can't pin the block. Only the current week's next-up
                      day earns the volt treatment. A PROPOSED plan offers no
                      Start at all: it instantiates nothing until adopted (the
                      db layer refuses regardless — this just keeps the UI
                      honest about it). */}
                  <div className="mt-4 flex items-center justify-between gap-3">
                    {!isProposed ? (
                      <StartDayButton
                        programDayId={day.id}
                        week={selectedWeek}
                        size={isNextUp ? 'default' : 'sm'}
                        variant={isNextUp ? 'default' : 'outline'}
                        activeSession={guardSession}
                      />
                    ) : (
                      <span />
                    )}
                    {/* Expansion is URL state (plain link, server derives on
                        the round trip) — the whole point of the collapse is
                        that hidden targets are never computed. Next-up always
                        shows targets, so it offers neither link. */}
                    {!isNextUp && !showTargets && (
                      <Link
                        href={`/programs/${program.id}?week=${selectedWeek}&expand=${encodeURIComponent(withExpanded(expanded, day.id))}`}
                        className="flex shrink-0 items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Targets
                        <ChevronRight aria-hidden="true" className="size-4" />
                      </Link>
                    )}
                    {isExpanded && (
                      <Link
                        href={`/programs/${program.id}?week=${selectedWeek}${
                          collapseValue !== null
                            ? `&expand=${encodeURIComponent(collapseValue)}`
                            : ''
                        }`}
                        className="shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Hide targets
                      </Link>
                    )}
                  </div>
                </section>
              )
            })}
        </div>

        {/* The zoned tail: Changes / Sharing / danger actions are different
            registers (paper trail, distribution, destruction) — each opens
            past a hairline with real breathing room instead of running
            together as one undifferentiated stack. */}

        {/* The plan's paper trail: who changed what, newest first, grouped
            under calendar-day headers (the date leaves the row, so summaries
            get the full width and wrap to two lines instead of truncating
            mid-sentence). Same rows the coach reads via list_program_changes —
            one shared read path. Absent entirely for untouched programs (no
            empty-state filler); capped at CHANGE_LOG_LIMIT, no pager in v1. */}
        {changeEvents.length > 0 && (
          <section aria-label="Changes" className="mt-10 border-t border-border pt-8">
            <h2 className="font-display text-xl uppercase leading-none tracking-wide">Changes</h2>
            <div className="mt-3 space-y-4">
              {groupEventsByDay(changeEvents, formatWorkoutDate).map((group) => (
                <div key={group.label}>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground tnum">
                    {group.label}
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {group.events.map((event) => (
                      <li key={event.id} className="flex items-baseline gap-2">
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest',
                            ACTOR_CHIP_CLASSES[event.actor],
                          )}
                        >
                          {ACTOR_LABELS[event.actor]}
                        </span>
                        <span className="min-w-0 flex-1 text-sm leading-snug line-clamp-2">
                          {event.summary}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Sharing is an OWNER control and never appears on a proposal — a
            pending proposal can't be made sharable (adopt or decline first;
            the db layer refuses regardless, this keeps the UI honest). */}
        {/* SharingSection carries its own mt-10 — the wrapper only draws
            the hairline. */}
        {!isProposed && (
          <div className="mt-10 border-t border-border">
            <SharingSection
              programId={program.id}
              visibility={program.visibility}
              shareToken={activeShare?.token ?? null}
            />
          </div>
        )}

        {/* A proposal's only actions are the banner's Adopt/Decline above —
            Edit/Activate/Restart/Delete stay off until the owner confirms.
            The page's danger tail: separated behind its own hairline so
            Delete never sits shoulder-to-shoulder with reading content. */}
        {/* ProgramActions carries its own mt-6 — the wrapper only draws the
            hairline and closes the page with bottom breathing room. */}
        {!isProposed && (
          <div className="mt-10 border-t border-border pb-4">
            <ProgramActions
              id={program.id}
              status={status}
              currentWeek={currentWeek}
              mesocycleWeeks={program.mesocycleWeeks}
            />
          </div>
        )}
      </main>
    </div>
  )
}
