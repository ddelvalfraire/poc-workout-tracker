'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pin } from 'lucide-react'
import { MarkdownView } from '@/components/markdown-view'
import { QuickCaptureSheet } from '@/components/editor/quick-capture-sheet'
import { upsertExerciseNoteAction, deleteExerciseNoteAction } from '@/app/exercises/actions'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { useTranslations } from 'next-intl'

/**
 * The exercise-identity note on the detail page: read via MarkdownView (zero
 * editor bytes), edit via the FullEditor variant in the QuickCapture sheet
 * (TipTap loads only when the sheet opens). De-carded — the note sits bare
 * under the section label, the edit affordance is a text control.
 */
interface ExerciseNoteSectionProps {
  source: ExerciseSource
  exerciseId: number
  exerciseName: string
  note: { body: string; pinned: boolean } | null
}

export function ExerciseNoteSection({
  source,
  exerciseId,
  exerciseName,
  note,
}: ExerciseNoteSectionProps) {
  const t = useTranslations('ExerciseNoteSection')
  const [isEditing, setIsEditing] = useState(false)
  const router = useRouter()

  return (
    <section aria-label={t('ariaLabel')}>
      <div className="flex items-baseline justify-between px-1">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t('title')}
          {note?.pinned && (
            <Pin aria-label={t('pinnedAriaLabel')} className="size-3 text-primary" />
          )}
        </h2>
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="text-xs font-semibold uppercase tracking-widest text-muted-foreground underline-offset-4 transition-colors hover:text-foreground active:underline"
        >
          {note ? t('edit') : t('add')}
        </button>
      </div>
      {note ? (
        <MarkdownView markdown={note.body} className="mt-2 px-1 text-muted-foreground" />
      ) : (
        <p className="mt-2 px-1 text-sm text-muted-foreground/70">
          {t('empty')}
        </p>
      )}
      {isEditing && (
        <QuickCaptureSheet
          title={exerciseName}
          eyebrow={t('eyebrow')}
          variant="full"
          initialBody={note?.body ?? ''}
          initialPinned={note?.pinned ?? true}
          onSave={async (value) => {
            await upsertExerciseNoteAction(source, exerciseId, value)
          }}
          onDelete={
            note
              ? async () => {
                  await deleteExerciseNoteAction(source, exerciseId)
                }
              : undefined
          }
          onClose={(saved) => {
            setIsEditing(false)
            if (saved) router.refresh()
          }}
        />
      )}
    </section>
  )
}
