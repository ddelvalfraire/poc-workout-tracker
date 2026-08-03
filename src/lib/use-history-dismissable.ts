'use client'

import { useEffect, useState } from 'react'

/**
 * Overlays are history entries (spike §3d-bis, the Twitter-photo-modal
 * rule): opening an overlay pushes a same-URL history entry carrying a UI
 * flag, so the system back / iOS edge-swipe CLOSES the overlay instead of
 * leaving the page; programmatic close consumes that entry with
 * history.back() so overlay ghosts never accumulate.
 *
 * Same-URL pushState is the shallow-routing case Next 16 officially
 * supports (native History API integration) — the pathname never changes,
 * so NavigationTracker's usePathname effect never fires and
 * reconcilePopstate treats the consuming popstate as a same-top no-op.
 * That invariant is the whole coordination contract between the two
 * modules; breaking it (pushing a DIFFERENT URL here) would corrupt the
 * back stack.
 *
 * The Next router's own state lives in history.state: every write here
 * SPREADS the existing state and only adds/removes the one flag key —
 * replacing the object wholesale would strand the router's tree.
 */

/** history.state key marking an entry as an open overlay's. */
const FLAG = '__historyDismissable'

/** Per-hook-instance id so two mounted overlays never consume each other's
 *  entries (drawer + photo overlay can coexist in one tree). */
let nextInstanceId = 1

interface HistoryLike {
  readonly state: unknown
  pushState(data: unknown, unused: string, url?: string): void
  replaceState(data: unknown, unused: string, url?: string): void
  back(): void
}

function flagOf(state: unknown): number | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const value = (state as Record<string, unknown>)[FLAG]
  return typeof value === 'number' ? value : undefined
}

function withFlag(state: unknown, id: number): Record<string, unknown> {
  const base = typeof state === 'object' && state !== null ? (state as object) : {}
  return { ...base, [FLAG]: id }
}

function withoutFlag(state: unknown): Record<string, unknown> {
  const base = typeof state === 'object' && state !== null ? { ...(state as object) } : {}
  delete (base as Record<string, unknown>)[FLAG]
  return base
}

/**
 * The framework-free core, extracted so the re-entrancy matrix (double
 * open, rapid open/close, close-while-navigating, back-while-open) is unit
 * testable in Node against a fake history. The hook below is only wiring.
 */
export class HistoryDismissableController {
  private readonly id: number
  private isPushed = false
  private isOpen = false
  /** Invoked when the system back consumes the entry. Wired after
   *  construction (the hook does it in an effect) so constructing during
   *  render never captures render-time values. */
  private onClose: () => void = () => {}

  setOnClose(onClose: () => void): void {
    this.onClose = onClose
  }

  constructor(
    private readonly history: HistoryLike,
    private readonly currentUrl: () => string,
  ) {
    this.id = nextInstanceId++
  }

  /** Sync the controller with the overlay's React open state. Idempotent —
   *  effects may re-fire with an unchanged value (StrictMode). */
  setOpen(open: boolean): void {
    if (open && !this.isPushed) {
      // Reload-on-overlay-entry hygiene: if the CURRENT entry already
      // carries a stale flag (page reloaded while an overlay was open),
      // strip it in place instead of stacking a second flagged entry.
      if (flagOf(this.history.state) !== undefined) {
        this.history.replaceState(withoutFlag(this.history.state), '', this.currentUrl())
      }
      this.history.pushState(withFlag(this.history.state, this.id), '', this.currentUrl())
      this.isPushed = true
    } else if (!open && this.isOpen) {
      this.consumeEntry()
    }
    this.isOpen = open
  }

  /** Popstate arrived. If our entry was just consumed by the system back,
   *  close the overlay — WITHOUT calling history.back() again. */
  handlePopstate(): void {
    if (!this.isPushed) return
    if (flagOf(this.history.state) === this.id) return // moved ONTO our entry
    this.isPushed = false // the browser already consumed the entry
    if (this.isOpen) {
      this.isOpen = false
      this.onClose()
    }
  }

  /**
   * The overlay is closing because the user chose a NAVIGATION out of it
   * (e.g. a drawer link). history.back() here would race the router's own
   * pushState — the router pushes synchronously in the click while back()
   * resolves async, and the interleave can strand the user one entry short
   * of their destination. Instead the flag is stripped in place: the entry
   * degrades to an inert same-URL duplicate (one extra back press in that
   * one flow — the documented trade for never losing a forward nav).
   */
  dismissForNavigation(): void {
    if (!this.isPushed) return
    if (flagOf(this.history.state) === this.id) {
      this.history.replaceState(withoutFlag(this.history.state), '', this.currentUrl())
    }
    this.isPushed = false
    this.isOpen = false
  }

  /** Unmount while open (overlay components that mount = open). */
  destroy(): void {
    if (this.isOpen) this.consumeEntry()
    this.isOpen = false
  }

  private consumeEntry(): void {
    if (!this.isPushed) return
    this.isPushed = false
    // Only pop if the top entry is still OURS — after a navigation or an
    // already-processed popstate it isn't, and back() would eat a real page.
    if (flagOf(this.history.state) === this.id) this.history.back()
  }
}

/**
 * Wire an overlay's controlled open state to a history entry. `onClose`
 * must actually close the overlay (set state / unmount); it is invoked
 * when the system back consumes the entry.
 *
 * Returns dismissForNavigation for close-paths that immediately navigate
 * (see the controller's comment for why those must not pop).
 */
export function useHistoryDismissable(
  isOpen: boolean,
  onClose: () => void,
): { dismissForNavigation: () => void } {
  // One controller per mounted overlay — lazy useState init keeps the
  // instance stable across renders; the latest onClose closure is wired in
  // an effect so render never touches mutable state.
  const [controller] = useState(
    () => new HistoryDismissableController(window.history, () => window.location.href),
  )
  useEffect(() => {
    controller.setOnClose(onClose)
  }, [controller, onClose])

  useEffect(() => {
    const onPopstate = () => controller.handlePopstate()
    window.addEventListener('popstate', onPopstate)
    return () => {
      window.removeEventListener('popstate', onPopstate)
      controller.destroy()
    }
  }, [controller])

  useEffect(() => {
    controller.setOpen(isOpen)
  }, [controller, isOpen])

  return { dismissForNavigation: () => controller.dismissForNavigation() }
}
