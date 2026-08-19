'use client'

import { useSyncExternalStore } from 'react'
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
 */

const ACK_KEY = 'coach-ai-disclosure-ack'
const listeners = new Set<() => void>()

function readAck(): boolean {
  try {
    return localStorage.getItem(ACK_KEY) === '1'
  } catch {
    // Storage unavailable (private mode edge cases): show the interstitial
    // each visit rather than never.
    return false
  }
}

export function acknowledgeCoachDisclosure(): void {
  try {
    localStorage.setItem(ACK_KEY, '1')
  } catch {
    // Unpersistable ack still dismisses for this page's lifetime via notify.
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
  const acked = useCoachDisclosureAcked()
  if (acked) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="coach-disclosure-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/90 backdrop-blur-sm sm:items-center"
    >
      <div className="w-full max-w-md border-t border-border bg-background px-6 pt-6 pb-8 sm:rounded-lg sm:border">
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
        <Button
          type="button"
          size="lg"
          className="mt-6 w-full"
          onClick={acknowledgeCoachDisclosure}
        >
          Got it
        </Button>
      </div>
    </div>
  )
}
