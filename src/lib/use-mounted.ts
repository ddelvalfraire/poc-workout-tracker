'use client'

import { useSyncExternalStore } from 'react'

/**
 * False on the server and through hydration, true from the first commit on.
 *
 * The gate for anything only the BROWSER can answer — the user's calendar day
 * (lib/local-day.ts), their clock, their sessionStorage. Rendering that on the
 * server would either drift from the client's answer (a hydration mismatch) or
 * bake the server's timezone into the page.
 *
 * useSyncExternalStore, not `useState` + `useEffect`: the effect form has to
 * setState during the mount commit, which cascades a second render and is what
 * `react-hooks/set-state-in-effect` is pointing at. React reads the server
 * snapshot (`false`) while rendering on the server and during hydration, then
 * the client snapshot (`true`) — one render, no cascade, no mismatch.
 *
 * `subscribeNever` returns a no-op unsubscribe because mountedness never
 * changes after the first commit — there is nothing to subscribe to.
 */
const subscribeNever = () => () => {}

export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )
}
