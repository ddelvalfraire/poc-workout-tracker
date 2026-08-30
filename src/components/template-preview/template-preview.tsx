import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronRight } from 'lucide-react'
import { BlockMap } from '@/components/programs/block-map'
import { buildBlockWeeks } from '@/components/programs/block-weeks'
import {
  formatPlannedScheme,
  groupPlannedSets,
  plannedSetChips,
  type PlannedSetShape,
} from '@/lib/planned-set-format'
import type { WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'

/** One exercise as both template shelves (curated db rows, mapped wger) emit it. */
export interface TemplatePreviewExercise {
  key: string
  name: string
  supersetGroup: number | null | undefined
  sets: readonly PlannedSetShape[]
}

export interface TemplatePreviewDay {
  key: string
  name: string
  exercises: readonly TemplatePreviewExercise[]
}

export interface TemplatePreviewProps {
  name: string
  icon: string | null
  description: string | null
  mesocycleWeeks: number
  deloadWeek: number | null
  days: readonly TemplatePreviewDay[]
  unit: WeightUnit
  /** The adopt island (UseTemplateButton / ImportTemplateButton) — rendered
   *  inside the sticky bottom bar, full width. */
  cta: ReactNode
  /** Quiet footnotes above the CTA bar (skipped ledger, attribution). */
  footer?: ReactNode
}

/**
 * The shared template preview — ONE body for both shelves of
 * /programs/templates/[id] (curated uuid branch and wger numeric branch),
 * replacing two near-identical page bodies. The pitch structure, in reading
 * order:
 *
 * 1. **Fact strip** — weeks / days-per-week / exercises-per-day as hero
 *    numerals. Commitment is the buying decision, so it is the largest text
 *    on the surface, not a 12px caps afterthought.
 * 2. **Block map** — the same strip the program detail renders after
 *    adoption (deload weeks hollow + DL), so the shape you preview is the
 *    shape you live in.
 * 3. **The plan, day 1 fully** — the first day carries the detail page's
 *    next-up register; later days collapse to summary rows that expand in
 *    place (`<details>`, server-rendered — everything stays browsable, no
 *    teaser gating).
 * 4. **About** — the description as readable body text, after the plan has
 *    made its case.
 * 5. **Sticky start bar** — the one volt moment, always a thumb's reach away
 *    (DESIGN.md's bottom action bar), with a commitment-lowering hint.
 */
export function TemplatePreview({
  name,
  icon,
  description,
  mesocycleWeeks,
  deloadWeek,
  days,
  unit,
  cta,
  footer,
}: TemplatePreviewProps) {
  const t = useTranslations('TemplatePreview')

  const dayCount = days.length
  const exerciseTotal = days.reduce((sum, day) => sum + day.exercises.length, 0)
  const exercisesPerDay = dayCount > 0 ? Math.round(exerciseTotal / dayCount) : 0

  // Preview = a program before any training: every segment empty, no current
  // week. buildBlockWeeks is the detail page's own derivation, fed no workouts.
  const blockWeeks = buildBlockWeeks({
    mesocycleWeeks,
    deloadWeek,
    currentWeek: 0,
    dayCountTotal: dayCount,
    workouts: [],
  })

  // Superset letters (A, B…) in order of first appearance — group NUMBERS are
  // plan-internal; letters are what a lifter reads (the logger's convention).
  const supersetLetters: Record<number, string> = {}
  let nextLetter = 0
  for (const day of days) {
    for (const exercise of day.exercises) {
      const group = exercise.supersetGroup
      if (typeof group === 'number' && supersetLetters[group] === undefined) {
        supersetLetters[group] = String.fromCharCode(65 + nextLetter++)
      }
    }
  }

  function exerciseList(day: TemplatePreviewDay) {
    return (
      <div className="mt-3 space-y-3">
        {day.exercises.map((exercise, exerciseIndex) => {
          const group = exercise.supersetGroup
          const supersetLabel = typeof group === 'number' ? supersetLetters[group] : undefined
          const previousGroup = day.exercises[exerciseIndex - 1]?.supersetGroup
          const startsSuperset = supersetLabel !== undefined && previousGroup !== group
          return (
            <div
              key={exercise.key}
              className={cn(
                // Muted rail = grouping is structure, not a live state (the
                // logger's superset treatment).
                supersetLabel !== undefined && 'border-l-2 border-l-muted-foreground/40 pl-3',
              )}
            >
              {startsSuperset && (
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t('supersetLabel', { letter: supersetLabel })}
                </p>
              )}
              <p className="text-sm font-medium">{exercise.name}</p>
              <div className="mt-1 space-y-0.5">
                {groupPlannedSets(exercise.sets).map((run, runIndex) => (
                  <p
                    key={runIndex}
                    className="flex items-baseline gap-2 text-sm text-muted-foreground"
                  >
                    <span className="tnum">{formatPlannedScheme(run.set, run.count, unit)}</span>
                    {/* Chips → words: set qualifiers are labels on the line,
                        not controls — quiet caps text, no pill shell. */}
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
    )
  }

  const [firstDay, ...restDays] = days

  return (
    <>
      {/* Identity — poster title, no meta caps line: the facts moved up. */}
      <header className="mt-4">
        <p className="flex items-baseline gap-2">
          {icon !== null && (
            <span aria-hidden="true" className="text-2xl leading-none">
              {icon}
            </span>
          )}
          <span className="min-w-0 truncate font-display text-3xl uppercase leading-none tracking-wide">
            {name}
          </span>
        </p>
      </header>

      {/* Fact strip — the commitment, at hero scale (text-5xl is a recorded
          token as of the type-scale extension; one numeral register per
          screen, shared across the three figures). */}
      {/* dt precedes dd per the dl content model; flex-col-reverse keeps the
          numeral visually on top without inverting the semantics. */}
      <dl className="mt-5 flex gap-9 border-y border-y-border/60 py-4">
        <div className="flex flex-col-reverse gap-1.5">
          <dt className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('factWeeks')}
          </dt>
          <dd className="font-display text-5xl leading-none tnum">{mesocycleWeeks}</dd>
        </div>
        <div className="flex flex-col-reverse gap-1.5">
          <dt className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('factDaysPerWeek')}
          </dt>
          <dd className="font-display text-5xl leading-none tnum">{dayCount}</dd>
        </div>
        <div className="flex flex-col-reverse gap-1.5">
          <dt className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('factExercisesPerDay')}
          </dt>
          <dd className="font-display text-5xl leading-none tnum">{exercisesPerDay}</dd>
        </div>
      </dl>

      {/* The program's shape, pre-adoption — identical grammar to the detail
          page's strip (deload hollow + DL), read-only. */}
      <div className="mt-4">
        <BlockMap weeks={blockWeeks} size="default" />
      </div>

      <h2 className="mt-8 font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
        {t('planTitle')}
      </h2>

      {/* Day 1: the next-up register — fully expanded, nothing to tap. */}
      {firstDay !== undefined && (
        <section className="border-b border-b-border/60 py-4">
          <h3 className="flex min-w-0 items-baseline justify-between gap-4">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground tnum">
                {t('dayNumber', { position: 1 })}
              </span>
              <span className="min-w-0 truncate font-display text-2xl uppercase leading-tight tracking-wide">
                {firstDay.name}
              </span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tnum">
              {t('exerciseCount', { count: firstDay.exercises.length })}
            </span>
          </h3>
          {exerciseList(firstDay)}
        </section>
      )}

      {/* Later days: summary rows that expand in place. Server-rendered
          <details> (the archived roll-up precedent) — browsable, never gated. */}
      {restDays.map((day, index) => (
        <details key={day.key} className="group border-b border-b-border/60">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 outline-none transition-colors [&::-webkit-details-marker]:hidden hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden">
            <span className="flex min-w-0 flex-col gap-0.5">
              {/* A real heading, so every day — not just day 1 — appears in
                  heading navigation. Valid inside <summary>, which keeps its
                  button + expanded semantics. */}
              <h3 className="flex min-w-0 items-baseline gap-2 font-normal">
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground tnum">
                  {t('dayNumber', { position: index + 2 })}
                </span>
                <span className="min-w-0 truncate font-display text-lg uppercase leading-tight tracking-wide">
                  {day.name}
                </span>
              </h3>
              <span className="truncate text-xs text-muted-foreground">
                {day.exercises.map((exercise) => exercise.name).join(' · ')}
              </span>
            </span>
            <ChevronRight
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
            />
          </summary>
          <div className="pb-4">{exerciseList(day)}</div>
        </details>
      ))}

      {/* Description AFTER the plan: prose supports the pitch, the plan makes
          it. Body scale, not 14px muted small print. */}
      {description !== null && (
        <section className="mt-8">
          <h2 className="font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
            {t('aboutTitle')}
          </h2>
          <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-muted-foreground">
            {description}
          </p>
        </section>
      )}

      {footer}

      {/* Sticky start bar — the surface's one volt moment, in the thumb zone.
          Full-bleed across the host gutter; carries its own safe-area pad. */}
      <div className="sticky bottom-0 z-10 -mx-5 mt-8 border-t border-border bg-background/95 px-5 pt-3 pb-safe backdrop-blur-md">
        {cta}
        <p className="mt-2 pb-1 text-center text-xs text-muted-foreground">{t('ctaHint')}</p>
      </div>
    </>
  )
}
