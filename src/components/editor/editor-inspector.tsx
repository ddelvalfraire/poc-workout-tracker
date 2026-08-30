import Link from 'next/link'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { EmptyWords } from '@/components/ui/empty-words'
import { cn } from '@/lib/utils'
import type { Technique } from '@/lib/programs/program-input'
import type { DerivedSet } from '@/lib/programs/progression'
import type { WeightUnit } from '@/lib/units'
import { EditorTechniquePanel } from './editor-technique-panel'

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
  /**
   * Every set of the exercise, authorable. `topSet` is the DERIVED row a
   * percentage stage resolves against — null when the week has no derivation
   * for it, in which case the set is listed but not editable, since a preview
   * with nothing to resolve against would be a guess.
   */
  editableSets: readonly {
    setNumber: number
    technique: Technique | null
    /** The stored technique's name, already localized; null = a straight set.
     *  This is the whole of the COLLAPSED state, so the label list this section
     *  used to be survives as the summary rather than being lost to the form. */
    label: string | null
    topSet: DerivedSet | null
  }[]
}

interface EditorInspectorProps {
  exercise: EditorInspectorExercise
  /** The same address with the inspector cleared. */
  closeHref: string
  programId: string
  /** 0-based day position — the addressing `updateProgramSet` takes. */
  day: number
  unit: WeightUnit
  saveTechnique: (formData: FormData) => void | Promise<void>
  className?: string
}

function EditorInspector({
  exercise,
  closeHref,
  programId,
  day,
  unit,
  saveTechnique,
  className,
}: EditorInspectorProps) {
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

      {/* The technique section is now the WRITE path. It was a list of
          already-localized labels — correct, and unactionable: the only thing
          in the app that could author a technique was an MCP tool. Each set
          gets its stack, because a technique is per set, not per exercise.

          A set whose week has no derivation is listed and not editable: a
          percentage stage resolves against the derived top set, so a form
          without one could only guess at the weight it would prescribe. */}
      <section aria-label={t('techniqueTitle')} className="mt-6">
        <h3 className="font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
          {t('techniqueTitle')}
        </h3>
        {exercise.editableSets.length === 0 ? (
          <EmptyWords>{t('techniqueEmpty')}</EmptyWords>
        ) : (
          <ul className="mt-2 divide-y divide-border/60 border-b border-b-border/60">
            {exercise.editableSets.map((entry) => (
              <li key={entry.setNumber}>
                {entry.topSet === null ? (
                  <div className="flex items-baseline justify-between gap-3 py-3 text-sm">
                    <span className="text-xs uppercase tracking-widest text-muted-foreground tnum">
                      {t('setNumber', { number: entry.setNumber })}
                    </span>
                    <EmptyWords>{t('techniqueNoDerivation')}</EmptyWords>
                  </div>
                ) : (
                  /* Collapsed by default, and the summary carries exactly what
                     the old label list did. Expanding every set would put a
                     kind picker per set into a 316px column — five rows each,
                     four sets, before a single stage row is shown — which is
                     not a surface anyone can read. <details> keeps that native:
                     no address change, no JS, and the disclosure is
                     keyboard-reachable for free. */
                  <details className="py-1">
                    <summary className="flex cursor-pointer items-baseline justify-between gap-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden">
                      <span className="text-xs uppercase tracking-widest text-muted-foreground tnum">
                        {t('setNumber', { number: entry.setNumber })}
                      </span>
                      <span className="min-w-0 truncate">
                        {entry.label ?? (
                          <span className="text-muted-foreground">{t('techniqueNone')}</span>
                        )}
                      </span>
                    </summary>
                    <EditorTechniquePanel
                      className="pt-4 pb-6"
                      programId={programId}
                      day={day}
                      exercise={exercise.position}
                      setNumber={entry.setNumber}
                      saved={entry.technique}
                      topSet={entry.topSet}
                      unit={unit}
                      scope={`${exercise.name} · ${t('setNumber', { number: entry.setNumber })}`}
                      action={saveTechnique}
                    />
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export { EditorInspector }
