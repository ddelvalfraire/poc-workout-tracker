'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * Opt-in 60s polling for the ops board. Off by default — the board is a
 * pull-based surface and vendors have rate limits — and the choice persists
 * for the tab session only (sessionStorage, like the check-in card's
 * dismissal). When on, router.refresh() re-runs the server render, which
 * re-hits every source with its own timeout/degrade.
 *
 * State lives in sessionStorage behind useSyncExternalStore: the server
 * snapshot is `false`, the client snapshot re-reads storage after writes, so
 * SSR and hydration stay consistent without a setState-in-effect.
 */

const REFRESH_INTERVAL_MS = 60_000
const STORAGE_KEY = 'ops:auto-refresh'

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function readEnabled(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // Storage blocked (private mode) — stay off.
    return false
  }
}

function writeEnabled(next: boolean): void {
  try {
    if (next) sessionStorage.setItem(STORAGE_KEY, '1')
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Best-effort: without storage the toggle just won't persist.
  }
  for (const listener of listeners) listener()
}

export function AutoRefreshToggle() {
  const router = useRouter()
  const enabled = useSyncExternalStore(subscribe, readEnabled, () => false)

  useEffect(() => {
    if (!enabled) return
    const interval = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [enabled, router])

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => writeEnabled(!enabled)}
      className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs uppercase tracking-wider text-muted-foreground outline-none transition-colors hover:border-muted-foreground/40 focus-visible:border-primary"
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-2 rounded-full transition-colors',
          enabled ? 'bg-primary' : 'bg-muted-foreground/40',
        )}
      />
      Auto 60s
    </button>
  )
}
