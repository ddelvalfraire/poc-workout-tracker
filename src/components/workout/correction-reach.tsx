'use client'

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { formatE1RM, formatWorkoutDate } from '@/lib/format'
import type { WeightUnit } from '@/lib/units'
import type { Locale } from '@/i18n/config'
import type { CorrectionReach as Reach, RecordReachItem } from '@/lib/record-reach'

/**
 * GUARD 2 — how far this correction reaches, said at the edit surface.
 *
 * INFORMATION, so it never interrupts. Its sibling guard (the un-complete
 * cascade) is a decision, so it does. Spending an interruption here would
 * spend the budget the modal actually needs, and getting the two the same way
 * round is how a warning becomes wallpaper.
 *
 * ONE COLUMN, PHRASED POSITIVELY. The two-column will/won't layout was
 * rejected: it is not a real pattern, and negations are hardest to parse
 * exactly when the reader is anxious about a number. What changes is a list;
 * what STAYS is carried below a hairline as a positive statement of the same
 * fact — separated by treatment, never by a second column of "won't"s.
 *
 * The settled line is the whole reason this exists. Losing a personal record
 * is obvious and expected. A number quietly NOT moving is the one nobody
 * predicts, and the one that makes the app look wrong three weeks later.
 *
 * Absent entirely when nothing moves: `reach` is null for the ordinary typo
 * fix and this renders nothing. Put it on every edit and it becomes the thing
 * people scroll past to reach the save button.
 */

interface CorrectionReachProps {
  /** Null when the correction reaches nothing — then this renders nothing. */
  reach: Reach | null
  /** The exercise the correction is about; the sentences name it. */
  exerciseName: string
  unit: WeightUnit
  locale: Locale
  className?: string
}

/** Values are canonical kg — only `mostReps` is a plain count. */
function itemValue(item: RecordReachItem, unit: WeightUnit, locale: Locale): string {
  return item.kind === 'mostReps' ? String(item.value) : formatE1RM(item.value, unit, locale)
}

export function CorrectionReach({
  reach,
  exerciseName,
  unit,
  locale,
  className,
}: CorrectionReachProps) {
  const t = useTranslations('CorrectionReach')
  if (reach === null) return null

  return (
    // A hairline zone on the page background, not a shell: this belongs to
    // the fields above it and must never read as a separate card of warnings.
    <section aria-label={t('title')} className={cn('border-t border-border pt-3.5', className)}>
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {t('title')}
      </h3>
      <ul className="mt-2.5 space-y-2">
        {reach.items.map((item) => (
          <li key={item.kind} className="flex gap-2.5 text-sm leading-snug">
            <span aria-hidden="true" className="text-muted-foreground">
              &bull;
            </span>
            <span className="min-w-0 flex-1">
              {t(`item.${item.kind}`, {
                name: exerciseName,
                value: itemValue(item, unit, locale),
                // Empty only when nothing held the slot before, which the
                // message's own branch handles rather than printing a blank.
                date: item.performedAt === null ? '' : formatWorkoutDate(item.performedAt, locale),
                dated: item.performedAt === null ? 'no' : 'yes',
              })}
            </span>
          </li>
        ))}
      </ul>
      {/* What STAYS, below its own hairline. One positive sentence carrying
          both halves: the value, and why it is not being revisited. */}
      {reach.settled !== null && (
        <p className="mt-3 border-t border-t-border/60 pt-2.5 text-sm leading-snug text-muted-foreground">
          {t('settled.trainingMax', {
            value: formatE1RM(reach.settled.valueKg, unit, locale),
            date: formatWorkoutDate(reach.settled.decidedAt, locale),
            sessions: reach.settled.sessionsSince,
          })}
        </p>
      )}
    </section>
  )
}
