import Link from 'next/link'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { EmptyWords } from '@/components/ui/empty-words'
import { cn } from '@/lib/utils'

/**
 * Pane 3 — the inspector for the selected exercise: how it progresses, and any
 * intensity technique its sets carry.
 *
 * The component renders the same markup in both projections; `EditorPanes` owns
 * whether that markup is a bottom sheet (phone) or a column (at width). Copy
 * that needs deriving — the scheme sentence, technique labels — arrives ALREADY
 * localized, because those decisions belong to `scheme-copy.ts` and the
 * detail-page vocabulary, and re-deciding them here is how two surfaces start
 * disagreeing about what a scheme is called.
 *
 * Closing is a LINK to the address without `?exercise=`, not a button with
 * state: the inspector's open-ness is part of the address, so dismissing it has
 * to be a navigation or Back would not undo it.
 */
export interface EditorInspectorExercise {
  /** 0-based position — what `?exercise=` carries. */
  position: number
  name: string
  setCount: number
  /** The "how this progresses" sentence, already localized; null when the
   *  exercise has no progression — the section says so rather than inventing
   *  copy. */
  progressionSentence: string | null
  /** Already-localized technique labels, one entry per set that carries one. */
  techniques: readonly { setNumber: number; label: string }[]
}

interface EditorInspectorProps {
  exercise: EditorInspectorExercise
  /** The same address with the inspector cleared. */
  closeHref: string
  className?: string
}

function EditorInspector({ exercise, closeHref, className }: EditorInspectorProps) {
  const t = useTranslations('ProgramEditor')

  return (
    <div className={cn('pb-8', className)}>
      <div className="sticky top-0 flex items-start justify-between gap-3 bg-background pt-4 pb-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t('inspectorTitle')}
          </p>
          <h2 className="mt-1 font-display text-lg uppercase leading-tight tracking-wide">
            {exercise.name}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground tnum">
            {t('setCount', { count: exercise.setCount })}
          </p>
        </div>
        <Link
          href={closeHref}
          aria-label={t('inspectorClose')}
          className="flex size-11 shrink-0 items-center justify-center text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
        >
          <X aria-hidden="true" className="size-4" />
        </Link>
      </div>

      <section aria-label={t('progressionTitle')} className="mt-4">
        <h3 className="font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
          {t('progressionTitle')}
        </h3>
        {exercise.progressionSentence === null ? (
          <EmptyWords>{t('progressionEmpty')}</EmptyWords>
        ) : (
          <p className="mt-2 text-sm">{exercise.progressionSentence}</p>
        )}
      </section>

      <section aria-label={t('techniqueTitle')} className="mt-6">
        <h3 className="font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
          {t('techniqueTitle')}
        </h3>
        {exercise.techniques.length === 0 ? (
          <EmptyWords>{t('techniqueEmpty')}</EmptyWords>
        ) : (
          <ul className="mt-2 divide-y divide-border/60 border-b border-b-border/60">
            {exercise.techniques.map((entry) => (
              <li
                key={entry.setNumber}
                className="flex items-baseline justify-between gap-3 py-2 text-sm"
              >
                <span className="text-xs uppercase tracking-widest text-muted-foreground tnum">
                  {t('setNumber', { number: entry.setNumber })}
                </span>
                <span className="min-w-0 truncate">{entry.label}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export { EditorInspector }
