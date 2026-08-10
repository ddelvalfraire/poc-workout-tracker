import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { getTemplate } from '@/db/templates'
import { getWeightUnit } from '@/db/preferences'
import { formatPlannedScheme, groupPlannedSets, plannedSetChips } from '@/lib/planned-set-format'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { cn } from '@/lib/utils'
import { UseTemplateButton } from '../use-template-button'

/**
 * Detail surface for one CURATED system template — the uuid branch of
 * /programs/templates/[id] (numeric ids stay the wger flow). Renders the
 * article treatment the wger detail established (icon + poster title +
 * description lead, hairline day sections, one volt CTA at the bottom): the
 * same object one step earlier in its life, so the preview reads like the
 * program page it becomes after "Use this program". Set lines ride the same
 * `planned-set-format` grammar — a stored program set row carries every field
 * a planned shape reads, so what you see is exactly what adoption copies.
 */
export async function SystemTemplateDetail({
  templateId,
  userId,
}: {
  templateId: string
  userId: string
}) {
  const [detail, unit] = await Promise.all([
    getTemplate(userId, templateId),
    getWeightUnit(userId),
  ])
  if (!detail) notFound()

  const dayCount = detail.days.length

  // Superset letters (A, B…) in order of first appearance — the logger's
  // convention, same as the wger detail.
  const supersetLetters: Record<number, string> = {}
  let nextLetter = 0
  for (const day of detail.days) {
    for (const exercise of day.exercises) {
      const group = exercise.supersetGroup
      if (typeof group === 'number' && supersetLetters[group] === undefined) {
        supersetLetters[group] = String.fromCharCode(65 + nextLetter++)
      }
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader title={detail.name} leading={<BackLink fallback="/programs/templates" />} />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <header className="mt-4">
          <p className="flex items-baseline gap-2">
            {detail.icon !== null && (
              <span aria-hidden="true" className="text-2xl leading-none">
                {detail.icon}
              </span>
            )}
            <span className="min-w-0 truncate font-display text-3xl uppercase leading-none tracking-wide">
              {detail.name}
            </span>
          </p>
          <p className="mt-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground tnum">
            {dayCount} {dayCount === 1 ? 'day' : 'days'}/week · {detail.mesocycleWeeks}{' '}
            {detail.mesocycleWeeks === 1 ? 'week' : 'weeks'}
            {detail.deloadWeek !== null && <> · deload wk {detail.deloadWeek}</>}
          </p>
          {detail.description !== null && (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {detail.description}
            </p>
          )}
        </header>

        <h2 className="mt-8 font-display text-xl uppercase leading-none tracking-wide">The plan</h2>
        {/* Hairline day sections (programs/[id] vocabulary): each day on a
            muted hairline, no shells. */}
        <div className="mt-1">
          {detail.days.map((day, dayIndex) => (
            <section key={day.id} className="border-b border-b-border/60 py-4">
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
                      key={exercise.id}
                      className={cn(
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

        <div className="mt-8">
          <UseTemplateButton templateId={detail.id} />
        </div>

        {detail.sourceUrl !== null && (
          <p className="mt-6 pb-2 text-xs text-muted-foreground">
            About this program ·{' '}
            <a
              href={detail.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2 transition-colors hover:text-foreground"
            >
              View source
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          </p>
        )}
      </main>
    </div>
  )
}
