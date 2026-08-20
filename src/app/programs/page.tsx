import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import {
  listPrograms,
  getProgramDetail,
  getNextProgramDay,
  listProgramWorkouts,
  programWeekState,
} from '@/db/programs'
import { AppHeader } from '@/components/app-header'
import { BlockMap } from '@/components/block-map'
import { buildBlockWeeks, type BlockWeek } from '@/components/block-weeks'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { NavDrawer } from '@/components/nav/nav-drawer'
import { zonePrograms, programStatusLabel, proposalAgeLine } from './list-view'
import { renderMessage } from '@/lib/message'
import { getTranslations } from 'next-intl/server'

/** The list-row program shape (listPrograms row). */
type ProgramRowData = Awaited<ReturnType<typeof listPrograms>>[number]

/** Everything the active-hero card renders beyond the program row itself. */
interface HeroData {
  currentWeek: number
  blockComplete: boolean
  blockWeeks: BlockWeek[]
  /** "Next: Day 2 · Legs" — null when there's nothing to suggest. */
  nextLine: string | null
}

/**
 * The hero's extra reads, for ONE program only (the most recent active).
 * Cost, documented per the list-hero decision: getProgramDetail (day
 * ids/names for the day count + "Day N" index), listProgramWorkouts (the
 * block map's fill), and getNextProgramDay (cache()-wrapped — free if this
 * request already derived it, one derivation otherwise; it carries
 * currentWeek + blockComplete so programWeekState is only the fallback when
 * the active program has no derivable next day).
 */
async function loadHeroData(userId: string, program: ProgramRowData): Promise<HeroData | null> {
  const t = await getTranslations('Programs')
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
  const dayIndex = next ? detail.days.findIndex((d) => d.id === next.dayId) : -1
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
    nextLine: next
      ? dayIndex >= 0
        ? t('hero.nextWithDay', { position: dayIndex + 1, dayName: next.dayName })
        : t('hero.next', { dayName: next.dayName })
      : null,
  }
}

/** The quiet list row every non-hero program gets — a divider row (Things-3
 *  shape): muted hairline, no shell. Proposals keep the pending voice as a
 *  DASHED hairline — dashed still reads "not settled", but muted, because
 *  per-item volt on a list surface stacks (the #163 review precedent) and
 *  the "Needs your decision" zone heading already carries the ask. */
async function ProgramRow({ program }: { program: ProgramRowData }) {
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
        className={cn(
          'flex min-w-0 items-center justify-between gap-4 border-b py-4 transition-colors active:bg-muted/60',
          isProposed ? 'border-dashed border-b-border' : 'border-b-border/60',
        )}
      >
        <span className="min-w-0">
          <span className="flex min-w-0 items-baseline gap-2 font-display text-lg uppercase leading-tight tracking-wide">
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

/** A zone heading — quiet, uppercase, the same voice everywhere. */
function ZoneHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-8 mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </h2>
  )
}

export default async function ProgramsPage() {
  const t = await getTranslations('Programs')
  const userId = await requireUserId() // middleware also guards; defense-in-depth
  const programs = await listPrograms(userId)
  const zones = zonePrograms(programs)
  const hero = zones.hero
  const heroData = hero ? await loadHeroData(userId, hero) : null

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={t('title')}
        leading={<NavDrawer />}
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {/* Empty state = invitation, not apology: the editorial volt moment
            owns the screen and the CTAs live inside it — no duplicate button
            stack above. */}
        {programs.length === 0 ? (
          <div className="mt-12">
            <p className="font-display text-5xl uppercase leading-none tracking-wide text-primary">
              {t('empty.title')}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {t('empty.description')}
            </p>
            <Link
              href="/programs/new"
              className={cn(
                buttonVariants({ size: 'lg' }),
                'mt-6 w-full text-base font-semibold uppercase tracking-wide',
              )}
            >
              {t('empty.newLink')}
            </Link>
            <Link
              href="/programs/templates"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'mt-3 w-full')}
            >
              {t('empty.templatesLink')}
            </Link>
          </div>
        ) : (
          <>
            {/* The active hero: the one commitment in flight gets the big
                "WK N OF M" numeral, the block map strip, and the next-day
                status line. It is the page's primary object — creation CTAs
                demote to a compact row beneath it. */}
            {hero && (
              /* De-carded (summary grammar): the hero sits on the page's one
                 quiet VOLT hairline — the single live element the screen gets
                 — with no shell; scale and the block map carry the weight. */
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
                    <span className="mt-3 block text-sm text-muted-foreground">
                      {heroData.blockComplete
                        ? t('hero.blockComplete')
                        : (heroData.nextLine ?? t('hero.noDays'))}
                    </span>
                  </>
                )}
              </Link>
            )}

            {/* Creation, demoted: below the hero when one exists, compact
                side-by-side row either way — starting something new is a
                secondary path once training is in flight. */}
            <div className={cn('flex gap-2', hero ? 'mt-3' : 'mt-6')}>
              <Link
                href="/programs/new"
                className={cn(buttonVariants({ variant: hero ? 'outline' : 'default' }), 'flex-1')}
              >
                {t('newLink')}
              </Link>
              <Link
                href="/programs/templates"
                className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}
              >
                {t('templatesLink')}
              </Link>
            </div>

            {/* Extra actives (nothing enforces a single one) stay near the
                top — they're still live commitments, just not the hero. */}
            {zones.otherActive.length > 0 && (
              <>
                <ZoneHeading>{t('zone.otherActive')}</ZoneHeading>
                <ul>
                  {zones.otherActive.map((program) => (
                    <ProgramRow key={program.id} program={program} />
                  ))}
                </ul>
              </>
            )}

            {/* Proposals lead the zones: they need a decision, and the
                dashed-volt border keeps the established "pending" voice. */}
            {zones.proposed.length > 0 && (
              <>
                <ZoneHeading>{t('zone.proposed')}</ZoneHeading>
                <ul>
                  {zones.proposed.map((program) => (
                    <ProgramRow key={program.id} program={program} />
                  ))}
                </ul>
              </>
            )}

            {zones.drafts.length > 0 && (
              <>
                <ZoneHeading>{t('zone.drafts')}</ZoneHeading>
                <ul>
                  {zones.drafts.map((program) => (
                    <ProgramRow key={program.id} program={program} />
                  ))}
                </ul>
              </>
            )}

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
                <ul className="mt-2">
                  {zones.archived.map((program) => (
                    <ProgramRow key={program.id} program={program} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </main>
    </div>
  )
}
