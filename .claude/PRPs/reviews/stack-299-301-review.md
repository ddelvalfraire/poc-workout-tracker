# Stack Review: #299 → #300 → #301 (exercise catalog)

**Reviewed**: 2026-08-27
**Branches**: `swapped-muscle-display-bug` → `exercise-catalog-resolver` → `wger-stale-catalog`
**Decision**: APPROVE (2 MEDIUM findings fixed in-review; 2 LOW accepted)

## Summary

Three commits: a display bug, the consolidation it exposed, and the upstream
dependency that consolidation put under a spotlight. No CRITICAL or HIGH
findings. Two MEDIUM findings were fixed during review; two LOW are accepted
and documented below.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

**M1 — v2 key bump opened the exact outage window the PR closes.** `#301`,
`src/lib/wger.ts`. Renaming the Redis key to `v2` means that on the deploy
shipping this change, `v2` is absent. A wger outage in that window had no
fallback — while a perfectly good `v1` snapshot sat unread in Redis. The change
designed to remove the upstream dependency would briefly have made it worse.
*Fixed*: `readCatalogFromRedis` falls back to the `v1` key, dating it to the
epoch so a bare undated array is permanently stale — it can never suppress a
refresh, only rescue one that fails. Two tests added (rescue-on-failure, and
that it loses to a healthy upstream).

**M2 — `cache()` memo is pre-write within a request.** `#300`,
`src/db/exercise-catalog.ts`. Memoizing the loader means a request that CREATES
a custom exercise and then reads the catalog gets the pre-write copy: the new
exercise resolves as unknown (untagged muscles, empty category). Verified no
current flow does this — `createCustomExerciseAction` and the MCP
`create_custom_exercise` tool both return immediately without a catalog read —
so this is a latent footgun, not a live bug. *Fixed*: documented in the loader's
contract, directing future write-then-read paths to `listCustomExercises`.

### LOW

**L1 — retry floor is per-instance (accepted).** `STALE_RETRY_MS` lives in the
`globalThis` singleton, so each serverless instance retries a down upstream
independently; the floor does not coordinate across the fleet. Coordinating it
would mean a Redis-backed circuit breaker — more machinery than a 5-minute
backoff on a rarely-down public API justifies.

**L2 — whitespace-only reformat (accepted).** `#300`,
`src/app/workout/new/page.tsx`: the second `Promise.all` block re-wrapped when
an element was added and later removed. The repo has no Prettier config; the
rewrap keeps lines under 80 where the original ran to ~105. Reverting would
mean a rebase across two stacked branches for whitespace.

## Verified, not flagged

- `muscleRowsFor`'s refactor to `catalogMuscles` preserves the original
  early-return: an unknown `(source, id)` yields empty arrays, so the mapped
  result is `[]` exactly as the `if (!entry) return []` guard produced.
- `buildMuscleResolver` deliberately keeps `Promise.all`. Folding it into the
  tolerant loader would silently reattribute every wger exercise to the `Other`
  volume bucket on an outage, instead of erroring. Left for its own change.
- The in-flight collapse (`catalogInflight`) is assigned in the same
  synchronous block as the IIFE that populates it, so no caller can interleave
  between creation and registration.
- Retry-floor expiry traces correctly: stale + floor passed → Redis → upstream
  → on failure re-serves the fallback and re-arms the floor.

## Validation

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint`) | Pass |
| Tests (`vitest run`) | Pass — 439 files, 5415 tests |
| Build | Not run (test + typecheck cover the change surface) |

## Not covered by tests

The retention TTL's real benefit is that the Redis key still EXISTS after 24h.
That is server-side expiry, not app logic — unit tests cannot prove it. Worth
confirming on staging that `wger:exercise-catalog:v2` outlives a day.
