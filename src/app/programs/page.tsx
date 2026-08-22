import Link from 'next/link'
import { Check, ChevronRight } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import {
  listPrograms,
  getProgramDetail,
  getNextProgramDay,
  listProgramWorkouts,
  programWeekState,
  type ProgramDetail,
} from '@/db/programs'
import { getWeightUnit } from '@/db/preferences'
import { formatVolume } from '@/lib/format'
import { AppHeader } from '@/components/app-header'
import { BlockMap } from '@/components/block-map'
import { buildBlockWeeks, type BlockWeek } from '@/components/block-weeks'
import { buttonVariants } from '@/components/ui/button'
import { DividerList, DividerRow } from '@/components/ui/divider-list'
import { cn } from '@/lib/utils'
import { NavDrawer } from '@/components/nav/nav-drawer'
import {
  zonePrograms,
  programStatusLabel,
  proposalAgeLine,
  buildThisWeekRows,
  blockSoFar,
  noProgramState,
  type ThisWeekRow,
  type BlockSoFar,
} from './list-view'
import { listTemplates, type TemplateListRow } from '@/db/templates'
import { isCoachEnabled } from '@/lib/coach/access'
import { renderMessage } from '@/lib/message'
import { getTranslations } from 'next-intl/server'
import { resolveLocale } from '@/i18n/request'

/** The list-row program shape (listPrograms row). */
type ProgramRowData = Awaited<ReturnType<typeof listPrograms>>[number]

/** A program day off the detail shape — the this-week band's row subject. */
type ProgramDayData = ProgramDetail['days'][number]

/** Everything the block dashboard renders beyond the program row itself. */
interface HeroData {
  currentWeek: number
  blockComplete: boolean
  blockWeeks: BlockWeek[]
  /** The condensed current-week day list, in plan order. */
  thisWeek: { rows: ThisWeekRow<ProgramDayData>[]; doneCount: number }
  /** Days-done / volume figures for the "Block so far" strip. */
  stats: BlockSoFar
}

/**
 * The dashboard's extra reads, for ONE program only (the most recent active).
 * Cost, documented per the list-hero decision: getProgramDetail (day
 * ids/names/exercises for the this-week rows), listProgramWorkouts (block-map
 * fill + done-state + block volume), and getNextProgramDay (cache()-wrapped —
 * free if this request already derived it, one derivation otherwise; it
 * carries currentWeek + blockComplete so programWeekState is only the
 * fallback when the active program has no derivable next day). The this-week
 * and block-so-far bands are DERIVED from these same three reads — no
 * additional queries.
 */
async function loadHeroData(userId: string, program: ProgramRowData): Promise<HeroData | null> {
  const [detail, workouts, nextDay] = await Promise.all([
    getProgramDetail(userId, program.id),
    listProgramWorkouts(userId, program.id),
    getNextProgramDay(userId),
  ])
  if (!detail) return null
  // getNextProgramDay picks the most recent active — the same recency rule
  // zonePrograms uses for the hero — so a mismatch means no next day here.
  const next = nextDay?.programId === program.id ? nextDay : null
  const { currentWeek, blockComplete } = next
    ? { currentWeek: next.week, blockComplete: next.blockComplete }
    : await programWeekState(userId, program.id, program.mesocycleWeeks)
  return {
    currentWeek,
    blockComplete,
    blockWeeks: buildBlockWeeks({
      mesocycleWeeks: program.mesocycleWeeks,
      deloadWeek: program.deloadWeek,
      currentWeek,
      dayCountTotal: detail.days.length,
      workouts,
    }),
    thisWeek: buildThisWeekRows(
      detail.days,
      workouts,
      currentWeek,
      // The block's final lap done = nothing to point at, matching the hero's
      // completion line taking over from the Start affordance.
      next && !blockComplete ? next.dayId : null,
    ),
    stats: blockSoFar(detail.days.length, workouts, currentWeek),
  }
}

/** One exercise-name summary line, the detail page's exact grammar. */
function exerciseSummary(day: ProgramDayData): string | null {
  if (day.exercises.length === 0) return null
  return day.exercises.map((e) => e.name).join(' · ')
}

/** The divider-row interaction recipe (DividerRow's, kept inline because
 *  these rows lead with an icon/summary stack DividerRow's slots don't fit). */
const DAY_ROW_CLASS =
  'flex min-w-0 items-center gap-3 py-4 transition-colors outline-none hover:bg-muted/50 active:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden'

/** The condensed current-week band: done days check off, the next-up day
 *  carries the page's one volt action, remaining days link into the plan. */
async function ThisWeekBand({
  hero,
  heroData,
}: {
  hero: ProgramRowData
  heroData: HeroData
}) {
  const t = await getTranslations('Programs')
  const { rows, doneCount } = heroData.thisWeek
  // Deep-link grammar matches the detail page: ?week=N selects the week,
  // ?expand=<dayId> opens that day's targets (detail-view.parseExpandParam).
  const dayHref = (day: ProgramDayData) =>
    `/programs/${hero.id}?week=${heroData.currentWeek}&expand=${encodeURIComponent(day.id)}`
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
          {t('thisWeek.heading')}
        </h2>
        <span className="text-xs text-muted-foreground tnum">
          {t('thisWeek.doneCount', { done: doneCount, total: rows.length })}
        </span>
      </div>
      <DividerList className="mt-2">
        {rows.map(({ day, state }) => {
          if (state === 'done') {
            return (
              <li key={day.id}>
                <Link href={dayHref(day)} className={DAY_ROW_CLASS}>
                  <Check aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-base uppercase leading-tight tracking-wide text-muted-foreground">
                      {day.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t('thisWeek.done')}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                </Link>
              </li>
            )
          }
          if (state === 'next') {
            const summary = exerciseSummary(day)
            return (
              <li key={day.id} className="py-4">
                <span className="block truncate font-display text-2xl uppercase leading-tight tracking-wide">
                  {day.name}
                </span>
                {summary !== null && (
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {summary}
                  </span>
                )}
                {/* The page's one volt ACTION. A Link, not the StartDayButton
                    island: starting instantiates a workout row, and only the
                    detail page loads the live-session data its conflict guard
                    needs — an unguarded inline start could mint a second
                    active session. The detail page's next-up day is already
                    expanded with the guarded Start. */}
                {/* A LINK, labelled as one: it opens the detail (where the
                    conflict-guarded Start lives) rather than minting a
                    workout here. The label says so — a control reading
                    "Start" that navigates fails consistent identification
                    for voice-control and screen-reader users. */}
                <Link
                  href={`/programs/${hero.id}`}
                  className={cn(buttonVariants(), 'mt-3 h-12 w-full')}
                >
                  {t('thisWeek.startLink', { dayName: day.name })}
                </Link>
              </li>
            )
          }
          const summary = exerciseSummary(day)
          return (
            <li key={day.id}>
              <Link href={dayHref(day)} className={DAY_ROW_CLASS}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-base uppercase leading-tight tracking-wide">
                    {day.name}
                  </span>
                  {summary !== null && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {summary}
                    </span>
                  )}
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </Link>
            </li>
          )
        })}
      </DividerList>
    </section>
  )
}

/** One "Block so far" figure: display numeral over an 11px caps label. */
function BlockFigure({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      {/* No truncate: an ellipsized NUMBER is a wrong number — long localized
          volumes wrap instead. Label at text-xs: it is the numeral's only
          meaning-carrier, so it stays off the micro-caps floor. */}
      <div className="break-words font-display text-2xl leading-none tnum">{value}</div>
      <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
    </div>
  )
}

/** The block-so-far strip: hairline-bounded figures, no shells. All three
 *  figures fall out of already-loaded data (workouts + day count + week). */
async function BlockSoFarBand({
  hero,
  heroData,
  userId,
}: {
  hero: ProgramRowData
  heroData: HeroData
  userId: string
}) {
  const t = await getTranslations('Programs')
  const [unit, locale] = await Promise.all([
    // cache()-wrapped preference read — the only added data-layer call on
    // this page, reused verbatim from the stats route.
    getWeightUnit(userId),
    resolveLocale(),
  ])
  const { stats } = heroData
  const weeksLeft = Math.max(0, hero.mesocycleWeeks - heroData.currentWeek)
  return (
    <section className="mt-8">
      <h2 className="font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
        {t('blockSoFar.heading')}
      </h2>
      <div className="mt-3 flex items-end gap-8 border-b border-b-border/60 pb-4">
        <BlockFigure
          value={t('blockSoFar.daysDone', {
            done: stats.daysDone,
            planned: stats.daysPlanned,
          })}
          label={t('blockSoFar.daysLabel')}
        />
        <BlockFigure
          value={formatVolume(stats.volumeKg, unit, locale)}
          label={t('blockSoFar.volumeLabel')}
        />
        <BlockFigure value={String(weeksLeft)} label={t('blockSoFar.weeksLeftLabel')} />
      </div>
    </section>
  )
}

/** The quiet list row every non-hero program gets — a divider-list row
 *  (Things-3 shape): muted hairlines from the parent DividerList, no shell.
 *  Proposals keep the pending voice via the parent's DASHED variant — dashed
 *  still reads "not settled", but muted, because per-item volt on a list
 *  surface stacks (the #163 review precedent) and the "Needs your decision"
 *  zone heading already carries the ask. Drafts demote: smaller, muted names
 *  — unstarted plans shouldn't compete with live ones. */
async function ProgramRow({
  program,
  demoted = false,
}: {
  program: ProgramRowData
  demoted?: boolean
}) {
  const t = await getTranslations('Programs')
  const isProposed = program.status === 'proposed'
  // Middot-joined facts, not a sentence: each fact is its own whole ICU
  // message, so no translator is handed a dangling fragment.
  const meta = [
    program.deloadWeek !== null
      ? t('row.weeksDeload', {
          weeks: program.mesocycleWeeks,
          deloadWeek: program.deloadWeek,
        })
      : t('row.weeks', { weeks: program.mesocycleWeeks }),
    // Staleness affordance: a pending proposal wears its age as muted
    // words — never an auto-expiry.
    isProposed ? renderMessage(t, proposalAgeLine(program.createdAt, new Date())) : null,
  ]
    .filter((part) => part !== null)
    .join(' · ')
  return (
    <li>
      <Link
        href={`/programs/${program.id}`}
        className="flex min-w-0 items-center justify-between gap-4 py-4 transition-colors outline-none hover:bg-muted/50 active:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
      >
        <span className="min-w-0">
          <span
            className={cn(
              'flex min-w-0 items-baseline gap-2 font-display uppercase leading-tight tracking-wide',
              demoted ? 'text-base text-muted-foreground' : 'text-lg',
            )}
          >
            {program.icon !== null && (
              <span aria-hidden="true" className="shrink-0 text-base leading-none">
                {program.icon}
              </span>
            )}
            <span className="min-w-0 truncate">{program.name}</span>
          </span>
          <span className="mt-1 block text-xs text-muted-foreground tnum">
            {meta}
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  )
}

/** A zone heading — quiet, uppercase, the same voice everywhere; the count
 *  rides inside the message ("Drafts · 2") so translators own the joint. */
function ZoneHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-8 mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </h2>
  )
}

/** What the no-active-program page needs beyond the zones themselves. */
interface DoorsData {
  state: ReturnType<typeof noProgramState>
  templates: readonly TemplateListRow[]
  coachEnabled: boolean
}

/**
 * The activation doors — the way INTO training when nothing is in flight.
 * Three routes as peers, ordered by effort: adopt a proven program (named
 * entries inline, not a bare "browse" button — a real name and its shape is
 * what makes the choice), have the coach build one, or start from scratch.
 *
 * The coach sits in the fork as a peer option rather than a banner: an
 * option a user is choosing between is product surface, an interruption
 * selling the same thing is an ad. It states its tier plainly instead of
 * springing the gate after the tap, and it renders only where coach is
 * actually reachable (the server enforces the same gate).
 */
async function ActivationDoors({ doors }: { doors: DoorsData }) {
  const t = await getTranslations('Programs')
  return (
    <>
      {doors.templates.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
            {t('doors.libraryHeading')}
          </h2>
          <DividerList className="mt-1">
            {doors.templates.map((template) => (
              <DividerRow key={template.id} href={`/programs/templates/${template.id}`}>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex min-w-0 items-baseline gap-2">
                    {template.icon !== null && (
                      <span aria-hidden="true" className="shrink-0 text-sm leading-none">
                        {template.icon}
                      </span>
                    )}
                    <span className="min-w-0 truncate font-display text-lg uppercase leading-tight tracking-wide">
                      {template.name}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground tnum">
                    {t('doors.templateMeta', {
                      weeks: template.mesocycleWeeks,
                      days: template.days.length,
                    })}
                  </span>
                </span>
              </DividerRow>
            ))}
            <DividerRow href="/programs/templates">
              <span className="text-sm text-muted-foreground">{t('doors.libraryAll')}</span>
            </DividerRow>
          </DividerList>
        </section>
      )}

      {doors.coachEnabled && (
        <section className="mt-8">
          <h2 className="font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
            {t('doors.coachHeading')}
          </h2>
          <DividerList className="mt-1">
            <DividerRow href="/coach?context=program:new">
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex items-baseline gap-2">
                  <span className="font-display text-lg uppercase leading-tight tracking-wide">
                    {t('doors.coachName')}
                  </span>
                  {/* The tier as a muted WORD, not a chip: a label nobody can
                      press must not wear a control's shape. */}
                  <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {t('doors.coachTier')}
                  </span>
                </span>
                <span className="text-sm leading-snug text-muted-foreground">
                  {t('doors.coachBody')}
                </span>
              </span>
            </DividerRow>
          </DividerList>
        </section>
      )}

      <DividerList className="mt-8">
        <DividerRow href="/programs/new">
          <span className="text-sm">{t('doors.buildOwn')}</span>
        </DividerRow>
      </DividerList>
    </>
  )
}

export default async function ProgramsPage() {
  const t = await getTranslations('Programs')
  const userId = await requireUserId() // middleware also guards; defense-in-depth
  const programs = await listPrograms(userId)
  const zones = zonePrograms(programs)
  const hero = zones.hero
  const heroData = hero ? await loadHeroData(userId, hero) : null
  // Activation data — only the no-active-program path pays for it: the
  // curated library lead (small public table) and the coach gate (env
  // short-circuit, else a bounded flag lookup).
  const doors = hero
    ? null
    : await Promise.all([listTemplates(), isCoachEnabled(userId)]).then(
        ([templates, coachEnabled]) => ({
          state: noProgramState(zones),
          templates: templates.slice(0, 3),
          coachEnabled,
        }),
      )

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={t('title')}
        leading={<NavDrawer />}
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {/* No active program: the page is an ACTIVATION surface. The lede
            names the state honestly — cold start ("Day one.") or between
            blocks — while a pending proposal or a half-set-up draft leads
            with its own zone below instead of a headline. Shopping edge
            cases land here too: adopting a template mints a DRAFT, so the
            post-preview state is 'drafts', never a false cold start. */}
        {doors !== null && (doors.state === 'cold' || doors.state === 'archived') && (
          <div className="mt-12">
            <p className="font-display text-5xl uppercase leading-none tracking-wide text-primary">
              {doors.state === 'cold' ? t('empty.title') : t('empty.betweenTitle')}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {doors.state === 'cold' ? t('empty.description') : t('empty.betweenDescription')}
            </p>
          </div>
        )}
        {/* The active hero — keep-listed as shipped: the one commitment in
                flight gets the big "WK N OF M" numeral and the block map strip
                on the page's one quiet VOLT hairline, no shell. Its "Next:"
                status line moved DOWN into the this-week band (same fact, said
                once); the completion / no-days lines stay here because the
                band has no next-up row to carry them. */}
            {hero && (
              <Link
                href={`/programs/${hero.id}`}
                className="mt-6 block border-b border-b-primary/30 pb-5 transition-colors active:bg-muted/60"
              >
                <span className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-baseline gap-2 font-display text-xl uppercase leading-tight tracking-wide">
                    {hero.icon !== null && (
                      <span aria-hidden="true" className="shrink-0 text-lg leading-none">
                        {hero.icon}
                      </span>
                    )}
                    <span className="min-w-0 truncate">{hero.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
                    {renderMessage(t, programStatusLabel(hero.status)) ?? hero.status}
                  </span>
                </span>
                {heroData && (
                  <>
                    <span className="mt-4 flex items-baseline gap-2 font-display uppercase tracking-wide">
                      {t.rich('hero.weekPosition', {
                        week: heroData.currentWeek,
                        total: hero.mesocycleWeeks,
                        big: (chunks) => (
                          <span className="text-5xl leading-none tnum">{chunks}</span>
                        ),
                        small: (chunks) => (
                          <span className="text-xl leading-none text-muted-foreground tnum">
                            {chunks}
                          </span>
                        ),
                      })}
                    </span>
                    <BlockMap weeks={heroData.blockWeeks} size="compact" className="mt-3" />
                    {(heroData.blockComplete || heroData.thisWeek.rows.length === 0) && (
                      <span className="mt-3 block text-sm text-muted-foreground">
                        {heroData.blockComplete ? t('hero.blockComplete') : t('hero.noDays')}
                      </span>
                    )}
                  </>
                )}
              </Link>
            )}

            {/* The block dashboard: this week's days, the plan/settings door,
                and the block-so-far figures — all derived from the hero's
                already-paid reads. */}
            {hero && heroData && heroData.thisWeek.rows.length > 0 && (
              <ThisWeekBand hero={hero} heroData={heroData} />
            )}

            {hero && (
              <DividerList className="mt-6">
                <DividerRow href={`/programs/${hero.id}`}>
                  <span className="text-sm">{t('fullPlan')}</span>
                </DividerRow>
              </DividerList>
            )}

            {hero && heroData && (
              <BlockSoFarBand hero={hero} heroData={heroData} userId={userId} />
            )}

            {/* Creation, demoted: below the dashboard — starting something new
                is a secondary path once training is in flight. With no active
                program the activation doors carry these same two routes, so
                this row would only say them twice. */}
            {hero && (
              <div className="mt-6 flex gap-2">
                <Link
                  href="/programs/new"
                  className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}
                >
                  {t('newLink')}
                </Link>
                <Link
                  href="/programs/templates"
                  className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}
                >
                  {t('libraryLink')}
                </Link>
              </div>
            )}

            {/* Extra actives (nothing enforces a single one) stay near the
                top — they're still live commitments, just not the hero. */}
            {zones.otherActive.length > 0 && (
              <>
                <ZoneHeading>
                  {t('zone.withCount', {
                    label: t('zone.otherActive'),
                    count: zones.otherActive.length,
                  })}
                </ZoneHeading>
                <DividerList>
                  {zones.otherActive.map((program) => (
                    <ProgramRow key={program.id} program={program} />
                  ))}
                </DividerList>
              </>
            )}

            {/* Proposals lead the zones: they need a decision, and the dashed
                DividerList keeps the established "pending" voice. */}
            {zones.proposed.length > 0 && (
              <>
                <ZoneHeading>
                  {t('zone.withCount', {
                    label: t('zone.proposed'),
                    count: zones.proposed.length,
                  })}
                </ZoneHeading>
                <DividerList dashed>
                  {zones.proposed.map((program) => (
                    <ProgramRow key={program.id} program={program} />
                  ))}
                </DividerList>
              </>
            )}

            {zones.drafts.length > 0 && (
              <>
                <ZoneHeading>
                  {t('zone.withCount', { label: t('zone.drafts'), count: zones.drafts.length })}
                </ZoneHeading>
                <DividerList>
                  {zones.drafts.map((program) => (
                    <ProgramRow key={program.id} program={program} demoted />
                  ))}
                </DividerList>
              </>
            )}

            {/* The activation doors, in ONE position that reads correctly for
                every no-program state: after the zones that demand a decision
                (a pending proposal or a half-finished draft leads — they are
                the shortest path back to training), before the archived
                roll-up. On a cold start there are no zones, so the doors sit
                directly under the lede. */}
            {doors !== null && <ActivationDoors doors={doors} />}

            {/* Archived collapses to a count — past blocks are reference, not
                a scroll cost. Native details: no client island needed. */}
            {zones.archived.length > 0 && (
              <details className="group mt-8">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground [&::-webkit-details-marker]:hidden">
                  {t('archived.summary', { count: zones.archived.length })}
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 transition-transform group-open:rotate-90"
                  />
                </summary>
                <DividerList className="mt-2">
                  {zones.archived.map((program) => (
                    <ProgramRow key={program.id} program={program} />
                  ))}
                </DividerList>
              </details>
            )}
      </main>
    </div>
  )
}
