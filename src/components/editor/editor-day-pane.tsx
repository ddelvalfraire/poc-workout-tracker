import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { isSettled } from '@/app/programs/[id]/editor/trained-view'
import { EmptyWords } from '@/components/ui/empty-words'
import type { WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'
import { formatLoggedSet, formatSet } from '@/lib/format'
import { renderMessage } from '@/lib/message'
import type { EditorDayDetail, EditorLoggedExercise, EditorLoggedSet } from './editor-model'
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

/**
 * One LOGGED set: what was lifted, and — only when they differ — the target it
 * was given, struck through beside it.
 *
 * The struck prescription is the frozen `prescribed*` snapshot from this
 * session's own row, not today's template. Those are different numbers whenever
 * the plan moved after the session started, and the one the reader wants is the
 * one they were actually asked for on the day.
 *
 * A set that went exactly as prescribed shows ONE number. Drawing the pair on
 * every row would bury the handful that actually moved, which is the entire
 * signal.
 *
 * Both halves go through the SHIPPED `formatSet`/`formatLoggedSet`, so a
 * bodyweight or assisted exercise reads here exactly as it reads on the workout
 * page — and both numbers come from the same `weight` column, so comparing them
 * is like for like.
 */
function LoggedSetLine({
  set,
  loggingType,
  unit,
}: {
  set: EditorLoggedSet
  loggingType: EditorLoggedExercise['loggingType']
  unit: WeightUnit
}) {
  const t = useTranslations('ProgramEditor')
  const tFormat = useTranslations('Format')

  const actual = renderMessage(tFormat, formatLoggedSet(set, unit, loggingType))
  const prescribed = set.diverged
    ? renderMessage(tFormat, formatSet(set.prescribedReps, set.prescribedWeight, unit, loggingType))
    : null

  return (
    // No `text-muted-foreground`, no opacity: a logged row is the content
    // people most want to read, so it keeps primary ink.
    <li className="flex min-h-11 items-baseline gap-3 py-2 text-sm [@media(pointer:fine)_and_(min-width:840px)]:min-h-8 [@media(pointer:fine)_and_(min-width:840px)]:py-1">
      <span className="w-14 shrink-0 text-xs uppercase tracking-widest text-muted-foreground tnum">
        {t('setNumber', { number: set.setNumber })}
      </span>
      <span className="min-w-0 flex-1 tnum">
        {prescribed !== null && (
          <>
            {/* The plan struck through, the actual beside it. Both facts
                visible, neither pretending to be a field — and the strike is
                a shape, so it does not rely on the grey to be read. */}
            <s className="text-muted-foreground">{prescribed}</s>{' '}
          </>
        )}
        {actual}
      </span>
      {!set.completed && (
        <span className="shrink-0 text-xs text-muted-foreground">{t('setNotLogged')}</span>
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

      {settled && day.session !== null ? (
        // A settled day is a LOG, and it is the SESSION's log: its own
        // exercises, in its own order, under its own names. Aligning the rows
        // to today's plan would put one movement's numbers under another
        // movement's name the moment the plan was reordered or a lift swapped.
        day.session.exercises.length === 0 ? (
          <EmptyWords>{t('sessionEmpty')}</EmptyWords>
        ) : (
          <ul className="mt-4 divide-y divide-border/60 border-b border-b-border/60">
            {day.session.exercises.map((exercise) => (
              <li key={exercise.position} className="py-3">
                <p className="flex min-h-11 items-center px-1 font-medium [@media(pointer:fine)_and_(min-width:840px)]:min-h-8">
                  {exercise.name}
                </p>
                <ul className="mt-1 pl-1">
                  {exercise.sets.map((set) => (
                    <LoggedSetLine
                      key={set.setNumber}
                      set={set}
                      loggingType={exercise.loggingType}
                      unit={unit}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )
      ) : day.exercises.length === 0 ? (
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
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export { EditorDayPane }
