import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { isSettled } from '@/app/programs/[id]/editor/trained-view'
import { EmptyWords } from '@/components/ui/empty-words'
import type { WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'
import type { EditorDayDetail, EditorSet } from './editor-model'
import { PinRail } from './editor-pin-rail'
import { EditorSetForm } from './editor-set-form'

/**
 * Pane 2 — the addressed day: its exercises, and the sets the template
 * prescribes for the selected week.
 *
 * THE ONE BRANCH THAT MATTERS is whether this day's session for this week is
 * already settled. `instantiateProgramDay` froze that session's prescription
 * when it started, so an edit made today cannot reach it — and an in-progress
 * session counts, because its sets were written at start time and resuming
 * returns them untouched.
 *
 * A settled day renders as a LOG: values as text, no field chrome, FULL
 * contrast. Not a disabled form — `disabled` would drop the most-read content
 * on the screen out of the tab order and invite WCAG 1.4.3's inactive-component
 * exemption, leaving it technically conformant and unreadable. And not dimmed:
 * lightness alone under 3:1 is not a distinction (1.4.1), so the boundary is
 * carried by a change in FORM, by the word on the row, and by the labelled seam
 * in pane 1.
 *
 * Nothing here says "locked". Nothing enforces a lock: the write succeeds and
 * is merely inert, and claiming otherwise would describe behaviour that does
 * not exist. The copy says what is true instead — the edit lands on the plan,
 * and the plan is not what you already lifted.
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
  programId: string
  /** The per-week override write, for the editable rows only. */
  saveSetAction: (formData: FormData) => void | Promise<void>
  className?: string
}

/** One set's prescription as words — the LOG row for a settled session. */
function SetLine({ set, week, unit }: { set: EditorSet; week: number; unit: WeightUnit }) {
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
    // No `text-muted-foreground`, no opacity: a settled row is the content
    // people most want to read, so it keeps primary ink.
    <li className="relative flex min-h-11 items-baseline gap-3 py-2 pl-3 text-sm [@media(pointer:fine)_and_(min-width:840px)]:min-h-8 [@media(pointer:fine)_and_(min-width:840px)]:py-1">
      {/* Pinned reads as POSITION — a leading rule — with the word beside it.
          Never as a dimmer derived row: lightness alone under 3:1 is not a
          distinction (WCAG 1.4.1). */}
      {set.overridden && <PinRail />}
      <span className="w-14 shrink-0 text-xs uppercase tracking-widest text-muted-foreground tnum">
        {t('setNumber', { number: set.setNumber })}
      </span>
      <span className="min-w-0 flex-1 tnum">
        {facts.length > 0 ? facts.join(' · ') : t('setUnset')}
      </span>
      {set.overridden && (
        <span className="shrink-0 text-xs text-muted-foreground">{t('setPinned', { week })}</span>
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
  programId,
  saveSetAction,
  className,
}: EditorDayPaneProps) {
  const t = useTranslations('ProgramEditor')
  const tDetail = useTranslations('ProgramDetail')

  if (day === null) {
    return (
      <div className={cn('px-5 pb-10', className)}>
        <EmptyWords className="mt-10">{t('dayUnaddressed')}</EmptyWords>
      </div>
    )
  }

  const settled = isSettled(day.trained)

  return (
    <div className={cn('px-5 pb-10', className)}>
      <header className="mt-6">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground tnum">
          {t('dayNumber', { position: day.position + 1 })}
        </p>
        <h1 className="mt-1 font-display text-2xl uppercase leading-tight tracking-wide">
          {day.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground tnum">
          {day.trained === null
            ? t('week', { week })
            : `${t('week', { week })} · ${tDetail(
                day.trained === 'done'
                  ? 'day.doneBadge'
                  : day.trained === 'in-progress'
                    ? 'day.inProgressBadge'
                    : 'day.skippedBadge',
              )}`}
        </p>
      </header>

      {settled && (
        <div className="mt-4 border-t border-t-border/60 pt-3">
          <p className="text-sm">
            {/* The in-progress sentence is its own, because the intuition runs
                backwards: an unfinished session is as settled as a finished
                one, and nobody would guess that. */}
            {t(day.trained === 'in-progress' ? 'settledInProgress' : 'settledDone')}
          </p>
          {day.session !== null && (
            <p className="mt-1 text-sm text-muted-foreground tnum">
              {t('sessionFacts', {
                completed: day.session.completedSetCount,
                total: day.session.setCount,
                volume: Math.round(day.session.volume),
                unit,
              })}{' '}
              <Link
                href={day.session.href}
                className="underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
              >
                {t('sessionLink')}
              </Link>
            </p>
          )}
        </div>
      )}

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
                {settled ? (
                  <ul className="mt-1 pl-1">
                    {exercise.sets.map((set) => (
                      <SetLine key={set.setNumber} set={set} week={week} unit={unit} />
                    ))}
                  </ul>
                ) : (
                  <div className="mt-1 pl-1">
                    {exercise.sets.map((set) => (
                      <EditorSetForm
                        key={set.setNumber}
                        set={set}
                        programId={programId}
                        day={day.position}
                        exercise={exercise.position}
                        week={week}
                        unit={unit}
                        action={saveSetAction}
                      />
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export { EditorDayPane }
