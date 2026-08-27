import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { EmptyWords } from '@/components/ui/empty-words'
import type { WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'
import type { EditorDayDetail, EditorSet } from './editor-model'

/**
 * Pane 2 — the addressed day: its exercises, each with the sets the template
 * prescribes for the selected week.
 *
 * With no day addressed this pane is the wide layout's empty canvas (the phone
 * never sees it — there the structure list occupies the column instead). It
 * says what to do rather than apologising for being empty, which is the
 * `EmptyWords` voice.
 *
 * Selecting an exercise is a link to the SAME address with `?exercise=` set, so
 * the inspector opens as a sheet on phone and as pane 3 at width from one
 * href. The selected exercise is marked with a rule and weight, not the accent:
 * the surface's one volt moment is the selected DAY in pane 1, and DESIGN.md
 * forbids stacking a second.
 */
interface EditorDayPaneProps {
  /** The addressed day, or null for the wide layout's empty canvas. */
  day: EditorDayDetail | null
  /** 1-based week the sets are shown for. */
  week: number
  /** The user's display unit — loads arrive already converted into it. */
  unit: WeightUnit
  /** 0-based position of the inspected exercise, or null. */
  selectedExercise: number | null
  hrefForExercise: (exercise: number) => string
  className?: string
}

/** One set's prescription as words — the row both projections read. */
function SetLine({ set, unit }: { set: EditorSet; unit: WeightUnit }) {
  const t = useTranslations('ProgramEditor')

  const facts: string[] = []
  if (set.repMin !== null || set.repMax !== null) {
    facts.push(
      set.repMin !== null && set.repMax !== null && set.repMin !== set.repMax
        ? t('setReps', { min: set.repMin, max: set.repMax })
        : t('setRepsExact', { reps: set.repMax ?? set.repMin ?? 0 }),
    )
  }
  if (set.load !== null) facts.push(t('setLoad', { load: set.load, unit }))
  if (set.rir !== null) facts.push(t('setRir', { rir: set.rir }))
  if (set.rpe !== null) facts.push(t('setRpe', { rpe: set.rpe }))

  return (
    <li className="flex min-h-11 items-baseline gap-3 py-2 text-sm [@media(pointer:fine)_and_(min-width:840px)]:min-h-8 [@media(pointer:fine)_and_(min-width:840px)]:py-1">
      <span className="w-14 shrink-0 text-xs uppercase tracking-widest text-muted-foreground tnum">
        {t('setNumber', { number: set.setNumber })}
      </span>
      <span className="min-w-0 flex-1 tnum">
        {facts.length > 0 ? facts.join(' · ') : t('setUnset')}
      </span>
      {set.overridden && (
        <span className="shrink-0 text-xs text-muted-foreground">{t('setOverridden')}</span>
      )}
    </li>
  )
}

function EditorDayPane({
  day,
  week,
  unit,
  selectedExercise,
  hrefForExercise,
  className,
}: EditorDayPaneProps) {
  const t = useTranslations('ProgramEditor')

  if (day === null) {
    return (
      <div className={cn('px-5 pb-10', className)}>
        <EmptyWords className="mt-10">{t('dayUnaddressed')}</EmptyWords>
      </div>
    )
  }

  return (
    <div className={cn('px-5 pb-10', className)}>
      <header className="mt-6">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground tnum">
          {t('dayNumber', { position: day.position + 1 })}
        </p>
        <h1 className="mt-1 font-display text-2xl uppercase leading-tight tracking-wide">
          {day.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground tnum">{t('week', { week })}</p>
      </header>

      {day.exercises.length === 0 ? (
        <EmptyWords>{t('exercisesEmpty')}</EmptyWords>
      ) : (
        <ul className="mt-4 divide-y divide-border/60 border-b border-b-border/60">
          {day.exercises.map((exercise) => {
            const isSelected = exercise.position === selectedExercise
            return (
              <li key={exercise.position} className="py-3">
                <Link
                  href={hrefForExercise(exercise.position)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={cn(
                    'flex min-h-11 items-center justify-between gap-3 px-1 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden [@media(pointer:fine)_and_(min-width:840px)]:min-h-8',
                    // Selection reads as a rule plus weight — the accent is
                    // spent on the selected day in pane 1.
                    isSelected && '-ml-2 border-l-2 border-l-foreground pl-2 font-semibold',
                  )}
                >
                  <span className="min-w-0 truncate">{exercise.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tnum">
                    {t('setCount', { count: exercise.sets.length })}
                  </span>
                </Link>
                <ul className="mt-1 pl-1">
                  {exercise.sets.map((set) => (
                    <SetLine key={set.setNumber} set={set} unit={unit} />
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export { EditorDayPane }
