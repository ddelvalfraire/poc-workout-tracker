import Link from 'next/link'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getAllExercises } from '@/lib/wger'
import { listPublicTemplates } from '@/lib/wger-templates'
import { mapWgerRoutineToProgram, type MappedTemplate } from '@/lib/wger-template-map'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { ImportTemplateButton } from './import-button'
import { TemplatesUnavailableCard } from './unavailable'

/** One browse card's data: the wger id plus what the import would create. */
interface TemplateCard {
  wgerId: number
  mapped: MappedTemplate
}

/**
 * Browse wger's public routine templates and add them to your own programs.
 * Cards show exactly what the import would create (the mapper runs here, so
 * the shown day count can never disagree with the imported plan); templates
 * with nothing mappable are hidden. Each card body links to the in-app
 * detail (`/programs/templates/[id]`) so the full plan is readable without
 * navigating to wger, while Add stays one tap away on the card itself.
 * Upstream calls ride the fetch layer's 1-day Data Cache; the page itself is
 * dynamic (requireUserId), which is fine — wger is not re-hit per view.
 */
export default async function TemplatesPage() {
  await requireUserId() // middleware also guards; defense-in-depth

  const result = await listPublicTemplates()
  let cards: TemplateCard[] = []
  if (result.ok) {
    const exercises = await getAllExercises()
    const catalog = new Map(exercises.map((e) => [e.id, e.name]))
    cards = result.templates.flatMap((routine) => {
      const mapped = mapWgerRoutineToProgram(routine, catalog)
      return mapped ? [{ wgerId: routine.id, mapped }] : []
    })
  }

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
          <ul className="mt-6 space-y-3">
            {cards.map(({ wgerId, mapped }) => {
              const { input } = mapped
              const dayCount = input.days.length
              return (
                <li key={wgerId} className="rounded-2xl border border-border bg-card p-5">
                  {/* The card body IS the link (programs-list convention:
                      content + trailing chevron); the action row below stays
                      outside it so Add doesn't nest inside an anchor. */}
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
                      <span className="mt-1 block text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        {dayCount} {dayCount === 1 ? 'day' : 'days'} · {input.mesocycleWeeks}{' '}
                        {input.mesocycleWeeks === 1 ? 'week' : 'weeks'}
                      </span>
                      {typeof input.description === 'string' && (
                        <span className="mt-3 line-clamp-3 block text-sm text-muted-foreground">
                          {input.description}
                        </span>
                      )}
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="mt-1 size-5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                    />
                  </Link>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <ImportTemplateButton templateId={wgerId} />
                    {typeof input.sourceUrl === 'string' && (
                      <a
                        href={input.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                      >
                        View on wger
                        <ExternalLink aria-hidden="true" className="size-3" />
                      </a>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}
