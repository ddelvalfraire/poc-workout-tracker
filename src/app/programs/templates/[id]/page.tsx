import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getAllExercises } from '@/lib/wger'
import { listPublicTemplates } from '@/lib/wger-templates'
import { mapWgerRoutineToProgram } from '@/lib/wger-template-map'
import { formatPlannedScheme, groupPlannedSets, plannedSetChips } from '@/lib/planned-set-format'
import { getWeightUnit } from '@/db/preferences'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { cn } from '@/lib/utils'
import { ImportTemplateButton } from '../import-button'
import { TemplatesUnavailable } from '../unavailable'
import { SystemTemplateDetail } from './system-template-detail'

/** wger routine ids are small positive integers; anything else is a bad URL. */
const TEMPLATE_ID_PATTERN = /^\d{1,9}$/
/** Curated system templates are programs rows — uuids. The two id shapes are
 *  disjoint, so one route serves both shelves. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * In-app detail for one wger public template — the browse card's missing
 * second half: the full program is readable here without navigating to wger.
 * The page renders the MAPPED shape, not wger's raw structure: exactly what
 * "Add to my programs" would create, so what you read is what you import
 * (same display-truth rule as the browse cards, one mapper for both). The
 * routine comes from the same daily-cached catalog pass the browse list uses;
 * a template outside that catalog — or one with nothing mappable — is a 404,
 * while an unreachable catalog degrades to the browse page's explanatory card.
 */
export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const userId = await requireUserId() // middleware also guards; defense-in-depth
  const { id } = await params
  // Curated branch: a uuid is a system template (db-backed detail + adopt).
  if (UUID_PATTERN.test(id)) return <SystemTemplateDetail templateId={id} userId={userId} />
  if (!TEMPLATE_ID_PATTERN.test(id)) notFound()
  const wgerId = Number(id)

  const result = await listPublicTemplates()
  if (!result.ok) {
    return (
      <div className="flex min-h-[100dvh] flex-col">
        <AppHeader
          title="Template"
          leading={
            <BackLink fallback="/programs/templates" />
          }
        />
        <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
          <TemplatesUnavailable reason={result.reason} />
        </main>
      </div>
    )
  }

  const routine = result.templates.find((t) => t.id === wgerId)
  if (!routine) notFound()

  const [exercises, unit] = await Promise.all([getAllExercises(), getWeightUnit(userId)])
  const catalog = new Map(exercises.map((e) => [e.id, e.name]))
  const mapped = mapWgerRoutineToProgram(routine, catalog)
  if (!mapped) notFound()

  const { input, skipped } = mapped
  const dayCount = input.days.length

  // Superset letters (A, B…) in order of first appearance — group NUMBERS are
  // plan-internal; letters are what a lifter reads (the logger's convention).
  const supersetLetters: Record<number, string> = {}
  let nextLetter = 0
  for (const day of input.days) {
    for (const exercise of day.exercises) {
      const group = exercise.supersetGroup
      if (typeof group === 'number' && supersetLetters[group] === undefined) {
        supersetLetters[group] = String.fromCharCode(65 + nextLetter++)
      }
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={input.name}
        leading={
          <BackLink fallback="/programs/templates" />
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {/* Article READ surface — the program detail page's visual language
            (icon + poster title + description lead), because this page shows
            the same object one step earlier in its life. */}
        <header className="mt-4">
          <p className="flex items-baseline gap-2">
            {typeof input.icon === 'string' && (
              <span aria-hidden="true" className="text-2xl leading-none">
                {input.icon}
              </span>
            )}
            <span className="min-w-0 truncate font-display text-3xl uppercase leading-none tracking-wide">
              {input.name}
            </span>
          </p>
          <p className="mt-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground tnum">
            {dayCount} {dayCount === 1 ? 'day' : 'days'}/week · {input.mesocycleWeeks}{' '}
            {input.mesocycleWeeks === 1 ? 'week' : 'weeks'}
          </p>
          {typeof input.description === 'string' && (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {input.description}
            </p>
          )}
        </header>

        {/* One CTA per surface (Arc D): the Add lives at the bottom, after
            the plan has made its case — no duplicate above the fold. */}
        <h2 className="mt-8 font-display text-xl uppercase leading-none tracking-wide">The plan</h2>
        {/* Hairline day sections (programs/[id] vocabulary): each day sits on
            a muted hairline, no shells — the preview reads like the detail
            page it becomes after import. */}
        <div className="mt-1">
          {input.days.map((day, dayIndex) => (
            <section key={dayIndex} className="border-b border-b-border/60 py-4">
              <h3 className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground tnum">
                  Day {dayIndex + 1}
                </span>
                <span className="min-w-0 truncate font-display text-lg uppercase leading-tight tracking-wide">
                  {day.name}
                </span>
              </h3>

              <div className="mt-3 space-y-3">
                {day.exercises.map((exercise, exerciseIndex) => {
                  const group = exercise.supersetGroup
                  const supersetLabel =
                    typeof group === 'number' ? supersetLetters[group] : undefined
                  const previousGroup = day.exercises[exerciseIndex - 1]?.supersetGroup
                  const startsSuperset = supersetLabel !== undefined && previousGroup !== group
                  return (
                    <div
                      key={exerciseIndex}
                      className={cn(
                        // Muted rail = grouping is structure, not a live
                        // state (the logger's superset treatment).
                        supersetLabel !== undefined &&
                          'border-l-2 border-l-muted-foreground/40 pl-3',
                      )}
                    >
                      {startsSuperset && (
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                          Superset {supersetLabel}
                        </p>
                      )}
                      <p className="text-sm font-medium">{exercise.name}</p>
                      <div className="mt-1 space-y-0.5">
                        {groupPlannedSets(exercise.sets).map((run, runIndex) => (
                          <p
                            key={runIndex}
                            className="flex items-baseline gap-2 text-sm text-muted-foreground"
                          >
                            <span className="tnum">
                              {formatPlannedScheme(run.set, run.count, unit)}
                            </span>
                            {/* Chips → words: set qualifiers are labels on
                                the line, not controls — quiet caps text, no
                                pill shell (programs/[id] target-line rule). */}
                            {plannedSetChips(run.set).map((chip) => (
                              <span
                                key={chip}
                                className="text-[10px] font-semibold uppercase tracking-widest tnum"
                              >
                                {chip}
                              </span>
                            ))}
                          </p>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        {/* The mapper's honesty ledger: what an import would drop and why.
            Quiet — a skipped accessory must not read like an error. */}
        {skipped.length > 0 && (
          <section aria-label="Not included" className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Couldn&apos;t map
            </p>
            <ul className="mt-1.5 space-y-1">
              {skipped.map((note) => (
                <li key={note} className="text-sm text-muted-foreground">
                  {note}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-8">
          <ImportTemplateButton templateId={wgerId} />
        </div>

        {/* Attribution footer — a licensing requirement (wger content is CC),
            demoted from the browse card's action row to quiet small print. */}
        {typeof input.sourceUrl === 'string' && (
          <p className="mt-6 pb-2 text-xs text-muted-foreground">
            From the wger community ·{' '}
            <a
              href={input.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2 transition-colors hover:text-foreground"
            >
              View on wger
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          </p>
        )}
      </main>
    </div>
  )
}
