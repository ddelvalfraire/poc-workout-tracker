import Link from 'next/link'
import { useTranslations } from 'next-intl'

import type { ReachScope, ReachWeek } from '@/app/programs/[id]/editor/reach-view'
import { Button } from '@/components/ui/button'
import type { WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'

/**
 * "You changed a weight — how far should it reach?"
 *
 * TWO OPTIONS, NOT THREE. "This week onward" is absent because it is not
 * storable: a pin is keyed `(program_set_id, week)` and holds field values for
 * ONE week, and nothing in the schema is week-ranged
 * (docs/specs/per-week-set-count.md). A surface offering it would either
 * silently pin every remaining week — converting derived weeks into authored
 * ones the rule can no longer move — or silently no-op. Neither is a scope; the
 * two below are.
 *
 * NOT A CONFIRMATION GATE. The edit is already saved: the set row posted its
 * per-week override and the write landed. This asks only whether to WIDEN it,
 * which is why "this week only" is the do-nothing branch and why dismissing the
 * sheet loses nothing. A modal in front of a frequent edit is habituated away
 * within days; this one appears only after a load actually diverged from the
 * rule, and it opens with a fact rather than a question.
 *
 * THE SET-COUNT FOOTER IS PART OF THE DESIGN, not a caveat. "Fewer sets in one
 * week" is a real thing people want and a real thing this table cannot hold, so
 * the sheet names the rule that DOES express it — the deload policy, or a
 * weekly-volume progression — instead of leaving someone hunting for an option
 * that was never going to exist.
 */
export interface EditorReachOption {
  scope: ReachScope
  /** The week-by-week strip for this option. */
  weeks: readonly ReachWeek[]
}

interface EditorReachSheetProps {
  /** The movement whose load moved. */
  exerciseName: string
  /** The week that is now pinned. */
  week: number
  /** Where it went, in the display unit. */
  toLoad: number
  /** Where it came from, or null when the plan named no load before. */
  fromLoad: number | null
  unit: WeightUnit
  options: readonly EditorReachOption[]
  /** Dismisses the sheet — the address without `?reach=`. */
  dismissHref: string
  /** Widens the pin to the template. The other option is already the state. */
  applyToPlanAction: (formData: FormData) => void | Promise<void>
  /** The address fields the action needs to find the set again. */
  subject: { programId: string; day: number; exercise: number; setNumber: number; week: number }
  className?: string
}

/** One option's week strip: every week's number, with the moved ones in bold. */
function WeekStrip({ weeks, unit }: { weeks: readonly ReachWeek[]; unit: WeightUnit }) {
  const t = useTranslations('ProgramEditor')

  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {weeks.map((entry) => (
        <li
          key={entry.week}
          className={cn(
            'text-xs text-muted-foreground tnum',
            // Weight, not colour: the strip has to survive a greyscale reading,
            // and "bold = changes" is stated in the legend beneath rather than
            // left to be inferred.
            entry.changes && 'font-semibold text-foreground',
          )}
        >
          <span className="sr-only">{t('weekShort', { week: entry.week })} </span>
          {entry.load === null ? t('pivotNothing') : t('pivotLoad', { load: entry.load })}
          {entry.load !== null && <span className="sr-only"> {unit}</span>}
          {/* A settled week's number is the PLAN's and is not what was lifted.
              Saying so is the rule that a template figure never passes for a
              logged one. */}
          {entry.settled && <span className="sr-only"> {t('reachSettledWeek')}</span>}
        </li>
      ))}
    </ul>
  )
}

function EditorReachSheet({
  exerciseName,
  week,
  toLoad,
  fromLoad,
  unit,
  options,
  dismissHref,
  applyToPlanAction,
  subject,
  className,
}: EditorReachSheetProps) {
  const t = useTranslations('ProgramEditor')

  const settledCount = new Set(
    options
      .flatMap((option) => option.weeks)
      .filter((entry) => entry.settled)
      .map((entry) => entry.week),
  ).size

  return (
    <section
      aria-label={t('reachLabel')}
      className={cn(
        'sticky bottom-0 z-30 border-t border-t-border/60 bg-background px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
        className,
      )}
    >
      <h2 className="font-display text-xl uppercase leading-tight tracking-wide">
        {t('reachTitle')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground tnum">
        {fromLoad === null
          ? t('reachMovedFromNothing', { exercise: exerciseName, week, to: toLoad, unit })
          : t('reachMoved', { exercise: exerciseName, week, from: fromLoad, to: toLoad, unit })}
      </p>

      <ul className="mt-3 divide-y divide-border/60 border-t border-t-border/60 border-b border-b-border/60">
        {options.map((option) => (
          <li key={option.scope} className="py-3">
            <p className="text-sm font-medium">
              {t(option.scope === 'week' ? 'reachScopeWeek' : 'reachScopePlan', { week })}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t(option.scope === 'week' ? 'reachScopeWeekNote' : 'reachScopePlanNote', { week })}
            </p>
            <WeekStrip weeks={option.weeks} unit={unit} />
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-muted-foreground">
        {t('reachStripLegend')}
        {settledCount > 0 && ` ${t('reachSettledNote', { count: settledCount })}`}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {/* Keeping the pin is a LINK, because it already IS the state: there is
            nothing to post, and the only thing left to do is stop asking. */}
        <Link
          href={dismissHref}
          replace
          className="flex min-h-11 items-center text-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
        >
          {t('reachKeepWeek')}
        </Link>
        <form action={applyToPlanAction} className="flex items-center">
          <input type="hidden" name="programId" value={subject.programId} />
          <input type="hidden" name="day" value={subject.day} />
          <input type="hidden" name="exercise" value={subject.exercise} />
          <input type="hidden" name="setNumber" value={subject.setNumber} />
          <input type="hidden" name="week" value={subject.week} />
          <Button type="submit" size="sm">
            {t('reachApplyToPlan')}
          </Button>
        </form>
      </div>

      {/* Where a set-COUNT change lands: not here. The sheet names the rule
          that already expresses it rather than growing an option the storage
          cannot hold. */}
      <p className="mt-3 border-t border-t-border/60 pt-3 text-xs text-muted-foreground">
        {t('reachSetCountNote')}
      </p>
    </section>
  )
}

export { EditorReachSheet }
