import Link from 'next/link'
import { ArrowRight, ChevronRight } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getAllExercises } from '@/lib/wger'
import { listPublicTemplates } from '@/lib/wger-templates'
import { mapWgerRoutineToProgram } from '@/lib/wger-template-map'
import {
  dayNameChips,
  findAdoptedProgram,
  groupByDaysPerWeek,
  type ShelfCard,
} from '@/lib/wger-template-shelf'
import { listPrograms } from '@/db/programs'
import { listTemplates } from '@/db/templates'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { DividerList } from '@/components/ui/divider-list'
import { EmptyWords } from '@/components/ui/empty-words'
import { ImportTemplateButton } from './import-button'
import { TemplatesUnavailable } from './unavailable'
import { getTranslations } from 'next-intl/server'

/**
 * Browse wger's public routine templates and add them to your own programs.
 * The shelf is zoned by commitment level (days/week — the first question a
 * lifter asks of a plan), cards lead with day-name chips over one line of
 * prose, and a template the user already imported says so ("In your
 * programs →", matched on the stored attribution URL — see
 * lib/wger-template-shelf.ts) instead of offering a second Add. One CTA per
 * card; wger attribution lives on the detail page's footer. Cards show
 * exactly what the import would create (the mapper runs here, so the shown
 * day count can never disagree with the imported plan); templates with
 * nothing mappable are hidden. Upstream calls ride the fetch layer's 1-day
 * Data Cache; the page itself is dynamic (requireUserId), which is fine —
 * wger is not re-hit per view.
 */
export default async function TemplatesPage() {
  const t = await getTranslations('ProgramTemplates')
  const userId = await requireUserId() // middleware also guards; defense-in-depth

  // Curated system templates (db-backed, seeded) lead the shelf; the wger
  // community shelf follows. An unseeded environment returns [] and the
  // section simply doesn't render.
  const curated = await listTemplates()

  const result = await listPublicTemplates()
  let cards: ShelfCard[] = []
  if (result.ok) {
    const exercises = await getAllExercises()
    const catalog = new Map(exercises.map((e) => [e.id, e.name]))
    cards = result.templates.flatMap((routine) => {
      const mapped = mapWgerRoutineToProgram(routine, catalog)
      return mapped ? [{ wgerId: routine.id, mapped }] : []
    })
  }
  // Adopted matching reads the programs list the user already owns — one
  // indexed scan, only when there are cards to match against.
  const programs = cards.length > 0 ? await listPrograms(userId) : []
  const groups = groupByDaysPerWeek(cards)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={t('title')}
        leading={
          <BackLink fallback="/programs" />
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <p className="mt-6 text-sm text-muted-foreground">
          {t('lede')}
        </p>

        {curated.length > 0 && (
          <section className="mt-6">
            {/* The curated zone leads the shelf: the classics, not a
                commitment bucket, so the header names the collection. */}
            <h2 className="font-display text-xl uppercase leading-none tracking-wide">
              {t('curated.title')}
              <span className="ml-2 text-sm tracking-widest text-muted-foreground">{t('curated.tag')}</span>
            </h2>
            {/* Divider rows, not card shells — the wger rows' vocabulary.
                The whole row is the link; the volt CTA lives on the detail
                page (one volt per surface). */}
            <DividerList className="mt-1">
              {curated.map((template) => (
                <li key={template.id} className="py-4">
                  <Link
                    href={`/programs/templates/${template.id}`}
                    className="group flex min-w-0 items-start justify-between gap-3 outline-none focus-visible:bg-muted/50"
                  >
                    <span className="min-w-0">
                      <span className="flex items-baseline gap-2 font-display text-xl uppercase leading-tight tracking-wide">
                        {template.icon !== null && (
                          <span aria-hidden="true" className="shrink-0 text-lg leading-none">
                            {template.icon}
                          </span>
                        )}
                        <span className="min-w-0 truncate">{template.name}</span>
                      </span>
                      <span className="mt-1 block text-xs font-semibold uppercase tracking-widest text-muted-foreground tnum">
                        {t('curated.meta', {
                          days: template.days.length,
                          weeks: template.mesocycleWeeks,
                        })}
                      </span>
                      {template.days.length > 0 && (
                        <span className="mt-1.5 block text-sm text-muted-foreground">
                          {template.days.map((d) => d.name).join(' · ')}
                        </span>
                      )}
                      {template.description !== null && (
                        <span className="mt-1 line-clamp-1 block text-sm text-muted-foreground">
                          {template.description}
                        </span>
                      )}
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="mt-1 size-5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground group-focus-visible:text-foreground"
                    />
                  </Link>
                </li>
              ))}
            </DividerList>
          </section>
        )}

        {!result.ok ? (
          <TemplatesUnavailable reason={result.reason} />
        ) : cards.length === 0 ? (
          <EmptyWords className="mt-6">
            {t('empty')}
          </EmptyWords>
        ) : (
          groups.map((group) => (
            <section key={group.daysPerWeek} className="mt-8 first-of-type:mt-6">
              {/* Commitment zone header — the shelf's organizing question. */}
              <h2 className="font-display text-xl uppercase leading-none tracking-wide">
                {group.label}
                <span className="ml-2 text-sm tracking-widest text-muted-foreground">{t('group.tag')}</span>
              </h2>
              {/* Divider rows, not card shells: name + facts + chevron per
                  row, hairlines between and a closing hairline under the
                  group. Day names are metadata, so they read as muted words
                  (chips are controls, words are labels) — the same facts the
                  old chips carried. */}
              <DividerList className="mt-1">
                {group.cards.map(({ wgerId, mapped }) => {
                  const { input } = mapped
                  const chips = dayNameChips(input)
                  const adopted = findAdoptedProgram(programs, input.sourceUrl)
                  return (
                    <li key={wgerId} className="py-4">
                      {/* The row body IS the link (divider-row convention:
                          content + trailing chevron); the action row below
                          stays outside it so the CTA doesn't nest in an anchor. */}
                      <Link
                        href={`/programs/templates/${wgerId}`}
                        className="group flex min-w-0 items-start justify-between gap-3 outline-none focus-visible:bg-muted/50"
                      >
                        <span className="min-w-0">
                          <span className="flex items-baseline gap-2 font-display text-xl uppercase leading-tight tracking-wide">
                            {typeof input.icon === 'string' && (
                              <span aria-hidden="true" className="shrink-0 text-lg leading-none">
                                {input.icon}
                              </span>
                            )}
                            <span className="min-w-0 truncate">{input.name}</span>
                          </span>
                          <span className="mt-1 block text-xs font-semibold uppercase tracking-widest text-muted-foreground tnum">
                            {t('group.weeks', { weeks: input.mesocycleWeeks ?? 1 })}
                          </span>
                          {chips.length > 0 && (
                            <span className="mt-1.5 block text-sm text-muted-foreground">
                              {chips.join(' · ')}
                            </span>
                          )}
                          {typeof input.description === 'string' && (
                            <span className="mt-1 line-clamp-1 block text-sm text-muted-foreground">
                              {input.description}
                            </span>
                          )}
                        </span>
                        <ChevronRight
                          aria-hidden="true"
                          className="mt-1 size-5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground group-focus-visible:text-foreground"
                        />
                      </Link>
                      <div className="mt-3">
                        {adopted !== null ? (
                          <Link
                            href={`/programs/${adopted.id}`}
                            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-2 hover:underline"
                          >
                            {t('adoptedLink')}
                            <ArrowRight aria-hidden="true" className="size-4" />
                          </Link>
                        ) : (
                          <ImportTemplateButton templateId={wgerId} />
                        )}
                      </div>
                    </li>
                  )
                })}
              </DividerList>
            </section>
          ))
        )}
      </main>
    </div>
  )
}
