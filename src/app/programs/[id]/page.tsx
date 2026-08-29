import { Fragment } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import {
  getProgramDetail,
  programWeekState,
  getNextProgramDay,
  listProgramWorkouts,
} from '@/db/programs'
import { deriveDayPrescription } from '@/db/prescriptions'
import { getProgramStats } from '@/db/program-stats'
import { getActiveShare } from '@/db/program-shares'
import { listProgramEvents, type ProgramEventActor } from '@/db/program-events'
import { getWeightUnit } from '@/db/preferences'
import { listWorkoutSummaries } from '@/db/workouts'
import { listWorkoutDrafts } from '@/db/workout-drafts'
import { resolveActiveSession } from '@/lib/workout/active-session'
import { autoregReason } from '@/lib/programs/autoregulate'
import { AppHeader } from '@/components/nav/app-header'
import { BackLink } from '@/components/nav/back-link'
import { BlockMap } from '@/components/programs/block-map'
import { buildBlockWeeks } from '@/components/programs/block-weeks'
import { cn } from '@/lib/utils'
import {
  formatE1RM,
  formatVolumeParts,
  formatWorkoutDate,
  formatWorkoutDuration,
} from '@/lib/format'
import { renderMessage } from '@/lib/message'
import { resolveLocale } from '@/i18n/request'
import { targetCells, groupDerivedSets, type TargetMarkKey } from './derived-format'
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
  progressionLine,
} from './detail-view'
import { kgToDisplay } from '@/lib/units'
import { listPatchProposals } from '@/db/patch-proposals'
import { ensureVolumeProposals } from '@/db/volume-progression'
import { ensureReactiveDeloadProposals } from '@/db/reactive-deload'
import { describeToolCall } from '@/lib/coach/describe-tool-call'
import { renderToolCall } from '@/lib/coach/render-tool-call'
import { patchForDisplay } from '@/lib/programs/patch-proposal'
import { proposalAgeLine } from '../list-view'
import { PatchProposalCard } from './patch-proposal-card'
import { TmResetButton } from './tm-reset-button'
import { topPRs } from './stats/stats-view'
import { StartDayButton } from './start-day-button'
import { ProgramActions } from './program-actions'
import { ProposalActions } from './proposal-actions'
import { SharingSection } from './sharing-section'
import { RestartProgramButton } from './restart-program-button'
import { DietPhaseCard } from './diet-phase-card'
import { Section } from '@/components/ui/section'
import { NavList, NavRow } from '@/components/ui/nav-list'
import { EmptyWords } from '@/components/ui/empty-words'
import { cuttingStalenessWeeks } from '@/lib/programs/diet-phase-staleness'
import { getTranslations } from 'next-intl/server'

/** Labels for the change log — WHO edited, in the user's own terms — live in
 *  the catalog under `actor.<value>`. A label built here would be frozen at
 *  module load, before any request, so it could never be translated.
 *  Seed-script writes exist only on the system account's template rows, so
 *  `actor.seed` renders for no real user; the catalog keeps it so the actor
 *  union stays total.
 *
 *  Words, not chips ("chips are controls, words are labels"): your own edits
 *  stay muted; agent/coach edits read in the foreground ink so "someone else
 *  touched the plan" still registers — no pill shell, no volt. */
const ACTOR_WORD_CLASSES: Record<ProgramEventActor, string> = {
  ui: 'text-muted-foreground',
  mcp: 'text-foreground',
  coach: 'text-foreground',
  wger: 'text-muted-foreground',
  seed: 'text-muted-foreground',
}

/** v1 cap: no pagination UI — older history stays reachable via the MCP
 *  tool's `before` cursor (list_program_changes). */
const CHANGE_LOG_LIMIT = 10

/** The day table's two class recipes. Micro-caps for the column headers,
 *  tabular right-aligned figures for every cell under them — magnitudes get
 *  compared down a column, which only works if the digits line up. */
const DAY_TABLE_HEAD_CELL =
  'pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground'
const DAY_TABLE_NUM_CELL = 'tnum py-2 pl-2 text-right align-baseline text-[15px]'

/** The effort dialect a day speaks, when it speaks only one. */
const RPE_KIND = 'rpe'

export default async function ProgramDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ week?: string | string[]; expand?: string | string[] }>
}) {
  const t = await getTranslations('ProgramDetail')
  const tFormat = await getTranslations('Format')
  // The progression sentence belongs to the scheme vocabulary, not to this
  // surface — one voice shared with the builder's picker line.
  const tScheme = await getTranslations('SchemeCopy')
  // The patch diff's sentences come from the coach tool-call vocabulary, so
  // they resolve against that namespace — server-side here, client-side in
  // the chat's approval card, from the same descriptors.
  const tTool = await getTranslations('CoachToolCall')
  const locale = await resolveLocale()
  const userId = await requireUserId()
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const [program, unit] = await Promise.all([
    getProgramDetail(userId, id),
    getWeightUnit(userId),
  ])
  if (!program) notFound()

  // The volume-progression weekly check (derive-time trigger, no cron): at
  // most one real evaluation per (program, completed week) — steady-state
  // loads pay one Redis GET. Runs BEFORE listPatchProposals below so a
  // freshly minted +1 proposal renders on this very load. Best-effort: it
  // can never throw into the page.
  await ensureVolumeProposals(userId, program.id)
  // The reactive-deload weekly check rides the same derive-time slot: only
  // reactive-policy or cutting-phase programs pay past the first row read,
  // the Redis marker caps it at one real evaluation per (program, week), and
  // like the volume check it can never throw into the page.
  await ensureReactiveDeloadProposals(userId, program.id)

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
                dietPhase: program.dietPhase,
                overshootPolicy: program.overshootPolicy,
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
  // About is its own route now, so the row always leads somewhere: an
  // undescribed program still gets a page carrying its facts, and for the
  // owner that page's empty state IS the invitation to write one.
  // Manage renders only when it has content: the change log shows for anyone,
  // the owner controls never render on a proposal.
  const showManage = changeEvents.length > 0 || !isProposed

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
            {isProposed ? t('status.proposed') : t(`status.${status}`)}
          </span>
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {/* ── Band 1: identity ──────────────────────────────────────────────
            Who this plan is and where the block stands, then the week
            switcher. The article content (hero, description, notes,
            attribution) folds into the About row so the PLAN — not the
            prose — leads the page. */}
        <header className="mt-4">
          {/* A <p>, not a second <h1>: AppHeader already renders the page's
              h1 from the same name — two identical top-level headings would
              double up the screen-reader heading list. */}
          <p className="flex items-baseline gap-2">
            {program.icon !== null && (
              <span aria-hidden="true" className="text-2xl leading-none">
                {program.icon}
              </span>
            )}
            <span className="min-w-0 truncate font-display text-3xl uppercase leading-none tracking-wide">
              {program.name}
            </span>
          </p>
          {/* The editorial status line: where the block ACTUALLY stands, in
              the font-display voice — anchored to the current week even while
              browsing another one (the strip says what's selected, this says
              what's real). The muted meta beneath keeps the raw numbers. */}
          <p className="mt-3 font-display text-2xl uppercase leading-none tracking-wide">
            {renderMessage(t, statusLine)}
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {/* One whole ICU message per shape, never a sentence plus a
                trailing fragment: the deload clause does not land at the end
                of the line in every language. */}
            {program.deloadWeek !== null
              ? t('weekMetaDeload', {
                  week: currentWeek,
                  total: program.mesocycleWeeks,
                  deloadWeek: program.deloadWeek,
                })
              : t('weekMeta', { week: currentWeek, total: program.mesocycleWeeks })}
          </p>
        </header>

        {/* The block map, as the week switcher: every segment is a link (the
            browser owns the state — share, back button, reload all work), the
            fill is each week's days-completed fraction, deload weeks render
            hollow + DL, the current week is ringed. Same visualization as the
            list hero and the stats week rows — learn once, read everywhere. */}
        <nav aria-label={t('weekNavLabel')} className="mt-4 py-1">
          <BlockMap
            weeks={blockWeeks}
            size="default"
            selectedWeek={selectedWeek}
            hrefForWeek={(week) => `/programs/${program.id}?week=${week}`}
          />
        </nav>

        {/* Attribution is a licensing requirement for imported templates, not
            decoration — it stays on the program page rather than moving to the
            About route, so it is visible without a tap when present. */}
        {program.sourceUrl !== null && (
          <p className="mt-6 border-b border-b-border/60 py-2 text-xs text-muted-foreground">
            <a
              href={program.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 transition-colors hover:text-foreground"
            >
              {t('sourceLinkLabel')}
            </a>
          </p>
        )}

        {/* The forced confirm: a proposal page leads with WHO drafted it and
            the owner's three explicit choices — it demands a decision, so it
            sits ahead of the week's content. Everything below stays a
            read-only preview until adopted. */}
        {isProposed && (
          <section
            aria-label={t('proposal.ariaLabel')}
            // De-carded: the quiet volt hairline (block-complete vocabulary)
            // frames the proposal — volt lives in the label and hairline;
            // the page's volt BUTTON stays with ProposalActions' adopt CTA.
            className="mt-8 border-b border-b-primary/30 pb-5"
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
              {/* authorActor is an OPEN value space: 'coach' and 'owner' get
                  their labels; anything else is a sharer's userId (adopted
                  via a share link) and reads "Shared program" — no WorkOS
                  display-name lookup in v1. */}
              {program.authorActor === 'coach'
                ? t('proposal.eyebrowCoach')
                : program.authorActor === 'owner'
                  ? t('proposal.eyebrowOwner')
                  : t('proposal.eyebrowShared')}
            </p>
            {/* Staleness affordance: the proposal's age as muted words —
                never an auto-expiry (a coach draft must not silently die). */}
            <p className="mt-0.5 text-xs text-muted-foreground first-letter:uppercase">
              {renderMessage(t, proposalAgeLine(program.createdAt, new Date()))}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('proposal.description')}
            </p>
            <ProposalActions id={program.id} />
          </section>
        )}

        {/* Batch-patch proposals (proposals plan §3): the chat approval-card
            idiom on the program page — the proposal's summary, one sentence
            diff per patch (describeToolCall over the stored kg-canonical args,
            re-expressed in the user's unit), and ONE combined confirm. They
            demand a decision, so they stay ahead of the week's content. Only
            an active program can carry these (the db layer gates propose AND
            confirm), so they never render beside the adopt banner above. */}
        {patchProposals.map((proposal) => (
          <PatchProposalCard
            key={proposal.id}
            id={proposal.id}
            eyebrow={
              proposal.authorActor === 'coach'
                ? t('patchProposal.eyebrowCoach')
                : t('patchProposal.eyebrowOther')
            }
            summary={proposal.summary}
            ageLine={renderMessage(t, proposalAgeLine(proposal.createdAt, new Date()))}
            sentences={proposal.patches.map((patch) => {
              const display = patchForDisplay(patch, unit)
              return renderToolCall(tTool, describeToolCall(display.tool, display.args))
            })}
          />
        ))}

        {/* The block's payoff moment: the advancement rule fired at the final
            week, so say so — with the biggest e1RM wins as evidence. De-carded
            to the quiet volt hairline the summary's achievement sections wear:
            volt lives in the TEXT (label) and the hairline; the page's one
            volt BUTTON stays with Start below. Phase 3's Restart action lands
            in this section. */}
        {blockComplete && (
          <section
            aria-label={t('blockComplete.ariaLabel')}
            className="mt-8 border-b border-b-primary/30 pb-4"
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary tnum">
              {t('blockComplete.eyebrow', { weeks: program.mesocycleWeeks })}
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
                        {t('pr.approx')}
                      </span>
                      {formatE1RM(exercise.pr.baseline.e1rm, unit, locale)}
                      <span aria-hidden="true" className="text-muted-foreground">
                        {` ${t('pr.arrow')} `}
                      </span>
                      <span className="sr-only"> {t('pr.srTo')} </span>
                      <span aria-hidden="true" className="text-muted-foreground">
                        {t('pr.approx')}
                      </span>
                      {formatE1RM(exercise.pr.best.e1rm, unit, locale)}
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
                {t('blockComplete.statsLink')}
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
              {status !== 'draft' && <RestartProgramButton id={program.id} size="sm" />}
            </div>
          </section>
        )}

        {/* ── Band 2: this week ─────────────────────────────────────────────
            The selected week's heading, its week-scoped verdicts (diet-phase
            staleness, auto-regulation, TM proposals), then the day list. */}
        {/* Breathing room before the week's content — the selector belongs to
            the header, the heading opens the body. Deliberately non-uniform. */}
        {/* Hairline section header (logger grammar): the condensed-caps
            heading opens the week's divider list past its own hairline. */}
        <div className="mt-8 flex items-baseline justify-between gap-3 border-t border-border pt-6">
          <h2 className="font-display text-xl uppercase leading-none tracking-wide">
            {t('weekTitle', { week: selectedWeek })}
          </h2>
          {selectedWeek === program.deloadWeek && (
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t('deloadBadge')}
            </span>
          )}
        </div>

        {/* "Still cutting?" — the phase's staleness ask (only cutting goes
            stale; lib/diet-phase-staleness.ts owns the threshold). Active
            programs only: a draft/archived plan reads no verdicts through
            the phase, so there is nothing to affirm. */}
        {status === 'active' &&
          (() => {
            const weeks = cuttingStalenessWeeks(
              program.dietPhase,
              program.dietPhaseSetAt,
              new Date(),
            )
            return weeks !== null ? <DietPhaseCard programId={program.id} weeks={weeks} /> : null
          })()}

        {/* A brand-new program says so instead of trailing off silently — a
            plain sentence, no box, no illustration (EmptyWords). */}
        {program.days.length === 0 && <EmptyWords>{t('daysEmpty')}</EmptyWords>}

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
                    {t('day.number', { position: dayIndex + 1 })}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 truncate font-display uppercase leading-tight tracking-wide',
                      isNextUp ? 'text-4xl' : 'text-lg',
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
                // formatVolumeParts renders "9,210" + "kg" through Intl, so
                // numeral and unit label can take different type scales
                // without splitting on a space the locale may not use.
                const volumeParts =
                  workout.volumeKg > 0 ? formatVolumeParts(workout.volumeKg, unit, locale) : null
                const [numeral, numeralLabel] = volumeParts
                  ? [volumeParts.value, volumeParts.unit]
                  : [
                      new Intl.NumberFormat(locale).format(workout.setCount),
                      t('day.setsUnit', { count: workout.setCount }),
                    ]
                const secondary = [
                  renderMessage(
                    tFormat,
                    formatWorkoutDuration(workout.startedAt, workout.completedAt),
                  ),
                  workout.volumeKg > 0 ? t('day.setSummary', { count: workout.setCount }) : null,
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
                          {t('day.doneBadge')}
                        </p>
                        <span className="shrink-0 text-xs text-muted-foreground tnum">
                          {formatWorkoutDate(workout.completedAt, locale)}
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
                        {t('day.inProgressBadge')}
                      </p>
                      <div className="mt-1">{header}</div>
                      <p className="mt-1 text-sm text-muted-foreground tnum">
                        {t('day.setProgress', {
                          completed: workout.completedSetCount,
                          total: workout.setCount,
                        })}
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
                  // marked by scale (4xl name) and the page's one volt Start,
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
                        {t('day.skippedBadge')}
                      </span>
                    )}
                  </div>

                  {/* The day's plan-authored note (notes v2 catch-up): the
                      read-before-lift cue, muted under the day name. Done and
                      in-progress days skip it — the plan is the past there,
                      and the live session carries its own cue line. */}
                  {day.notes !== null && (
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground">
                      {day.notes}
                    </p>
                  )}

                  {/* HANDOFF — for the editor rework, three things this
                      change left behind. Deliberate, not forgotten:

                      1. THIS TABLE SHOULD BE A COMPONENT. It is ~170 lines
                         inside a page that is now 1113 lines, over the 800
                         ceiling in CLAUDE.md. Because it lives in an RSC it
                         has NO Storybook coverage, so its riskiest cases —
                         a 39-char exercise name, "402.5 lb", bodyweight,
                         timed/distance, a one-day week, the conditional
                         superset column that changes the column count — are
                         asserted in tests but have never been SEEN rendering.
                         Extracting it fixes the file size and the coverage
                         gap in one move.

                      2. VOLT IS INCONSISTENT BETWEEN THIS PAGE AND STATS.
                         The stats page now renders its status word muted, on
                         the reasoning that an ACTIVE badge spends the screen's
                         one volt on a fact you knew by navigating there. This
                         page still renders it volt (see the AppHeader trailing
                         above), and also carries per-item volt on the Done
                         badge and the in-progress dot inside the day map —
                         which is the stacking #163 bans. All of that predates
                         this change and was left alone to avoid a drive-by,
                         but the two pages now disagree and one of them should
                         move.

                      3. src/app/programs/new/program-settings.tsx is still
                         absent from I18N_MIGRATED because of pre-existing
                         enum-value literals (value="all-sets" / "first-set").
                         It joins the list in whichever PR fixes those. */}
                  {showTargets ? (
                    (() => {
                      // The day's plan as a TABLE. The string this replaces —
                      // "3×5 @ 105 kg · RPE 8 · RIR 2" — was ambiguous by
                      // construction: sets-versus-reps ordering is contested
                      // enough that gyms publish explainers about it. Under a
                      // declared header no number needs a decoder, and figures
                      // line up down their columns where they get compared.
                      const rows = day.exercises.map((exercise, exerciseIndex) => {
                        const sets = prescriptions[dayIndex][exerciseIndex]?.sets ?? []
                        return {
                          exercise,
                          runs: groupDerivedSets(sets).map((group) =>
                            targetCells(group.set, group.count, unit, locale),
                          ),
                          // The scheme's plain-English conditional sentence
                          // with THIS exercise's numbers (#228) — words not
                          // chips, quiet, skipped when there is no progression.
                          howLine: progressionLine(exercise.progression, sets, unit),
                        }
                      })
                      // One autoregulation dialect per day. RIR and RPE are the
                      // same axis inverted, so the column takes whichever the
                      // plan speaks; only a day that genuinely mixes them falls
                      // back to labelling each cell.
                      const effortKinds = new Set(
                        rows.flatMap((row) =>
                          row.runs.flatMap((run) => (run.effort ? [run.effort.kind] : [])),
                        ),
                      )
                      const mixedEffort = effortKinds.size > 1
                      // Legend covers only the marks actually present — a
                      // standing key for marks this day never uses is noise.
                      const legend = new Map<string, TargetMarkKey>()
                      for (const row of rows) {
                        for (const run of row.runs) {
                          for (const mark of run.marks) legend.set(mark.letter, mark.key)
                        }
                      }
                      // Same non-null supersetGroup within a day = perform as a
                      // superset. The column only exists when one does.
                      const hasSuperset = day.exercises.some((e) => e.supersetGroup !== null)
                      const bodyCols = 5
                      return (
                        <div className="mt-4">
                          <table className="w-full table-fixed border-collapse text-left">
                            <caption className="sr-only">{t('day.tableCaption')}</caption>
                            <thead>
                              <tr className="border-b border-b-border/60">
                                {hasSuperset && (
                                  <th scope="col" className="w-5">
                                    <span className="sr-only">{t('day.colGroup')}</span>
                                  </th>
                                )}
                                <th scope="col" className={DAY_TABLE_HEAD_CELL}>
                                  {t('day.colExercise')}
                                </th>
                                <th scope="col" className={`w-9 pl-2 text-right ${DAY_TABLE_HEAD_CELL}`}>
                                  {t('day.colSets')}
                                </th>
                                <th scope="col" className={`w-14 pl-2 text-right ${DAY_TABLE_HEAD_CELL}`}>
                                  {t('day.colReps')}
                                </th>
                                <th scope="col" className={`w-[4.5rem] pl-2 text-right ${DAY_TABLE_HEAD_CELL}`}>
                                  {t('day.colLoad')}
                                </th>
                                <th scope="col" className={`w-9 pl-2 text-right ${DAY_TABLE_HEAD_CELL}`}>
                                  {mixedEffort
                                    ? t('day.colEffort')
                                    : effortKinds.has(RPE_KIND)
                                      ? t('day.colRpe')
                                      : t('day.colRir')}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map(({ exercise, runs, howLine }, exerciseIndex) => {
                                const group = exercise.supersetGroup
                                const isMember = group !== null
                                const opensGroup =
                                  isMember &&
                                  day.exercises[exerciseIndex - 1]?.supersetGroup !== group
                                // The rail is a cell border, so consecutive
                                // member rows draw one continuous rule — a
                                // bracket and a word, never a letter code. A1/A2
                                // is real coaching notation, but it is WRITTEN
                                // notation: learned from PDFs, not teachable in
                                // passing by a screen.
                                const rail = hasSuperset ? (
                                  <td className={isMember ? 'border-l-2 border-border' : ''} />
                                ) : null
                                const detail = [
                                  howLine !== null ? tScheme(howLine.key, howLine.values) : null,
                                  ...runs.flatMap((run) =>
                                    run.tempo !== null
                                      ? [t('target.tempo', { tempo: run.tempo })]
                                      : [],
                                  ),
                                ].filter((part) => part !== null)
                                return (
                                  <Fragment key={exercise.id}>
                                    {opensGroup && (
                                      <tr>
                                        {rail}
                                        <td
                                          colSpan={bodyCols}
                                          className="pt-3 pl-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                                        >
                                          {t('day.supersetLabel')}
                                        </td>
                                      </tr>
                                    )}
                                    {runs.map((run, runIndex) => (
                                      <tr
                                        key={runIndex}
                                        className={
                                          runIndex === 0 && !opensGroup && exerciseIndex > 0
                                            ? 'border-t border-t-border/60'
                                            : ''
                                        }
                                      >
                                        {rail}
                                        <td className="py-2 align-baseline">
                                          {runIndex === 0 && (
                                            <span className="block truncate pl-2 text-[15px] font-medium">
                                              {exercise.name}
                                            </span>
                                          )}
                                        </td>
                                        <td className={DAY_TABLE_NUM_CELL}>
                                          {run.sets}
                                          {run.marks.map((mark) => (
                                            <span
                                              key={mark.letter}
                                              className="ml-0.5 text-[10px] font-semibold text-muted-foreground"
                                            >
                                              {mark.letter}
                                            </span>
                                          ))}
                                        </td>
                                        {run.span !== null ? (
                                          <td className={DAY_TABLE_NUM_CELL} colSpan={2}>
                                            {run.span}
                                          </td>
                                        ) : (
                                          <>
                                            <td className={DAY_TABLE_NUM_CELL}>{run.reps ?? '—'}</td>
                                            <td className={DAY_TABLE_NUM_CELL}>{run.load ?? '—'}</td>
                                          </>
                                        )}
                                        <td className={DAY_TABLE_NUM_CELL}>
                                          {run.effort === null
                                            ? '—'
                                            : mixedEffort
                                              ? t(`target.${run.effort.kind}`, {
                                                  [run.effort.kind]: run.effort.value,
                                                })
                                              : run.effort.value}
                                        </td>
                                      </tr>
                                    ))}
                                    {detail.length > 0 && (
                                      <tr>
                                        {rail}
                                        <td
                                          colSpan={bodyCols}
                                          className="tnum pb-3 pl-2 text-xs leading-[1.4] text-muted-foreground"
                                        >
                                          {detail.join(' · ')}
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                )
                              })}
                            </tbody>
                          </table>
                          {legend.size > 0 && (
                            <p className="mt-2 border-t border-t-border/60 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                              {[...legend].map(([letter, key]) => `${letter} ${t(key)}`).join(' · ')}
                            </p>
                          )}
                        </div>
                      )
                    })()
                  ) : (
                    // Collapsed: the plan's shape without the derivation cost.
                    // Names come from the program rows already loaded — only
                    // the engine-derived TARGETS need the history reads.
                    <p className="mt-2 min-w-0 truncate text-sm text-muted-foreground">
                      {day.exercises.length > 0
                        ? t('day.exerciseSummary', {
                            count: day.exercises.length,
                            names: day.exercises.map((e) => e.name).join(' · '),
                          })
                        : t('day.exerciseCount', { count: day.exercises.length })}
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
                        {t('day.targetsLink')}
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
                        {t('day.hideTargetsLink')}
                      </Link>
                    )}
                  </div>
                </section>
              )
            })}
        </div>

        {/* Auto-regulation sits BELOW the plan, not above it. It is a claim
            about loads that apply the moment you hit Start — near the plan,
            never ahead of it, because the day list is why the page was
            opened. Quiet and honest: the engine's own reason line, no volt.
            Only derived days can contribute, so a collapsed day never fakes a
            verdict it didn't compute. */}
        {(autoregNotes.length > 0 || tmProposals.length > 0) && (
          <section
            aria-label={t('autoreg.ariaLabel')}
            className="mt-8 border-t border-border pt-6"
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t('autoreg.title')}
            </p>
            {autoregNotes.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {autoregNotes.map((note) => (
                  <li key={note.exerciseName} className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{note.exerciseName}</span>
                    <span aria-hidden="true"> {t('autoreg.separator')} </span>
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
                      <span aria-hidden="true"> {t('autoreg.separator')} </span>
                      <span className="tnum">
                        {t('autoreg.tmProposal', {
                          week: selectedWeek,
                          currentTm: kgToDisplay(proposal.currentTmKg, unit),
                          proposedTm: kgToDisplay(proposal.proposedTmKg, unit),
                          unit,
                        })}
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

        {/* The doors out of this page. A NavList, not a DividerList: NavRow
            has no trailing slot, so these rows cannot carry a value — on a
            screen already stacking several divider lists, density is the only
            differentiator left, and content rows are dense. Headerless
            deliberately: the three share only "not the plan", and every
            honest name for that set (More, Other, Details) is a zero-scent
            label. Manage follows at a short gap so its header peeks — a
            full-width hairline group after a big gap reads as the page end. */}
        <NavList label={t('navLabel')}>
          {/* Coach opens with this program as context, so "swap tomorrow's
              pressing" needs no preamble about which program is meant. Shown
              to everyone — the coach is released; the entitlement gates use,
              and an unentitled click is the Max upsell. */}
          <NavRow href={`/coach?context=${encodeURIComponent(`program:${program.id}`)}`}>
            {t('coachLink')}
          </NavRow>
          <NavRow href={`/programs/${program.id}/stats`}>{t('statsLink')}</NavRow>
          <NavRow href={`/programs/${program.id}/about`}>{t('aboutTitle')}</NavRow>
        </NavList>

        {/* ── Band 3: manage ────────────────────────────────────────────────
            The plan's back office under one Section header: the paper trail,
            the owner settings, distribution, and the danger tail — different
            registers, so each block still opens past its own hairline, but
            they read as one "Manage" zone instead of a loose stack. */}
        {showManage && (
          <Section title={t('manageTitle')} className="mt-8 pt-2">
            {/* The plan's paper trail: who changed what, newest first, grouped
                under calendar-day headers (the date leaves the row, so
                summaries get the full width and wrap to two lines instead of
                truncating mid-sentence). Same rows the coach reads via
                list_program_changes — one shared read path. Absent entirely
                for untouched programs (no empty-state filler); capped at
                CHANGE_LOG_LIMIT, no pager in v1. */}
            {changeEvents.length > 0 && (
              <section aria-label={t('changes.ariaLabel')} className="mt-5">
                <h3 className="text-sm font-medium">{t('changes.title')}</h3>
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
                                'shrink-0 text-xs font-semibold uppercase tracking-widest',
                                ACTOR_WORD_CLASSES[event.actor],
                              )}
                            >
                              {t(`actor.${event.actor}`)}
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

            {/* Sharing is an OWNER control and never appears on a proposal —
                a pending proposal can't be made sharable (adopt or decline
                first; the db layer refuses regardless, this keeps the UI
                honest). SharingSection carries its own mt-10 — the wrapper
                only draws the hairline. */}
            {!isProposed && (
              <div className="mt-10 border-t border-border">
                <SharingSection
                  programId={program.id}
                  visibility={program.visibility}
                  shareToken={activeShare?.token ?? null}
                />
              </div>
            )}

            {/* A proposal's only actions are the banner's Adopt/Decline above
                — Edit/Activate/Restart/Delete stay off until the owner
                confirms. The page's danger tail: separated behind its own
                hairline so Delete never sits shoulder-to-shoulder with
                reading content. ProgramActions carries its own mt-6 — the
                wrapper only draws the hairline and closes the page with
                bottom breathing room. */}
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
          </Section>
        )}
      </main>
    </div>
  )
}
