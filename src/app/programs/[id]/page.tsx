import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight, MessageCircle } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { isCoachEnabled } from '@/lib/coach/access'
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
import { resolveActiveSession } from '@/lib/active-session'
import { autoregReason } from '@/lib/autoregulate'
import { TECHNIQUE_LABEL_KEY } from '@/lib/technique'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { BlockMap } from '@/components/block-map'
import { buildBlockWeeks } from '@/components/block-weeks'
import { cn } from '@/lib/utils'
import {
  formatE1RM,
  formatVolumeParts,
  formatWorkoutDate,
  formatWorkoutDuration,
} from '@/lib/format'
import { renderMessage } from '@/lib/message'
import { resolveLocale } from '@/i18n/request'
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
  progressionLine,
} from './detail-view'
import { kgToDisplay } from '@/lib/units'
import { listPatchProposals } from '@/db/patch-proposals'
import { ensureVolumeProposals } from '@/db/volume-progression'
import { ensureReactiveDeloadProposals } from '@/db/reactive-deload'
import { describeToolCall } from '@/lib/coach/describe-tool-call'
import { renderToolCall } from '@/lib/coach/render-tool-call'
import { patchForDisplay } from '@/lib/patch-proposal'
import { proposalAgeLine } from '../list-view'
import { PatchProposalCard } from './patch-proposal-card'
import { TmResetButton } from './tm-reset-button'
import { topPRs } from './stats/stats-view'
import { StartDayButton } from './start-day-button'
import { ProgramActions } from './program-actions'
import { DescriptionEdit } from './description-edit'
import { MarkdownView } from '@/components/markdown-view'
import { ProposalActions } from './proposal-actions'
import { SharingSection } from './sharing-section'
import { RestartProgramButton } from './restart-program-button'
import { DietPhaseCard } from './diet-phase-card'
import { OvershootPolicyControl } from './overshoot-policy-control'
import { ExerciseOvershootControl } from './exercise-overshoot-control'
import { cuttingStalenessWeeks } from '@/lib/diet-phase-staleness'
import { getTranslations } from 'next-intl/server'

/** Chip labels for the change log — WHO edited, in the user's own terms —
 *  live in the catalog under `actor.<value>`. A label built here would be
 *  frozen at module load, before any request, so it could never be
 *  translated. Seed-script writes exist only on the system account's
 *  template rows, so `actor.seed` renders for no real user; the catalog
 *  keeps it so the actor union stays total.
 *
 *  The chip TREATMENT below is presentation, not copy, and stays here. */

/** Distinct chip treatments per actor: your own edits stay quiet (muted),
 *  agent/coach edits carry an outline so "someone else touched the plan"
 *  reads at a glance without shouting. */
const ACTOR_CHIP_CLASSES: Record<ProgramEventActor, string> = {
  ui: 'bg-muted text-muted-foreground',
  mcp: 'border border-primary/50 text-primary',
  coach: 'border border-foreground/40 text-foreground',
  wger: 'border border-border text-muted-foreground',
  seed: 'border border-border text-muted-foreground',
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
  // coachEnabled rides the same Promise.all so the flag lookup (env
  // short-circuit, else PostHog with a bounded timeout) adds no waterfall.
  const [program, unit, coachEnabled] = await Promise.all([
    getProgramDetail(userId, id),
    getWeightUnit(userId),
    isCoachEnabled(userId),
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
            {isProposed ? t('status.proposed') : t(`status.${status}`)}
          </span>
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {/* Article READ surface (PRD §3): hero + icon/title + description
            lead. Renders ONLY when metadata exists; an unadorned program's
            page keeps the pre-article layout plus the quiet Add-description
            control below (the article's first human authoring path). */}
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
              // Markdown article lead (trusted-subset renderer — zero client
              // JS; existing plain-text descriptions are valid markdown).
              <MarkdownView
                markdown={program.description}
                className="mt-3 text-muted-foreground"
              />
            )}
            {!isProposed && (
              <DescriptionEdit
                programId={program.id}
                programName={program.name}
                description={program.description}
              />
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
                  {t('sourceLinkLabel')}
                </a>
              </p>
            )}
          </header>
        )}

        {/* No article yet: the same authoring control stands alone so every
            owned program can grow its article without going through MCP. */}
        {!hasArticleHeader && !isProposed && (
          <div className="mt-4">
            <DescriptionEdit
              programId={program.id}
              programName={program.name}
              description={program.description}
            />
          </div>
        )}

        {/* The forced confirm: a proposal page leads with WHO drafted it and
            the owner's three explicit choices. Everything below stays a
            read-only preview until adopted. */}
        {isProposed && (
          <section
            aria-label={t('proposal.ariaLabel')}
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

        {/* The editorial status line: where the block ACTUALLY stands, in the
            font-display voice — anchored to the current week even while
            browsing another one (the strip says what's selected, this says
            what's real). The muted meta beneath keeps the raw numbers. */}
        {/* The program DOCUMENT note (notes v2 catch-up): authored once
            (upsert_program takes plain text ≤2000 — no markdown contract, so
            no MarkdownView), read at program start, never in the logger. The
            muted quote rail is the workout-detail session-note treatment. */}
        {program.notes !== null && (
          <p className="mt-4 whitespace-pre-wrap border-l-2 border-border pl-3 text-sm text-muted-foreground">
            {program.notes}
          </p>
        )}

        <p className="mt-5 font-display text-2xl uppercase leading-none tracking-wide">
          {renderMessage(t, statusLine)}
        </p>
        <div className="mt-1.5 flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-muted-foreground">
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
          <div className="flex shrink-0 items-center gap-4">
            {/* Coach opens with this program as context, so "swap tomorrow's
                pressing" needs no preamble about which program is meant.
                Gated: env allowlist or the coach-access flag (server enforces too). */}
            {coachEnabled && (
              <Link
                href={`/coach?context=${encodeURIComponent(`program:${program.id}`)}`}
                className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <MessageCircle aria-hidden="true" className="size-4" />
                {t('coachLink')}
              </Link>
            )}
            <Link
              href={`/programs/${program.id}/stats`}
              className="flex items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('statsLink')}
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

        {/* The block map, as the week switcher: every segment is a link (the
            browser owns the state — share, back button, reload all work), the
            fill is each week's days-completed fraction, deload weeks render
            hollow + DL, the current week is ringed. Same visualization as the
            list hero and the stats week rows — learn once, read everywhere.
            Replaces the old scrolling pill row: all weeks now fit one line. */}
        <nav aria-label={t('weekNavLabel')} className="mt-4 py-1">
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

        {/* Auto-regulation visibility: when the engine is holding or backing
            off a lift this week, say so — quietly and honestly (muted card,
            the engine's own reason line, no volt, links nothing new). Only
            derived days can contribute, so a collapsed day never fakes a
            verdict it didn't compute. */}
        {(autoregNotes.length > 0 || tmProposals.length > 0) && (
          <section
            aria-label={t('autoreg.ariaLabel')}
            className="mt-3 border-b border-border/60 pb-4"
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

                  {showTargets ? (
                    <div className="mt-3 space-y-3">
                      {day.exercises.map((exercise, exerciseIndex) => {
                        // The scheme's plain-English conditional sentence with
                        // THIS exercise's numbers (#228) — words not chips,
                        // quiet, skipped when there is no progression.
                        const howLine = progressionLine(
                          exercise.progression,
                          prescriptions[dayIndex][exerciseIndex]?.sets ?? [],
                          unit,
                        )
                        return (
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
                                    {formatTargetLine(group.set, group.count, unit, locale)
                                      .map((segment) => renderMessage(t, segment))
                                      .join(' · ')}
                                  </span>
                                  {/* Chips → words: deload/technique are labels
                                      on the set line, not controls — quiet caps
                                      text, no pill shell. */}
                                  {group.set.derivedFrom === 'deload' && (
                                    <span className="text-[10px] font-semibold uppercase tracking-widest">
                                      {t('day.deloadLabel')}
                                    </span>
                                  )}
                                  {group.set.technique && (
                                    <span className="text-[10px] font-semibold uppercase tracking-widest">
                                      {t(
                                        `day.technique.${TECHNIQUE_LABEL_KEY[group.set.technique.kind]}`,
                                      )}
                                    </span>
                                  )}
                                </p>
                              ))}
                            </div>
                            {howLine !== null && (
                              <p className="mt-1 text-sm text-muted-foreground">
                                {tScheme(howLine.key, howLine.values)}
                              </p>
                            )}
                            {/* Per-exercise overshoot override (#239's data,
                                now with UI): owner-only quiet select; never
                                on a proposal (adopt first — same gate as the
                                program-level control below). */}
                            {!isProposed && (
                              <ExerciseOvershootControl
                                programId={program.id}
                                dayPosition={day.position}
                                exercisePosition={exercise.position}
                                exerciseName={exercise.name}
                                policy={exercise.overshootPolicy}
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
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
          <section aria-label={t('changes.ariaLabel')} className="mt-10 border-t border-border pt-8">
            <h2 className="font-display text-xl uppercase leading-none tracking-wide">{t('changes.title')}</h2>
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

        {/* Overshoot / goal-met policy (#227): an OWNER setting like sharing
            below — how a beaten-on-a-different-axis target is credited.
            Null = per-scheme defaults; the change-logged narrow op rides the
            same patch conventions as the diet phase. */}
        {!isProposed && (
          <div className="mt-10 border-t border-border">
            <OvershootPolicyControl
              programId={program.id}
              policy={program.overshootPolicy}
            />
          </div>
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
