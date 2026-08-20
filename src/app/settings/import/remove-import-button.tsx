'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useTranslations } from 'next-intl'

interface RemoveImportButtonProps {
  batchId: string
  /** e.g. "42 workouts" — the dialog spells out exactly what's deleted. */
  scopeLabel: string
}

/**
 * "Remove" for one import batch: ConfirmDialog-gated DELETE, then a server
 * refresh so the list re-renders without the row. Deletes only the batch's
 * workouts — custom exercises the import created stay (they may back
 * re-logged history).
 */
export function RemoveImportButton({ batchId, scopeLabel }: RemoveImportButtonProps) {
  const t = useTranslations('RemoveImportButton')
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setIsPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/import/${batchId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Failed to remove import')
      setIsOpen(false)
      router.refresh()
    } catch {
      setError("Couldn't remove the import — try again.")
    } finally {
      setIsPending(false)
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive"
        onClick={() => setIsOpen(true)}
      >
        {t('remove')}
      </Button>
      {isOpen && (
        <ConfirmDialog
          title="Remove this import?"
          body={`Deletes the ${scopeLabel} this import added. Custom exercises it created are kept.`}
          confirmLabel="Remove"
          pendingLabel="Removing…"
          error={error}
          isPending={isPending}
          onConfirm={() => void remove()}
          onClose={() => {
            if (!isPending) setIsOpen(false)
          }}
        />
      )}
    </>
  )
}
