'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  confirmPatchProposalAction,
  declinePatchProposalAction,
} from '@/app/programs/actions'
import { useTranslations } from 'next-intl'

/**
 * The approval card for a batch-patch proposal (proposals plan §3) — the chat
 * ApprovalCard idiom transplanted onto the program page: volt eyebrow, the
 * proposal's one-line summary, then ONE sentence diff per patch
 * (describeToolCall, rendered server-side and passed down), and a single
 * combined confirm. Accept-whole-or-decline on purpose: no per-patch
 * checkboxes — the proposal is one decision unit, edits happen post-apply
 * through the normal editor. Card shell deliberately (keep-list: approval
 * cards are decision units, like the proposed-program banner above it).
 */
export function PatchProposalCard({
  id,
  eyebrow,
  summary,
  ageLine,
  sentences,
}: {
  id: string
  eyebrow: string
  summary: string
  ageLine: string
  sentences: string[]
}) {
  const t = useTranslations('PatchProposalCard')
  const [isPending, setIsPending] = useState(false)
  const [isDeclineOpen, setIsDeclineOpen] = useState(false)
  // Apply errors render on the card (its button lives here); decline's render
  // INSIDE its dialog — the same two-surface split as ProposalActions.
  const [applyError, setApplyError] = useState<string | null>(null)
  const [declineError, setDeclineError] = useState<string | null>(null)
  // ConfirmDialog contract: imperative close BEFORE any navigation (the #25
  // stranded-::backdrop race) — decline stays on this page, so close+refresh.
  const closeDeclineRef = useRef<(() => void) | null>(null)
  const router = useRouter()

  // Not startTransition: navigating/refreshing inside an async transition
  // lets the app-wide <ViewTransition> strand the old screen's snapshot
  // (see workout-logger handleSave). Await, then refresh.
  async function handleConfirm() {
    setIsPending(true)
    try {
      setApplyError(null)
      await confirmPatchProposalAction(id)
      router.refresh()
    } catch (error: unknown) {
      // The db layer's messages are owner-safe ("change 2 of 3 no longer
      // matches the program — nothing was applied") — surface them.
      setApplyError(
        error instanceof Error && error.message.length > 0
          ? error.message
          : t('applyError'),
      )
    } finally {
      // The card stays mounted (refresh, not push) — always re-enable.
      setIsPending(false)
    }
  }

  async function handleDecline() {
    setIsPending(true)
    try {
      setDeclineError(null)
      await declinePatchProposalAction(id)
      closeDeclineRef.current?.()
      setIsDeclineOpen(false)
      router.refresh()
    } catch {
      // The dialog stays open: the error renders inside it, retry in place.
      setDeclineError(t('declineError'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <section
      aria-label={t('ariaLabel')}
      className="mt-4 rounded-2xl border border-primary/40 bg-card p-4"
    >
      <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">{eyebrow}</p>
      <p className="mt-1 text-[15px] font-medium leading-snug">{summary}</p>
      {/* Staleness as muted words — the age never expires the ask. */}
      <p className="mt-0.5 text-xs text-muted-foreground first-letter:uppercase">{ageLine}</p>
      <ul className="mt-2 space-y-1">
        {sentences.map((sentence, index) => (
          <li key={index} className="text-sm text-muted-foreground">
            {sentence}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        <Button className="flex-1" disabled={isPending} onClick={handleConfirm}>
          {t('applyAction')}
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
          {t('declineAction')}
        </Button>
      </div>
      {applyError && <p className="mt-2 text-sm text-destructive">{applyError}</p>}
      {isDeclineOpen && (
        <ConfirmDialog
          title={t('declineDialog.title')}
          body={t('declineDialog.body')}
          confirmLabel={t('declineDialog.confirm')}
          pendingLabel={t('declineDialog.pending')}
          error={declineError}
          isPending={isPending}
          onConfirm={handleDecline}
          onClose={() => setIsDeclineOpen(false)}
          closeRef={closeDeclineRef}
        />
      )}
    </section>
  )
}
