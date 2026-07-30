# PR Review: #115 — feat: web push notifications + cron reminders

**Reviewed**: 2026-07-30
**Author**: ddelvalfraire
**Branch**: feat/push-notifications → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Security-sensitive surfaces all verified: the cron route is Clerk-public but
bearer-gated fail-closed (no secret configured = nobody authorized —
inspected directly); subscription endpoints require auth, validate https-only
endpoints with caps, and deletes are ownership-scoped; the SW payload guard
is dependency-free and rejects external URLs so a push can never navigate
off-app. Discipline points honored: the one iOS permission prompt fires only
from the toggle gesture; subscription state is the browser's own truth (no
server flag to drift); SET NX claims the day before sending and absent Redis
skips everything (skip recovers, double-send doesn't); serwist's precache
and update contract untouched. The lockfile finding (repo tracks npm's
package-lock; Vercel builds with npm) was handled correctly.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Fixed UTC window (13:00–15:00) — per-user timezones are the PRD-noted
  follow-up; correct for the sole current user.
- Cron cost: one getNextProgramDay per subscribed user per in-window hour —
  fine at present scale; batch if the user count ever matters.
- Unsubscribe leaves a dangling row if the server call fails — self-prunes
  on next send (404/410); documented.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 109 files, 1652 tests (45 new) |
| Build | Pass (/serwist/sw.js emits; 3 new routes registered) |
| Migration | Generated only (0025); apply with 0024 at deploy |

## Files Reviewed
- src/db/schema.ts, drizzle/0025_*, src/db/push-subscriptions.ts(+test)
- src/lib/push.ts, push-input.ts, push-payload.ts, push-client.ts (+tests)
- src/app/api/push/{subscribe,unsubscribe}/route.ts(+tests)
- src/app/api/cron/reminders/route.ts(+test), vercel.json, src/proxy.ts
- src/app/settings/workout-reminders-toggle.tsx, settings/page.tsx
- src/app/sw.ts — additive push/notificationclick only
- package.json/package-lock.json, .env.example
