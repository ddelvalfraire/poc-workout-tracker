import { useTranslations } from 'next-intl'

import type { WeekTrainedReport } from '@/app/programs/[id]/editor/trained-view'
import { cn } from '@/lib/utils'

/**
 * The persistent scope line — where editing begins, said BEFORE the edit.
 *
 * Not a dialog, deliberately. Editing a program is a frequent action, and a
 * frequent confirmation is habituated away within days; the ideal number of
 * "that edit did nothing" warnings is zero, reached by never letting anyone
 * arrive at one blind. So this is a quiet standing line, and it never
 * interrupts.
 *
 * Three facts, widest to narrowest:
 *
 * 1. The block's shipped status sentence, rendered by the caller from
 *    `programStatusLine` — the same words the detail page uses, "Block
 *    complete." included. Re-deciding it here is how two surfaces start
 *    disagreeing about where a block stands.
 * 2. The selected week as a COUNT. Never a tri-state control: "mixed" is a
 *    state a user can leave but never enter, and its entire semantic is
 *    "toggle my children" — precisely the operation that must be forbidden.
 *    A count also survives translation, screen readers and colour blindness.
 * 3. What an edit reaches, in domain terms and in the forward-only voice.
 *
 * The word "locked" appears nowhere, here or downstream: `setProgramSetOverride`
 * and `updateProgramSet` have no trained-week awareness at all, so the write
 * always succeeds and is merely inert. A lock badge would describe an
 * enforcement that does not exist.
 */
interface EditorScopeLineProps {
  /** The block's status sentence, already rendered from `programStatusLine`. */
  statusLine: string
  /** 1-based week the editor is showing. */
  week: number
  report: WeekTrainedReport
  /**
   * Whether this program has ANY workout at all. A draft that was never
   * started has no trained state to report, and computing "0 of 4 trained"
   * from nothing would dress an absence up as a measurement.
   */
  hasHistory: boolean
  className?: string
}

function EditorScopeLine({ statusLine, week, report, hasHistory, className }: EditorScopeLineProps) {
  const t = useTranslations('ProgramEditor')

  const count =
    !hasHistory || report.total === 0
      ? null
      : report.allTrained
        ? t('scopeWeekAll', { week })
        : report.trained === 0
          ? t('scopeWeekNone', { week })
          : t('scopeWeekCount', { week, trained: report.trained, total: report.total })

  return (
    <section
      className={cn('border-b border-b-border/60 px-5 py-3', className)}
      aria-label={t('scopeLabel')}
    >
      <p className="font-display text-base uppercase leading-none tracking-wide">{statusLine}</p>
      {count !== null && <p className="mt-1.5 text-sm text-muted-foreground tnum">{count}</p>}
      <p className="mt-1 text-sm text-muted-foreground">{t('scopeNote')}</p>
    </section>
  )
}

export { EditorScopeLine }
