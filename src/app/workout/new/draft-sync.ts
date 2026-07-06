import type { DraftPayload } from './draft-payload'

/**
 * Write-behind sync queue for the cross-device draft: debounces bursts of
 * changes, keeps only the LATEST snapshot (a draft is a full replacement, so
 * older values are worthless), sends one attempt at a time, and — the point —
 * retries a failed send on a fixed interval instead of dropping it, so a gym
 * dead zone can't silently eat a session. The server stays the source of
 * truth; nothing is cached beyond the newest in-memory payload.
 *
 * Pure logic with injectable timers, kept free of React and the network (the
 * logger supplies the server actions as `send`/`remove`), so the whole state
 * machine unit-tests under fake timers like the other pure modules here.
 */

export type DraftSyncStatus = 'synced' | 'pending' | 'failed'

export interface DraftSyncQueue {
  /** Queue the newest snapshot; `null` means the draft was cleared (delete the row). */
  enqueue(payload: DraftPayload | null): void
  /** Attempt now, skipping debounce/retry waits — e.g. the browser came back online. */
  flush(): void
  /** Stop all sends (a save is in flight — it deletes the draft itself). */
  pause(): void
  /** Undo pause (the save failed); re-attempts the latest unsent value, if any. */
  resume(): void
  /**
   * Pause AND wait for any attempt already on the wire to finish (either way).
   * The save-time barrier: after this resolves, no put can land behind the
   * save action's draft delete and resurrect the row.
   */
  settle(): Promise<void>
}

export function createDraftSyncQueue(opts: {
  send: (payload: DraftPayload) => Promise<void>
  remove: () => Promise<void>
  onStatus: (status: DraftSyncStatus) => void
  debounceMs?: number
  retryMs?: number
  retryMaxMs?: number
}): DraftSyncQueue {
  const debounceMs = opts.debounceMs ?? 800
  const retryMs = opts.retryMs ?? 5_000
  const retryMaxMs = opts.retryMaxMs ?? 60_000

  // `latest` is the newest enqueued value not yet confirmed sent; `undefined`
  // means nothing is owed to the server ('null' is a real value: delete).
  let latest: DraftPayload | null | undefined
  // The current attempt's fully-handled promise (never rejects) — what
  // settle() awaits. Null when nothing is on the wire.
  let inFlight: Promise<void> | null = null
  // Consecutive failures since the last success, driving the backoff.
  let failures = 0
  let paused = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function setStatus(status: DraftSyncStatus) {
    opts.onStatus(status)
  }

  function clearTimer() {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  function schedule(delay: number) {
    clearTimer()
    timer = setTimeout(attempt, delay)
  }

  function attempt() {
    clearTimer()
    if (paused || inFlight !== null || latest === undefined) return
    const value = latest
    const work = value === null ? opts.remove() : opts.send(value)
    inFlight = work
      .then(() => {
        inFlight = null
        failures = 0
        if (latest === value) {
          // Nothing newer arrived while on the wire — all caught up.
          latest = undefined
          setStatus('synced')
        } else {
          // A newer snapshot superseded this one mid-flight; send it next.
          attempt()
        }
      })
      .catch(() => {
        inFlight = null
        failures += 1
        setStatus('failed')
        // Exponential backoff: base, 2x, 4x… capped. The `online` event
        // bypasses the wait entirely via flush().
        if (!paused) schedule(Math.min(retryMs * 2 ** (failures - 1), retryMaxMs))
      })
  }

  return {
    enqueue(payload) {
      latest = payload
      setStatus('pending')
      if (!paused) schedule(debounceMs)
    },
    flush() {
      attempt()
    },
    pause() {
      paused = true
      clearTimer()
    },
    resume() {
      paused = false
      attempt()
    },
    settle() {
      paused = true
      clearTimer()
      return inFlight ?? Promise.resolve()
    },
  }
}
