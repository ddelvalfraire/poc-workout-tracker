# PR Review: #16 — feat: offline-tolerant draft autosave (retry queue)

**Reviewed**: 2026-07-05
**Branch**: `feat/draft-offline-retry` → `main` (1 commit, 4 files, +362/−23)
**Decision**: APPROVE
**Update**: the two LOW accepted-risk notes below were subsequently FIXED in `64d9a49` at the user's request — exponential backoff (base→2x→4x, 60 s cap, reset on success) and a `settle()` save-time barrier that awaits any in-flight put before the save runs. 634 tests, build, and live e2e re-validated. Library evaluation: TanStack Query covers retry/backoff but not latest-wins supersede or the save barrier, so the tested in-house queue stays.

## Summary
The autosave moves into a pure write-behind queue (`draft-sync.ts`) — debounce, latest-wins, single-flight, 5 s retry, pause/resume — built test-first with fake timers, and the logger wiring shrinks to an enqueue call plus an `online` listener. The design keeps every failure mode in unit-testable code; the one integration bug (StrictMode leaving the queue permanently paused via an asymmetric effect cleanup) was caught by the live e2e during development and fixed before this review.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

### LOW (accepted, documented — not fixed)
1. **In-flight put vs. save delete** (`workout-logger.tsx` / `draft-sync.ts`)
   `pause()` clears timers but cannot cancel a request already on the wire. If a put is in flight at the instant Save is clicked AND the server completes the save action's delete before that earlier put lands, the draft row resurrects. In practice the put (a single upsert) settles well before the save transaction finishes; worst case is bounded by the 12 h TTL and the restore validators. Far narrower than the debounce race this PR's predecessor fixed. Accepted for the POC.
2. **Fixed 5 s retry, no backoff or cap** (`draft-sync.ts`)
   A persistent server error (not just offline) retries every 5 s for as long as the logger is open. Each attempt is one tiny POST and the loop dies with the page; backoff is an easy later tweak if it ever matters. Accepted.

## Checked and clean
- **Correctness**: latest-wins uses reference equality on fresh payload objects (correct); a value enqueued mid-flight triggers exactly one follow-up; `enqueue(null)` maps to delete; skip-first-run still prevents a mount-time write; `resume()` on save failure re-arms the latest snapshot; effect setup/cleanup pair is symmetric (resume/pause) so StrictMode's double-invoke cannot strand the queue.
- **State discipline**: queue created once via `useState` initializer (render-safe, unlike the ref-in-render pattern the React lint rejected); `onStatus` → `setSyncStatus` benefits from React's same-value bailout during typing bursts.
- **A11y**: the offline hint is a `role="status"` live region; it renders only in `failed` state so screen readers aren't spammed by the constant `pending` churn.
- **Security**: no new surface — the queue calls the existing validated server actions; nothing cached client-side beyond the newest in-memory payload (no localStorage, consistent with the #15 decision).
- **Tests**: 8 fake-timer specs cover the queue's full state machine (629 total); the live e2e adds a real offline round-trip via `context.setOffline` and passed three consecutive runs; the jsonb assertion uses a path operator after `::text` LIKE proved unmatchable against Postgres's spaced rendering.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (scoped to touched files) | Pass — repo-wide lint remains broken on main (vendored bundles), pre-existing |
| Unit tests | Pass (629) |
| Build | Pass |
| E2E `workout.spec.ts` (live) | Pass ×3 consecutive |

## Files Reviewed

| File | Change |
|---|---|
| `src/app/workout/new/draft-sync.ts` | Added |
| `src/app/workout/new/draft-sync.test.ts` | Added |
| `src/app/workout/new/workout-logger.tsx` | Modified |
| `e2e/workout.spec.ts` | Modified |
