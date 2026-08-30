'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { adjustTrainingMaxAction } from '@/app/programs/actions'
import { useTranslations } from 'next-intl'

/**
 * The owner's confirm on an M4 "TM likely set too high" proposal (TM
 * lifecycle §1): one outline button per flagged lift; the dialog is the
 * explicit confirm, and only it calls the setter (reason 'reset' — logged in
 * the change log). Never automatic. Follows RestartProgramButton's dialog
 * idiom: error retries in place, refresh (not push) on success so the page
 * re-derives with the reduced TM.
 */
export function TmResetButton({
  programId,
  dayPosition,
  exercisePosition,
  exerciseName,
  currentTm,
  proposedTm,
  proposedTmKg,
  unit,
}: {
  programId: string
  dayPosition: number
  exercisePosition: number
  exerciseName: string
  /** Display-unit values for the sentence; the ACTION takes canonical kg. */
  currentTm: number
  proposedTm: number
  proposedTmKg: number
  unit: string
}) {
  const t = useTranslations('TmResetButton')
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeDialogRef = useRef<(() => void) | null>(null)
  const router = useRouter()

  async function handleConfirm() {
    setIsPending(true)
    try {
      setError(null)
      await adjustTrainingMaxAction(programId, dayPosition, exercisePosition, proposedTmKg)
      closeDialogRef.current?.()
      setIsOpen(false)
      setIsPending(false)
      router.refresh() // same page, re-derived off the reduced TM
    } catch {
      setIsPending(false)
      setError(t('adjustError'))
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={isPending}
        onClick={() => {
          setError(null) // a stale failure must not reopen with the dialog
          setIsOpen(true)
        }}
      >
        {t('reduceAction')}
      </Button>
      {isOpen && (
        <ConfirmDialog
          title={t('dialog.title')}
          body={t('dialog.body', { exerciseName, currentTm, proposedTm, unit })}
          confirmLabel={t('dialog.confirm')}
          pendingLabel={t('dialog.pending')}
          confirmVariant="default"
          error={error}
          isPending={isPending}
          onConfirm={handleConfirm}
          onClose={() => setIsOpen(false)}
          closeRef={closeDialogRef}
        />
      )}
    </>
  )
}
