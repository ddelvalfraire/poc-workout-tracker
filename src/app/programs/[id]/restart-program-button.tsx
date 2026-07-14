'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { cn } from '@/lib/utils'
import { restartProgramAction } from '@/app/programs/actions'

/**
 * "Restart block": clones the program into a fresh week-1 copy ("Name —
 * Block k"), activates it (archiving an active source via the single-active
 * sweep), and navigates to the clone. One shared island for its entry points —
 * the completion card and the program action row; parents decide WHEN it
 * renders (never for drafts), this stays dumb about status. Always outline:
 * the page's volt CTA belongs to Start; the dialog's affirmative confirm is
 * the one volt in the flow.
 */
export function RestartProgramButton({
  id,
  size = 'default',
  className,
}: {
  id: string
  size?: 'sm' | 'default'
  className?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, setIsPending] = useState(false)
  // Renders INSIDE the dialog so the user retries in place (two-surface
  // error rationale in program-actions.tsx).
  const [error, setError] = useState<string | null>(null)
  // ConfirmDialog populates this with an imperative close; the success path
  // calls it BEFORE router.push (the #25 stranded-::backdrop race).
  const closeDialogRef = useRef<(() => void) | null>(null)
  const router = useRouter()

  // Not startTransition: navigating inside an async transition lets the
  // app-wide <ViewTransition> strand the old screen's snapshot over the
  // destination (see workout-logger handleSave). Await, then navigate.
  async function handleRestart() {
    setIsPending(true)
    try {
      setError(null)
      const { id: newId } = await restartProgramAction(id)
      closeDialogRef.current?.()
      setIsOpen(false)
      router.push(`/programs/${newId}`)
      // isPending stays true on success: navigation unmounts this screen.
    } catch {
      setIsPending(false)
      // The dialog stays open: the error renders inside it, retry in place.
      setError('Could not restart this block. Please try again.')
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size={size}
        className={cn(className)}
        disabled={isPending}
        onClick={() => {
          setError(null) // a stale failure must not reopen with the dialog
          setIsOpen(true)
        }}
      >
        Restart block
      </Button>
      {isOpen && (
        <ConfirmDialog
          title="Start the next block?"
          body="Creates a fresh copy of this program starting at week 1 and makes it active. This one is archived — its history and stats stay."
          confirmLabel="Restart block"
          pendingLabel="Restarting…"
          confirmVariant="default"
          error={error}
          isPending={isPending}
          onConfirm={handleRestart}
          onClose={() => setIsOpen(false)}
          closeRef={closeDialogRef}
        />
      )}
    </>
  )
}
