# PR Review: #40 — feat: bodyweight tracking — log, trend sparkline, history, prefs sync

**Reviewed**: 2026-07-10
**Author**: ddelvalfraire
**Branch**: feat/bodyweight-tracking → main
**Decision**: APPROVE (with comments)

## Summary
Clean, well-tested feature. The core invariant — `user_preferences.bodyweight_kg` re-derived transactionally from `max(weighed_at)` on every insert and delete — is correctly implemented and directly tested (backdated-entry no-clobber, delete-last-entry null degradation, ownership-gated delete). Server actions validate at the boundary; all writes are user-scoped; the sparkline is pure tested path math with a divide-by-zero guard. No CRITICAL or HIGH issues.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

**M1 — `setBodyweight` in `src/db/preferences.ts:75` is now dead code and a sync-invariant footgun.**
`setBodyweightAction` switched to `logBodyweight`; the only remaining reference to `setBodyweight` is its own test (`src/db/preferences.test.ts:111`). Beyond being dead, it writes `user_preferences.bodyweight_kg` directly with no history row — any future caller would silently desync the current value from the log table this PR establishes as the source of truth. Suggest removing the function and its test in a follow-up (kept out of this PR is fine for diff hygiene, but don't let it linger).

**M2 — Index doesn't cover the sort.**
Both queries (`listBodyweightLogs`, the freshest-row resync) filter by `user_id` and order by `weighed_at DESC`, but `bodyweight_logs_user_id_idx` is on `user_id` alone, so each read sorts the user's rows. Harmless at personal-tracker scale; a composite `(user_id, weighed_at DESC)` would fully serve both access paths if this ever matters. Optional.

### LOW

**L1 — 30d delta can vanish under the 60-row cap.** `bodyweightDeltaKg` searches only the 60 fetched rows for a baseline at/before the cutoff. A user logging more than 60 entries within 30 days pushes the baseline off the list and the delta silently disappears despite the data existing. The cap is documented ("~two months of daily logging"); acceptable tradeoff, noting for the record.

**L2 — Sub-precision inputs round to a stored 0.00.** A pathological input like `0.01` lb converts to ~0.0045 kg, passes the `> 0` check, and `numeric(5,2)` rounds it to `0.00` — a zero current bodyweight that e1RM scoring will read. Similarly `formatDelta` renders "+0 lb" for deltas under 0.05 kg. Both need deliberately silly input; a `>= 0.01 kg` post-conversion floor would close it if you ever care.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (PR files) | Pass — 0 problems in changed files (repo-wide eslint noise is pre-existing, outside this PR) |
| Tests (`vitest run`) | Pass — 866/866 (22 new for this feature) |
| Build (`next build`) | Pass |

## Notes on things checked and found correct
- Ownership: every query in `src/db/bodyweight.ts` filters by `userId`; delete proves ownership via `delete … returning`.
- Backdated entries cannot clobber current (re-derive from freshest, never copy the written value) — tested.
- Deleting the last entry nulls the pref so scoring degrades to the rep fallback — tested.
- Action boundary: finite/positive check pre-conversion, 500 kg ceiling post-conversion against the stored unit (stale client can't convert against the wrong unit); UUID shape guard on the delete path (lowercase-only is intentional and tested).
- UX details match app idioms: ConfirmDialog imperative close before refresh (stranded-backdrop race), error text kept visible, volt reserved for the single primary action, sparkline aria-label carries the actual range.
- Migration 0012 is additive only (one table + index); journal and snapshot are consistent.

## Files Reviewed
- drizzle/0012_slippery_bill_hollister.sql — Added
- drizzle/meta/0012_snapshot.json — Added
- drizzle/meta/_journal.json — Modified
- src/app/actions.test.ts — Modified
- src/app/actions.ts — Modified
- src/app/bodyweight/entry-row.tsx — Added
- src/app/bodyweight/log-form.tsx — Added
- src/app/bodyweight/page.tsx — Added
- src/app/settings/page.tsx — Modified
- src/components/bodyweight-editor.tsx — Deleted
- src/db/bodyweight.test.ts — Added
- src/db/bodyweight.ts — Added
- src/db/schema.ts — Modified
- src/lib/bodyweight-trend.test.ts — Added
- src/lib/bodyweight-trend.ts — Added
- src/lib/sparkline.test.ts — Added
- src/lib/sparkline.ts — Added
