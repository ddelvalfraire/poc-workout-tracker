# Training Schedule & Push Notifications — the retention loop

## Problem Statement

Everything in the app assumes the user shows up: the program knows what's
next, autoreg adjusts it, plan-sync keeps it honest — but nothing ever
reaches out. "Up next" has no time anchor (the home hero can't say "today"),
and the app has no delivery channel for the moments it already produces
(scheduled day, PR, block complete, plan-sync notice). Direct user ask
(2026-07-30): "lets work on push notifications."

## Standing constraints (from the deferred-notifications plan, 2026-07)

- iOS PWA gives ONE permission prompt ever — it must be triggered by a real
  user gesture from the /settings toggle, never on load, never speculative.
- The PWA is serwist-based; the push handler lives in the service worker
  source, and the SW caches only offline.html (never app HTML) — the push
  changes must not disturb the PWA update contract.

## Proposed Solution

### 1. Schedule: weekdays on program days

`program_days.weekdays` — int array (0–6, Sunday-first), additive, empty =
unscheduled (today's behavior). Builder UI: a 7-chip weekday picker per day.
Up-next derivation gains a time anchor: when the next day is scheduled, the
home hero says "Today" / "Tomorrow" / the weekday name; unscheduled programs
render exactly as today. MCP upsert/get carry the field (part of the day
tree, full-replace like day name — preserve-on-omit not applicable).

### 2. Push plumbing

- `push_subscriptions` table: id, userId, endpoint (unique), p256dh, auth,
  createdAt, lastSeenAt; a user may hold several (phone + desktop).
- Settings: a "Workout reminders" toggle. ON (the gesture) →
  Notification.requestPermission() → subscribe via pushManager with the
  VAPID public key → POST subscription. OFF → unsubscribe + delete. The
  one-shot iOS reality is stated in the toggle's hint. Denied permission
  renders the toggle disabled with an explanation.
- Service worker: push event → showNotification(title, body, icon, data.url);
  notificationclick → focus/open the URL. Nothing else touches serwist.
- Server: web-push (npm) with VAPID keys from env (VAPID_PUBLIC_KEY /
  VAPID_PRIVATE_KEY / VAPID_SUBJECT). 404/410 responses prune the dead
  subscription.

### 3. Scheduled reminders (cron)

Vercel cron (vercel.json) → /api/cron/reminders (CRON_SECRET-gated), hourly.
For each user with subscriptions + an active program whose next day is
scheduled today: send ONE reminder in their morning window; a sent-marker
(Redis TTL key) makes the hour idempotent and caps at one per day.
Copy: "Legs — Week 3 · 5 exercises". Tap opens home.
v1 simplification: no per-user timezone column yet — fixed UTC window;
noted as follow-up.

### 4. Later, same rails (NOT in this build)

Coach weekly check-ins, PR celebrations, plan-sync notices, streaks.

## What We're NOT Building

- In-app notification center/inbox — push only.
- Per-user quiet hours / timezone settings (v1 fixed window; follow-up).
- Any non-gesture permission prompting, ever.
- Email/SMS channels.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| One-shot discipline | The permission prompt fires only from the Settings toggle gesture | Code review + manual iOS test |
| Delivery | A scheduled day produces exactly one reminder in the window | Idempotency tests + prod dogfood |
| Zero PWA regression | serwist precache/update behavior unchanged | Build + existing PWA behavior |
| Anchor | Home hero says Today/Tomorrow for scheduled programs, unchanged otherwise | Page tests |

## Open Questions

- [ ] Morning window default (lean 13:00–15:00 UTC ≈ 8–10am ET for the sole
  current user; revisit with timezones).
- [ ] Redis marker chosen over a sends table for idempotency (TTL'd key,
  zero schema).
