# Code Review: feat/in-session-tracking (local branch review)

> Two review rounds on this branch: Round 1 covered the in-session tracking slices; Round 2 (below, appended 2026-07-05) covered the cross-device draft sync pivot.

**Reviewed**: 2026-07-05
**Branch**: `feat/in-session-tracking` → `main` (5 commits, 16 files, +628/−26)
**Decision**: APPROVE (both findings fixed in `78ad8d2` before this report)

## Summary
Set completion check-off, localStorage draft persistence, and a live session clock. Validation boundaries are consistent with house style (`parseWorkoutInput`-style field walks, storage treated as untrusted), state stays in pure reducer/codec modules, and the DB write path required only a one-line change because save and update share `insertWorkoutChildren`. Two issues found; both fixed on the branch.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
1. **`workout-logger.tsx` — persist effect's mount run could clobber the snapshot** (FIXED in `78ad8d2`)
   `restoredRef` was set synchronously inside the restore effect, so the persist effect's mount run — which still closes over the first render's server-seeded draft — passed the guard and wrote the seed over the snapshot. The restored state's re-render immediately rewrote it, so the end state was correct, but a tab close inside that window lost the restore. Fix: the persist effect now skips its own first run (`skipPersistRef`); nothing user-entered exists at mount, so there is nothing to persist until a change or the restore re-fires it.

### LOW
2. **`workout-logger.tsx` — dead `before:content-[""]` class** (FIXED in `78ad8d2`)
   Tailwind v4 injects `content: var(--tw-content)` automatically on `before:` variants (verified in compiled CSS: `before\:-inset-1\.5:before{content:var(--tw-content);inset:…}`); the explicit class compiled to nothing. Removed.

## Checked and clean
- **Security**: no secrets; localStorage holds only the user's own draft; `completed` validated at the parse boundary (non-boolean throws); all queries remain user-scoped through the existing ownership gates; no injection surface (Drizzle params only).
- **Correctness**: `draftToInput` omits `completed` when false (DB default covers it); `detailToDraft` round-trips checks and `resetCompleted` protects the repeat flow; edit saves still never send `startedAt` (preserving backdated sessions); TTL/version/unit/clock-skew all reject stale snapshots; clock renders post-mount only (no hydration mismatch) and nulls out past the 6 h ceiling.
- **A11y**: toggle is a real `<button>` with `aria-pressed` + `aria-label`; tap target expanded via `before:` inset toward HIG size.
- **Tests**: 594 unit tests pass (21 new across contract, DB, reducer, codec, formatter); e2e asserts `completed` lands in Postgres.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (scoped to touched files) | Pass — repo-wide `npm run lint` fails identically on main (sweeps vendored bundles); pre-existing |
| Unit tests | Pass (594) |
| Build | Pass |
| E2E `workout.spec.ts` | Pass (live Clerk/Supabase) — `edit-delete`/`repeat` fail identically on main (today-strip locator collision); pre-existing |

## Files Reviewed
All 16 changed files (source + tests + e2e), read in full.

---

# Round 2: Cross-Device Draft Sync (commits `34e0ccc` → `ae4cd55`)

**Reviewed**: 2026-07-05
**Decision**: APPROVE (all findings fixed in `ae4cd55` before this report)

## Summary
Server-side `workout_drafts` replaces localStorage as the draft source of truth. The wire has validation on both sides (structural guard + 32 KB cap on put; shape/unit re-check on restore), TTL runs against the authoritative `updated_at`, and the two client races (slow restore clobbering typed input; pending debounce resurrecting a just-deleted draft) were closed in the feature commit itself. Review found four issues, all fixed.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
1. **`actions.ts`/`workout-drafts.ts` — unbounded per-user draft rows** (FIXED in `ae4cd55`)
   The key regex accepted any uuid, so an authenticated client could mint unlimited 32 KB rows under fabricated keys — a storage-abuse vector. Fix: `putWorkoutDraft` prunes the user's oldest drafts past a 20-row cap after each upsert (a real user has one 'new' surface plus a few open edits).
2. **`workout-logger.tsx` — cross-device clock skew breaks save** (FIXED in `ae4cd55`)
   A draft written by a device with a fast clock carries a future `openedAt`; after restore on an honest device, save sends it as `startedAt` and `parseWorkoutInput` rejects future dates — surfacing as an opaque "Could not save workout." Fix: clamp `openedAt` to now when applying a restore.

### LOW
3. **`actions.ts` — case-insensitive key regex minted duplicate surfaces** (FIXED in `ae4cd55`)
   `'NEW'`/uppercase-uuid keys passed validation as distinct rows, and an uppercase-uuid URL would silently split a session's draft from its restore key. Fix: keys are lower-cased before validation (regex now case-sensitive).
4. **`e2e/workout.spec.ts` — sync poll raced the debounce** (FIXED in `ae4cd55`)
   The poll accepted *any* draft row; on a slow runner an earlier debounce flush could satisfy it before the last keystroke synced, failing the post-reload value assertion. Fix: poll until the payload contains the last-typed value.

### Noted, accepted (documented, not fixed)
- The last <800 ms of typing before an abrupt tab close may not have synced (inherent to debounced autosave; `sendBeacon` flush is the upgrade path).
- After a *failed* save, the most recent edit stays unsynced until the next change re-arms the debounce (the user is looking at an inline error either way).
- Last-writer-wins across devices; simultaneous two-device editing is explicitly out of scope.

## Checked and clean (Round 2)
- **Security**: draft rows are addressable only via the caller's `userId` (composite PK); payload validated server-side before landing in jsonb; key format locked to `'new'`|uuid; no injection surface (Drizzle params; the e2e `payload::text like` lives in test code with a fixed pattern).
- **Correctness**: save/update actions delete the draft only after the ownership-gated write succeeds; TTL read path lazily deletes; restore is gated by `dirtyRef` (typed input wins) and autosave freezes during save (`savingRef`), unfreezing on failure.
- **Tests**: 609 unit tests (15 new for codec, DB module incl. prune, action TTL/validation/normalization); live e2e covers autosave → reload-restore → save → row deleted.

## Validation Results (Round 2, post-fix)

| Check | Result |
|---|---|
| Type check | Pass |
| Lint (scoped) | Pass |
| Unit tests | Pass (609) |
| Build | Pass |
| E2E `workout.spec.ts` | Pass (live) |
| Migration | `0007` applied; `workout_drafts` verified in Postgres |
