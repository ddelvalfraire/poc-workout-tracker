'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'

/**
 * The coach AI disclosure (in-product-copy.md §3; Utah AI Act's proactive
 * tier for health-adjacent AI). Two pieces, per the AI-transparency
 * research: ONE first-open interstitial, then a structural label on the
 * surface (CoachChat renders that strip) — never per-message banners, which
 * train banner blindness.
 *
 * Acknowledgement is per-DEVICE (localStorage), deliberately: a new device
 * re-shows the interstitial once, which errs protective for a proactive-
 * disclosure obligation, and needs no schema. The persistent strip carries
 * the disclosure for every session either way.
 *
 * The dialog itself uses the repo's one dialog vocabulary (confirm-dialog
 * mechanics: StrictMode-guarded showModal, body scroll lock, initial focus,
 * close + focus restore) — the native top layer is what actually keeps the
 * composer unreachable until the user has seen this.
 */

const ACK_KEY = 'coach-ai-disclosure-ack'
const listeners = new Set<() => void>()

function readAck(): boolean {
  try {
    return localStorage.getItem(ACK_KEY) === '1'
  } catch {
    // Storage unavailable: show the interstitial each visit rather than
    // never (the protective direction for first render; the session state
    // below still guarantees dismissal works).
    return false
  }
}

export function acknowledgeCoachDisclosure(): void {
  try {
    localStorage.setItem(ACK_KEY, '1')
  } catch {
    // Unpersistable ack is fine: the caller also dismisses via local state.
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** SSR snapshot says acked so the overlay never flashes during hydration. */
export function useCoachDisclosureAcked(): boolean {
  return useSyncExternalStore(subscribe, readAck, () => true)
}

export function CoachDisclosure() {
  const ackedPersisted = useCoachDisclosureAcked()
  // Session dismissal is independent of storage: a browser that rejects the
  // localStorage write (private-mode quota splits) must still let "Got it"
  // close the dialog — otherwise it reopens forever with no way out.
  const [dismissed, setDismissed] = useState(false)
  if (ackedPersisted || dismissed) return null
  return (
    <DisclosureDialog
      onAcknowledge={() => {
        acknowledgeCoachDisclosure()
        setDismissed(true)
      }}
      onDismiss={() => setDismissed(true)}
    />
  )
}

function DisclosureDialog({
  onAcknowledge,
  onDismiss,
}: {
  onAcknowledge: () => void
  onDismiss: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const gotItRef = useRef<HTMLButtonElement>(null)

  // confirm-dialog.tsx mechanics, copied: StrictMode-guarded showModal,
  // manual body scroll lock, initial focus, close() + focus restore.
  useEffect(() => {
    const dialog = dialogRef.current
    const active = document.activeElement
    const previouslyFocused =
      active instanceof HTMLElement && !dialog?.contains(active) ? active : null
    if (dialog && !dialog.open) dialog.showModal()
    gotItRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      if (dialog?.open) dialog.close()
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  return (
    // m-auto centers a <dialog> on both axes in the top layer. No backdrop
    // click-to-close: a must-see disclosure shouldn't vanish on a stray tap;
    // Esc (onCancel) dismisses for the session only — it re-shows next
    // visit, while "Got it" persists the acknowledgement.
    <dialog
      ref={dialogRef}
      aria-labelledby="coach-disclosure-title"
      onCancel={(e) => {
        e.preventDefault()
        onDismiss()
      }}
      className="m-auto w-full max-w-md border border-border bg-background p-0 text-foreground backdrop:bg-background/80 backdrop:backdrop-blur-sm"
    >
      <div className="px-6 pt-6 pb-8">
        <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Before you start
        </p>
        <h2 id="coach-disclosure-title" className="mt-2 text-xl font-semibold tracking-tight">
          Coach is an AI
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          It knows your training history and can suggest changes to your program — but it can
          make mistakes, and it isn&apos;t a doctor. Check anything that matters, and see a
          physician before making health decisions.
        </p>
        <Button ref={gotItRef} type="button" size="lg" className="mt-6 w-full" onClick={onAcknowledge}>
          Got it
        </Button>
      </div>
    </dialog>
  )
}
