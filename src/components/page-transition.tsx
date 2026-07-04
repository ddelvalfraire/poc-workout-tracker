/// <reference types="react/canary" />
'use client'

import { ViewTransition } from 'react'

// Client boundary so the (server) root layout can opt every route change into
// a view transition. The "page" view-transition class is animated in
// globals.css; browsers without the View Transitions API just skip the
// animation and navigate normally.
export function PageTransition({ children }: { children: React.ReactNode }) {
  return <ViewTransition default="page">{children}</ViewTransition>
}
