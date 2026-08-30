'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { recordPathname, reconcilePopstate } from '@/lib/back-navigation'

/**
 * Mounted ONCE in the root layout: mirrors the app's slice of the browser
 * history into the sessionStorage stack that canGoBack() reads (spike §3b).
 * Renders nothing.
 *
 * Ordering contract this component relies on: the browser fires popstate
 * BEFORE the App Router re-renders, so reconcilePopstate() has already
 * aligned the stack top when the usePathname effect runs — recordPathname
 * then no-ops instead of double-counting the pop as a push.
 *
 * Same-pathname history entries (overlay pushStates from
 * use-history-dismissable, ?page= pagination) never change usePathname and
 * are reconciled as no-ops in lib/back-navigation — the two modules
 * coordinate through that invariant, not through shared state.
 */
export function NavigationTracker() {
  const pathname = usePathname()

  useEffect(() => {
    // location.pathname (not React state) — at popstate time the browser has
    // already moved and React hasn't; the live URL is the only truth.
    const onPopstate = () => reconcilePopstate(window.location.pathname)
    window.addEventListener('popstate', onPopstate)
    return () => window.removeEventListener('popstate', onPopstate)
  }, [])

  useEffect(() => {
    recordPathname(pathname)
  }, [pathname])

  return null
}
