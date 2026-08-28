'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import type { Technique } from '@/lib/program-input'
import type { DerivedSet } from '@/lib/progression'
import type { WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'
import { EditorTechniqueForm } from './editor-technique-form'

/**
 * The technique stack plus its save — the DRAFT boundary.
 *
 * A stack is edited many times before it means anything: pick a kind, add three
 * stages, retype two loads, switch one to a percentage. Writing on every
 * keystroke would put a dozen half-built techniques through the change log and
 * in front of anyone reading the plan mid-edit. So the form is controlled here,
 * the draft lives in this component, and one explicit Save posts it.
 *
 * That makes staged-but-unsaved a real state, and it is disclosed rather than
 * implied: the button says there are unsaved changes and Discard sits beside
 * it. Navigating away loses the draft — the same bargain the training-max field
 * makes in docs/specs/progression-authoring.md §04.
 *
 * The write targets the PLAN, not the week being viewed, which is the one place
 * this surface departs from every other write in the editor. It is stated on
 * the surface rather than left for the change log to reveal.
 */
interface EditorTechniquePanelProps {
  programId: string
  /** 0-based day position — the addressing `updateProgramSet` takes. */
  day: number
  /** 0-based exercise position. */
  exercise: number
  /** 1-based set number within the exercise. */
  setNumber: number
  /** What the plan stores today; null = a straight set. */
  saved: Technique | null
  /** The set the stack hangs off — a percentage stage resolves against it. */
  topSet: DerivedSet
  unit: WeightUnit
  scope: string
  action: (formData: FormData) => void | Promise<void>
  className?: string
}

export function EditorTechniquePanel({
  programId,
  day,
  exercise,
  setNumber,
  saved,
  topSet,
  unit,
  scope,
  action,
  className,
}: EditorTechniquePanelProps) {
  const t = useTranslations('EditorTechniquePanel')
  const [draft, setDraft] = useState<Technique | null>(saved)

  const dirty = JSON.stringify(draft ?? null) !== JSON.stringify(saved ?? null)

  return (
    <form action={action} className={cn('flex flex-col gap-6', className)}>
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="day" value={day} />
      <input type="hidden" name="exercise" value={exercise} />
      <input type="hidden" name="setNumber" value={setNumber} />
      {/* A technique is a tree, so it rides as JSON rather than as invented
          `stages[0][loadPct]` field names. The server re-parses it through the
          real schema; this value is never trusted. */}
      <input type="hidden" name="technique" value={draft === null ? '' : JSON.stringify(draft)} />

      <EditorTechniqueForm
        value={draft}
        onChange={setDraft}
        topSet={topSet}
        unit={unit}
        setNumber={setNumber}
        scope={scope}
      />

      <div className="flex flex-col gap-2">
        {/* The scope of the write, said before it happens rather than found in
            the change log afterwards. Every other edit here is week-only. */}
        <p className="text-sm text-muted-foreground">{t('planScopeNote')}</p>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!dirty}>
            {dirty ? t('saveDirty') : t('saved')}
          </Button>
          {dirty && (
            <Button type="button" variant="ghost" onClick={() => setDraft(saved)}>
              {t('discard')}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
