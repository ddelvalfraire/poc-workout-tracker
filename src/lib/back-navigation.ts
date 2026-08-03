/**
 * Back-navigation mechanics (spike §3a/§3b/§3d): one shared answer to
 * "do we own the previous history entry?" so every back affordance can POP
 * (router.back) when the app owns history and REPLACE to a canonical parent
 * only on cold entries (deep link / fresh PWA launch). `history.length` is
 * useless for this — it counts pre-app entries and never shrinks — so the
 * app tracks its own stack of pathnames in sessionStorage (per-tab, survives
 * reload alongside the real history it mirrors).
 *
 * MECHANISM (why a pathname stack, not a bare counter): pops are detected in
 * the popstate handler by comparing the post-pop location against the stack,
 * which a counter cannot do — and a stack lets us keep a forward list so a
 * pop→forward-swipe round trip reconciles instead of drifting. Pushes are
 * recorded on App Router pathname changes; our own replaces announce
 * themselves via markReplace() (monkey-patching history is forbidden — the
 * router owns those methods).
 *
 * SYNTHETIC STACKS (spike §3a) — investigated and REJECTED, not skipped:
 * Next 16's native-history integration is SHALLOW-only. Per the official
 * docs (app/getting-started/linking-and-navigating, v16.3), pushState /
 * replaceState "integrate into the Next.js Router, allowing you to sync
 * with usePathname and useSearchParams" — they update URL state but never
 * fetch the target route's RSC payload. Rebuilding a parent entry beneath a
 * cold-entered detail page (replaceState(parent) → pushState(current))
 * therefore creates a parent-URL entry whose stored router tree is the
 * DETAIL page's: an iOS edge-swipe onto it renders the child under the
 * parent URL, and the transient replaceState(parent) fires a spurious
 * usePathname change through the whole app. The spike's sanctioned degraded
 * path ships instead: on cold entry canGoBack() is false and BackLink does
 * router.replace(fallback).
 *
 * KNOWN FAILURE MODES (all degrade toward the SAFE branch — replace to the
 * canonical parent — never toward popping out of the app):
 * - Same-pathname entries (?page= pagination, overlay pushStates) are
 *   invisible to usePathname, so depth UNDER-counts there: a chevron may
 *   replace(fallback) where a pop was possible. Safe by design; this is
 *   also the explicit coordination contract with use-history-dismissable —
 *   overlay entries never touch this stack.
 * - Replaces we don't control (server redirect() during a soft nav,
 *   auth-wall bounces) are recorded as pushes → depth can OVER-count by
 *   one. Two guards: markReplace() covers every replace in our code, and
 *   where the Navigation API exists (Chromium) navigation.canGoBack === false
 *   VETOES a stale stack before router.back() can exit the app.
 * - Multi-entry jumps (history.go(n), back-button long-press menus — absent
 *   in the standalone PWA) reconcile to an unknown location → the stack
 *   RESETS to [here] and back affordances degrade to their fallback.
 * - sessionStorage denied (some private modes) → every read fails closed:
 *   canGoBack() is false, back affordances always replace(fallback).
 */

const STACK_KEY = 'nav:stack'
const FORWARD_KEY = 'nav:forward'
const REPLACE_KEY = 'nav:replace-pending'
/** Bound the persisted stack; beyond this, oldest entries slide off and the
 *  worst case is a fallback-replace instead of a pop — safe. */
const MAX_DEPTH = 50

/** The slice of next/navigation's router the mechanics need. */
export interface BackRouter {
  back(): void
  replace(href: string): void
}

/** Narrow Navigation API surface (Chromium-only, progressive enhancement).
 *  Only canGoBack is consumed — declaring more would be speculation. */
interface NavigationApiLike {
  readonly canGoBack: boolean
}

declare global {
  interface Window {
    navigation?: NavigationApiLike
  }
}

function readList(key: string): string[] {
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return [] // storage denied or corrupt → fail closed (no owned history)
  }
}

function writeList(key: string, list: string[]): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(list.slice(-MAX_DEPTH)))
  } catch {
    // Storage denied: reads will keep returning [] — consistent fail-closed.
  }
}

function consumePendingReplace(): boolean {
  try {
    const pending = window.sessionStorage.getItem(REPLACE_KEY) === '1'
    if (pending) window.sessionStorage.removeItem(REPLACE_KEY)
    return pending
  } catch {
    return false
  }
}

/**
 * Announce that the NEXT recorded pathname change is a replace, not a push
 * (stack hygiene, spike §3d). Must be called immediately before every
 * router.replace() in app code — the App Router gives the tracker no
 * push-vs-replace signal of its own.
 */
export function markReplace(): void {
  try {
    window.sessionStorage.setItem(REPLACE_KEY, '1')
  } catch {
    // Degrades to a push mis-record; the over-count guards above apply.
  }
}

/**
 * Record an App Router pathname change (NavigationTracker's usePathname
 * effect). Pops never reach here as stack mutations: popstate fires before
 * the router re-renders, so reconcilePopstate() has already aligned the top
 * and this call no-ops on `top === pathname`.
 */
export function recordPathname(pathname: string): void {
  const stack = readList(STACK_KEY)
  const isReplace = consumePendingReplace()
  const top = stack[stack.length - 1]
  if (top === pathname) return // cold re-init after reload, or replace-to-same
  if (stack.length === 0) {
    writeList(STACK_KEY, [pathname])
    return
  }
  const next = isReplace ? [...stack.slice(0, -1), pathname] : [...stack, pathname]
  writeList(STACK_KEY, next)
  writeList(FORWARD_KEY, []) // any real forward travel prunes the forward list
}

/**
 * Reconcile the stack against a popstate. `pathname` must be the LIVE
 * window.location.pathname at event time — the browser has already moved.
 */
export function reconcilePopstate(pathname: string): void {
  const stack = readList(STACK_KEY)
  const forward = readList(FORWARD_KEY)
  const top = stack[stack.length - 1]
  if (pathname === top) {
    // Same-pathname popstate: an overlay's history entry being consumed
    // (use-history-dismissable), or a search-param-only entry. Not ours.
    return
  }
  if (stack.length >= 2 && pathname === stack[stack.length - 2]) {
    // A true pop: retire the top onto the forward list so a forward-swipe
    // can reconcile instead of resetting.
    writeList(STACK_KEY, stack.slice(0, -1))
    writeList(FORWARD_KEY, [...forward, top ?? pathname])
    return
  }
  if (forward.length > 0 && pathname === forward[forward.length - 1]) {
    // Forward navigation back onto an entry we popped earlier.
    writeList(STACK_KEY, [...stack, pathname])
    writeList(FORWARD_KEY, forward.slice(0, -1))
    return
  }
  // Unknown jump (multi-step traversal, drifted stack): resync to reality.
  // Depth 1 = canGoBack false → back affordances take the safe fallback.
  writeList(STACK_KEY, [pathname])
  writeList(FORWARD_KEY, [])
}

/**
 * Does the app own the previous history entry? Both signals must agree
 * before a pop is allowed:
 * - Our stack must be deeper than 1 (the app SAW an earlier page). The
 *   Navigation API cannot replace this check — its canGoBack is true even
 *   when the previous entry is the pre-app page a deep link came from, and
 *   popping there would exit the app.
 * - Where the Navigation API exists (Chromium), canGoBack === false vetoes
 *   a stale over-counted stack (progressive enhancement, spike §2).
 */
export function canGoBack(): boolean {
  if (typeof window === 'undefined') return false
  if (window.navigation?.canGoBack === false) return false
  return readList(STACK_KEY).length > 1
}

/**
 * The one shared back operation (BackLink + the logger's confirm-exit):
 * pop when the app owns the previous entry, otherwise REPLACE to the
 * canonical parent — a back affordance must never push (spike §3d).
 */
export function navigateBack(router: BackRouter, fallback: string): void {
  if (canGoBack()) {
    router.back()
    return
  }
  markReplace()
  router.replace(fallback)
}
