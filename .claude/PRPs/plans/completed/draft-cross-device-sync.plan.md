# Plan: Cross-Device Draft Sync (server-side drafts replace localStorage)

## Summary
Replace the just-shipped localStorage draft persistence with a server-side `workout_drafts` table as the single source of truth. Start a session on the phone, open the logger on the laptop, and the in-progress draft is there. No backwards compat with the localStorage method (user decision — scrap it).

## User Story
As a lifter who switches devices mid-block, I want my in-progress workout draft to follow my account, so that an interrupted session on one device can be finished on another.

## Problem → Solution
localStorage snapshots are device-local → one `workout_drafts` row per (user, surface) in Postgres, autosaved (debounced) through server actions, restored on logger mount, deleted server-side on save.

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A (follow-up to in-session-tracking, user-directed pivot)
- **Estimated Files**: ~10

## Design Decisions
- **Storage**: `workout_drafts (user_id, key, payload jsonb, updated_at)`, PK `(user_id, key)`. `key` = `'new'` (the /workout/new surface) or the workout uuid (edit surfaces). Payload = `{ v, unit, name, openedAt, draft }` — same shape as the localStorage snapshot minus `savedAt` (the server's `updated_at` is authoritative).
- **TTL**: 12 h, enforced server-side on read against `updated_at`; expired rows are lazily deleted.
- **Conflicts**: last-writer-wins upsert (`onConflictDoUpdate`, `preferences.ts` pattern). Simultaneous editing on two devices is out of scope (POC).
- **Autosave**: debounced ~800 ms fire-and-forget server action from the logger; pending write flushed on effect cleanup. Failed writes are swallowed (non-critical, same stance as ghost fetches).
- **Restore race**: restore is now async — it must NOT clobber input typed before it resolves. A `dirtyRef` set by any persist-triggering change gates the apply.
- **Cleanup**: `saveWorkoutAction` deletes key `'new'`; `updateWorkoutAction` deletes the workout's key — server-side, no client bookkeeping. Clearing the draft to empty deletes the row via a dedicated action.
- **Validation**: put action re-validates payload structure server-side (never trust the client) + a 32 KB size cap; read-side `parseDraftPayload` re-validates on the client (never trust storage) incl. unit match.

## Files to Change
| File | Action |
|---|---|
| `src/db/schema.ts` | UPDATE — `workoutDrafts` table |
| `drizzle/0007_*.sql` | GENERATED migration |
| `src/db/workout-drafts.ts` (+test) | CREATE — get/put/delete, user-scoped |
| `src/app/workout/new/draft-storage.ts` (+test) | REWRITE → `draft-payload.ts` — build/parse payload objects (no localStorage semantics) |
| `src/app/workout/actions.ts` (+test additions) | UPDATE — get/put/delete draft actions; save/update delete drafts |
| `src/app/workout/new/workout-logger.tsx` | UPDATE — async restore + debounced server autosave |
| `e2e/workout.spec.ts` | UPDATE — reload-restores-draft step |

## NOT Building
- Simultaneous two-device merge/conflict UI (last-write-wins only)
- Offline queueing (no localStorage fallback at all — per user decision)
- Draft list UI ("resume session" affordances beyond the existing logger surfaces)

## Validation
`npx tsc --noEmit` · scoped eslint · `npm test` · `npm run build` · `npm run db:generate && npm run db:migrate` · `npm run test:e2e -- workout.spec.ts`
