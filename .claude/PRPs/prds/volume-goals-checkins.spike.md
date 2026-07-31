# SPIKE — Volume Targets, Goals & Gamification, Measurements/Photos + Check-ins

Design exploration (2026-07-31), no implementation. Direct user asks: "volume
targets is a great idea. not sure if programs have that already", "goal
tracking we can create our own version of goals. gamification",
"measurements and progress photos are great. even better if we can let
programs suggest users take a photo and measurements every xyz day with
reminders maybe?"

## Recon facts (verified in code)

- Volume: computed catalog-side (`src/db/muscle-volume.ts`), rendered on
  /stats + home teaser; the ONLY threshold is a hardcoded
  `LOW_VOLUME_FLOOR = 10`. Targets were explicitly deferred by the volume PRD.
- Programs do NOT have targets — but `program_exercise_muscles` (primary/
  secondary per exercise) is written on every save and **read by nothing**.
- Bodyweight (`bodyweight_logs` + /bodyweight page) is the proven pattern a
  measurements feature should echo (log/list/delete + trend chart + denorm
  current value).
- No goals/badges/streaks system exists (PR badge aside). No blob storage
  dependency exists at all. Push rails: daily cron 13:30 UTC, Redis SET-NX
  day markers, `sendPushToUser`.

---

## Arc 1 — Volume targets: THE PROGRAM IS THE TARGET

The insight that makes this cheap and differentiated: don't ask users to
configure MEV/MRV bands (RP-style config nobody fills in). **Derive planned
weekly volume from the active program itself** — days × exercises × working
sets, credited primary 1.0 / secondary 0.5 through the already-written
`program_exercise_muscles` rows (this becomes that table's first reader,
exactly what it was denormalized for).

- /stats gains a planned-vs-performed bar per muscle group: "Chest 9 / 12
  planned sets". Under-plan = muted warning, way-over = quiet note.
- Zero configuration; changes to the program move the targets (correct: the
  plan IS the intent). Ad-hoc-only users simply have no targets — surface
  unchanged (the volume PRD's honesty rules keep holding).
- The coach can read planned-vs-performed via the existing stats tools later.
- **Manual override bands: deferred** — add only if the derived defaults
  prove wrong in practice.
- Effort: S–M (one pure aggregation + one /stats section). No migration.

## Arc 2 — Goals & gamification: OUR OWN VERSION

Philosophy fit: goals must be **facts about targets**, checked against
already-computed truths (e1RM trend, bodyweight logs, schedule adherence) —
never a parallel stats system.

**v1 goal kinds** (one `goals` table: id, userId, kind, targetJson, exercise
ref nullable, deadline nullable, createdAt, achievedAt nullable):
1. **Strength**: e1RM target per exercise ("Squat 315 lb") — progress = best
   e1RM vs target; the trend chart gains a target line + pace projection
   ("on pace for Nov 12" from the existing per-session trend slope).
2. **Bodyweight**: target weight (either direction) — progress off
   bodyweight_logs.
3. **Consistency**: sessions-per-week streak vs the program's scheduled
   weekdays (the schedule feature finally powers adherence — a "streak" =
   consecutive scheduled days trained; grace rule = open question).

**Gamification v1 — small and honest**: streak counter on home (flame + N
weeks), goal-achieved moment on the workout-complete screen (the celebration
surface already exists), achievedAt push ("Goal reached: Squat 315").
Badges/levels/XP: **not building** — cheap-feeling in a tool whose brand is
honesty; revisit only with real users asking.

- Surfaces: /goals page (create/edit/archive), home card (top active goal +
  streak), workout-complete integration, MCP read tool so the coach can
  reference goals in chat + drafting.
- Effort: M (schema + page + trend-line + streak calc). One migration.

## Arc 3 — Measurements, photos, and program-suggested check-ins

**Measurements**: `body_measurements` echoing bodyweight_logs — id, userId,
measuredAt, site (enum: chest/waist/hips/thigh/arm/calf/neck/shoulders),
valueCm numeric. Same page pattern: log form, per-site trend charts,
history. Pure pattern echo. Effort: S–M.

**Progress photos**: needs storage — **Supabase Storage, private bucket**
(the db IS Supabase — same project, no new vendor, per the explicit
no-Vercel-lock-in call; server-signed expiring URLs; ~$0 at POC scale).
`progress_photos`: id, userId,
takenAt, blobKeyDisplay, blobKeyThumb, thumbHash, pose (front/side/back,
optional), note. **Image pipeline (Instagram-style, decided 2026-07-31)**:
one sharp pass at upload — strip EXIF, re-encode display (max 1080px WebP)
+ thumb (320px WebP), compute a ThumbHash (~25 bytes) stored ON the row,
discard the multi-MB original. The timeline renders instant fuzzy
placeholders from the DB query alone (ThumbHash decodes client-side, zero
network), thumbs lazy-load over them, compare view pulls display size via
signed URLs. Own derivatives (not Supabase image transforms — Pro-plan
feature, and vendor-portable this way). Auth-gated signed URLs (never
public), hard delete removes both blobs. Photos render in a timeline strip + side-by-side compare
view (date A vs date B — the retention moment). Effort: M (storage
plumbing + compare UI). Privacy is the review gate: private-only in v1, no
sharing surface at all.

**Program-suggested check-ins (the user's "every xyz day" idea)**:
- `programs.checkInEveryDays` int nullable (null = no suggestion). Program
  authors (and the coach, and imported templates) can set it — "this program
  suggests a check-in every 14 days".
- **No new timestamp needed**: last check-in = max(latest measurement,
  latest photo, latest bodyweight log). Due = last + cadence ≤ today.
- Delivery rides the EXISTING daily cron: second marker key
  (`checkin:{userId}:{date}`), same claim-before-send idiom — "Check-in day
  — log measurements + a progress photo", deep-link to the body page with a
  guided check-in sheet (weight → tape sites → photo, skippable steps).
- A due check-in also shows as a quiet home card (the reminder-card pattern,
  dismiss-for-today) so non-push users see it too.
- Effort: S on top of Arc 3's surfaces (one column + cron rider + card).

---

## Sequencing recommendation

1. **Arc 1 first** (volume targets) — smallest, no migration, instantly
   visible on /stats, and it converts dead denormalized data into product.
2. **Arc 3a** (measurements page, echo pattern) then **3b** (photos/Blob)
   then **3c** (check-in cadence + cron rider) — each independently
   shippable.
3. **Arc 2** (goals + streak) — biggest single migration; lands best after
   check-ins exist (a consistency goal and a check-in cadence share the
   "adherence" muscle).

## Decisions since v1 (2026-07-31)

- Storage: **Supabase Storage** (db is already Supabase; explicit no-Vercel-lock-in call), private bucket + server-signed expiring URLs.
- Volume target unit: **hard sets** (field standard: set-based dose-response literature and MEV/MRV frameworks; programs prescribe sets so planned-vs-performed derives cleanly). Per-muscle tonnage as an optional secondary display later — session tonnage already exists on summaries.

## Open questions (decide before building)

- [ ] Streak grace rule: strict consecutive vs one-miss-per-week allowed.
- [ ] Measurements units: cm canonical with in display (mirror kg/lb) — yes?
- [ ] Photos in v1 of the check-in sheet, or measurements-only first?
- [ ] Does /bodyweight fold into one /body page (weight + tape + photos) or
  stay separate? Lean: fold — one check-in destination.
- [ ] Blob spend guard: cap stored photos per user (e.g. 200) in v1?
