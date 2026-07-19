import Link from 'next/link'
import { ChevronLeft, ExternalLink } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getAllExercises } from '@/lib/wger'
import { listPublicTemplates, type TemplatesUnavailableReason } from '@/lib/wger-templates'
import { mapWgerRoutineToProgram, type MappedTemplate } from '@/lib/wger-template-map'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ImportTemplateButton } from './import-button'

/** One browse card's data: the wger id plus what the import would create. */
interface TemplateCard {
  wgerId: number
  mapped: MappedTemplate
}

const UNAVAILABLE_COPY: Record<TemplatesUnavailableReason, { title: string; body: string }> = {
  unconfigured: {
    title: 'Template browsing is not configured',
    body: 'Connecting to the wger template catalog needs a WGER_API_KEY. Add one and reload.',
  },
  unavailable: {
    title: 'wger is not answering right now',
    body: 'The template catalog could not be loaded. Try again in a minute.',
  },
}

/**
 * Browse wger's public routine templates and add them to your own programs.
 * Cards show exactly what the import would create (the mapper runs here, so
 * the shown day count can never disagree with the imported plan); templates
 * with nothing mappable are hidden. Detail lives on wger — the attribution
 * link — not on a template page of ours: importing lands on the program page,
 * which already reads like an article and is where edit/activate live.
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
          <Link
            href="/programs"
            aria-label="Back"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ml-2')}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <p className="mt-6 text-sm text-muted-foreground">
          Ready-made plans from the wger community. Adding one makes it your own draft — edit
          anything, then activate.
        </p>

        {!result.ok ? (
          <div className="mt-6 rounded-2xl border border-border bg-card px-5 py-12 text-center">
            <p className="font-medium">{UNAVAILABLE_COPY[result.reason].title}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {UNAVAILABLE_COPY[result.reason].body}
            </p>
          </div>
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
                  <div className="flex items-baseline gap-2 font-display text-xl uppercase leading-tight tracking-wide">
                    {typeof input.icon === 'string' && (
                      <span aria-hidden="true" className="shrink-0 text-lg leading-none">
                        {input.icon}
                      </span>
                    )}
                    <span className="min-w-0 truncate">{input.name}</span>
                  </div>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {dayCount} {dayCount === 1 ? 'day' : 'days'} · {input.mesocycleWeeks}{' '}
                    {input.mesocycleWeeks === 1 ? 'week' : 'weeks'}
                  </p>
                  {typeof input.description === 'string' && (
                    <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">
                      {input.description}
                    </p>
                  )}
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
