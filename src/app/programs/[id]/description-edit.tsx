'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { QuickCaptureSheet } from '@/components/editor/quick-capture-sheet'
import { updateProgramDescriptionAction } from '@/app/programs/actions'
import { useTranslations } from 'next-intl'

/**
 * The program article's first human authoring surface (plan §7): a quiet text
 * control that opens the FullEditor variant in the QuickCapture sheet.
 * Markdown to programs.description via the narrow action — the builder's
 * full-replace path is untouched. TipTap loads only when the sheet opens.
 */
interface DescriptionEditProps {
  programId: string
  programName: string
  description: string | null
}

export function DescriptionEdit({ programId, programName, description }: DescriptionEditProps) {
  const t = useTranslations('DescriptionEdit')
  const [isEditing, setIsEditing] = useState(false)
  const router = useRouter()

  return (
    <>
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="mt-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground underline-offset-4 transition-colors hover:text-foreground active:underline"
      >
        {description !== null ? t('editAction') : t('addAction')}
      </button>
      {isEditing && (
        <QuickCaptureSheet
          title={programName}
          eyebrow={t('sheetEyebrow')}
          variant="full"
          initialBody={description ?? ''}
          initialPinned={false}
          showPinToggle={false}
          onSave={async (value) => {
            await updateProgramDescriptionAction(programId, value.body)
          }}
          onDelete={
            description !== null
              ? async () => {
                  await updateProgramDescriptionAction(programId, null)
                }
              : undefined
          }
          onClose={(saved) => {
            setIsEditing(false)
            if (saved) router.refresh()
          }}
        />
      )}
    </>
  )
}
