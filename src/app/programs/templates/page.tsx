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
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { ImportTemplateButton } from './import-button'
import { TemplatesUnavailableCard } from './unavailable'

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
  const userId = await requireUserId() // middleware also guards; defense-in-depth

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
        title="Templates"
        leading={
          <BackLink fallback="/programs" />
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <p className="mt-6 text-sm text-muted-foreground">
          Ready-made plans from the wger community. Adding one makes it your own draft — edit
          anything, then activate.
        </p>

        {!result.ok ? (
          <TemplatesUnavailableCard reason={result.reason} />
        ) : cards.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-border bg-card px-5 py-12 text-center">
            <p className="font-medium">No templates to show</p>
            <p className="mt-1 text-sm text-muted-foreground">
              wger has no importable public templates right now. Check back later.
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.daysPerWeek} className="mt-8 first-of-type:mt-6">
              {/* Commitment zone header — the shelf's organizing question. */}
              <h2 className="font-display text-xl uppercase leading-none tracking-wide">
                {group.label}
                <span className="ml-2 text-sm tracking-widest text-muted-foreground">/ week</span>
              </h2>
              <ul className="mt-3 space-y-3">
                {group.cards.map(({ wgerId, mapped }) => {
                  const { input } = mapped
                  const chips = dayNameChips(input)
                  const adopted = findAdoptedProgram(programs, input.sourceUrl)
                  return (
                    <li key={wgerId} className="rounded-2xl border border-border bg-card p-5">
                      {/* The card body IS the link (programs-list convention:
                          content + trailing chevron); the action row below
                          stays outside it so the CTA doesn't nest in an anchor. */}
                      <Link
                        href={`/programs/templates/${wgerId}`}
                        className="group flex min-w-0 items-start justify-between gap-3"
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
                            {input.mesocycleWeeks} {input.mesocycleWeeks === 1 ? 'week' : 'weeks'}
                          </span>
                          {chips.length > 0 && (
                            <span className="mt-3 flex flex-wrap gap-1.5">
                              {chips.map((chip, chipIndex) => (
                                <span
                                  key={`${chipIndex}:${chip}`}
                                  className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
                                >
                                  {chip}
                                </span>
                              ))}
                            </span>
                          )}
                          {typeof input.description === 'string' && (
                            <span className="mt-2 line-clamp-1 block text-sm text-muted-foreground">
                              {input.description}
                            </span>
                          )}
                        </span>
                        <ChevronRight
                          aria-hidden="true"
                          className="mt-1 size-5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                        />
                      </Link>
                      <div className="mt-4">
                        {adopted !== null ? (
                          <Link
                            href={`/programs/${adopted.id}`}
                            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-2 hover:underline"
                          >
                            In your programs
                            <ArrowRight aria-hidden="true" className="size-4" />
                          </Link>
                        ) : (
                          <ImportTemplateButton templateId={wgerId} />
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </main>
    </div>
  )
}
