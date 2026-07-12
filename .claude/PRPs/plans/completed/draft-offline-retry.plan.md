# Plan: Offline-Tolerant Draft Autosave (retry queue)

## Summary
A failed draft sync is currently silent and dropped — a gym dead zone can eat a session until the next keystroke happens to re-fire the debounce. Extract the autosave into a pure `DraftSyncQueue` (debounce, single-flight, fixed-interval retry, pause/resume) with injectable timers so it's fully unit-testable, flush immediately on the browser `online` event, and surface a quiet "offline" hint when a sync has failed. Server remains the source of truth.

## Problem → Solution
`sync.catch(() => {})` in the logger's persist effect swallows failures with no retry and no signal → a queue that keeps the latest payload, retries every 5 s while failed, flushes on `online`, pauses during save (replacing `savingRef`), and reports status to the UI.

## Metadata
- **Complexity**: Small-Medium
- **Estimated Files**: 5 (queue + test, logger, e2e, plan)

## Design Decisions
- **Pure queue module** (`draft-sync.ts`): `createDraftSyncQueue({ send, remove, onStatus, debounceMs=800, retryMs=5000, schedule=setTimeout, cancel=clearTimeout })` → `{ enqueue(payload|null), flush(), pause(), resume() }`. `null` payload = empty draft → `remove`. Latest-wins: only the newest enqueued value is ever sent; one attempt in flight at a time; a value enqueued mid-flight triggers a follow-up attempt. Status: `'synced' | 'pending' | 'failed'`.
- **Logger wiring**: persist effect becomes `queue.enqueue(...)` (skip-first-run + `dirtyRef` gating unchanged); `savingRef` is replaced by `queue.pause()` on save start / `queue.resume()` on save failure; `window 'online'` listener calls `queue.flush()`; unmount pauses.
- **UI**: an amber "Offline — changes will sync when you're back" line appears only in `failed` state (pending is the constant typing state — showing it would be noise). Rendered near the session clock.
- **e2e**: Playwright `context.setOffline(true)` → type → indicator appears, no draft row; `setOffline(false)` → `online` flush → row appears with the value.
- **NOT building**: durable offline cache (no localStorage — user decision stands), background sync API, multi-payload queues (latest-wins is correct for a snapshot).

## TDD order
1. RED: `draft-sync.test.ts` with fake timers — debounce coalescing, success → synced, failure → failed + retry at retryMs, flush() immediate attempt, latest-wins mid-flight, enqueue(null) → remove, pause blocks retries, resume re-attempts.
2. GREEN: implement `draft-sync.ts`.
3. Wire logger; type/lint/build.
4. e2e offline round-trip.
