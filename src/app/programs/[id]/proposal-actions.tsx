'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { adoptProgramAction, declineProgramAction } from '@/app/programs/actions'

/**
 * The forced confirm for a coach-drafted proposal — the ONLY controls a
 * 'proposed' program page shows (it replaces ProgramActions entirely: no
 * Edit/Activate/Restart until the owner has said yes). Two explicit adopt
 * buttons (the PRD's two-buttons lean): "Adopt & activate" carries the page's
 * volt CTA, "Adopt as draft" stays outline. Decline is the quiet destructive
 * path behind a ConfirmDialog — it hard-deletes the proposal.
 */
export function ProposalActions({ id }: { id: string }) {
  const [isPending, setIsPending] = useState(false)
  const [isDeclineOpen, setIsDeclineOpen] = useState(false)
  // Adopt errors render on the page (their buttons live there); decline's
  // renders INSIDE its dialog so the user retries in place — the same
  // two-surface split as ProgramActions.
  const [adoptError, setAdoptError] = useState<string | null>(null)
  const [declineError, setDeclineError] = useState<string | null>(null)
  // ConfirmDialog contract: imperative close BEFORE navigation (the #25
  // stranded-::backdrop race), same as ProgramActions' delete path.
  const closeDeclineRef = useRef<(() => void) | null>(null)
  const router = useRouter()

  // Not startTransition: navigating inside an async transition lets the
  // app-wide <ViewTransition> strand the old screen's snapshot (see
  // workout-logger handleSave). Await, then refresh/navigate.
  async function handleAdopt(activate: boolean) {
    setIsPending(true)
    try {
      setAdoptError(null)
      await adoptProgramAction(id, activate)
      router.refresh()
    } catch {
      setAdoptError('Could not adopt this proposal. Please try again.')
    } finally {
      // This island stays mounted (refresh, not push) — always re-enable.
      setIsPending(false)
    }
  }

  async function handleDecline() {
    setIsPending(true)
    try {
      setDeclineError(null)
      await declineProgramAction(id)
      closeDeclineRef.current?.()
      setIsDeclineOpen(false)
      router.push('/programs')
      // isPending stays true on success: navigation unmounts this screen.
    } catch {
      setIsPending(false)
      // The dialog stays open: the error renders inside it, retry in place.
      setDeclineError('Could not decline this proposal. Please try again.')
    }
  }

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center gap-2">
        <Button className="flex-1" disabled={isPending} onClick={() => handleAdopt(true)}>
          Adopt &amp; activate
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          disabled={isPending}
          onClick={() => handleAdopt(false)}
        >
          Adopt as draft
        </Button>
        <Button
          variant="ghost"
          className="shrink-0 text-destructive"
          disabled={isPending}
          onClick={() => {
            setDeclineError(null) // a stale failure must not reopen with the dialog
            setIsDeclineOpen(true)
          }}
        >
          Decline
        </Button>
      </div>
      {adoptError && <p className="text-sm text-destructive">{adoptError}</p>}
      {isDeclineOpen && (
        <ConfirmDialog
          title="Decline this proposal?"
          body="The proposed plan is deleted. Your coach can always draft a new one."
          confirmLabel="Decline"
          pendingLabel="Declining…"
          error={declineError}
          isPending={isPending}
          onConfirm={handleDecline}
          onClose={() => setIsDeclineOpen(false)}
          closeRef={closeDeclineRef}
        />
      )}
    </div>
  )
}
