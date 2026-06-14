# Workout Tracker PWA

## Problem Statement

People who lift or train regularly want a fast, phone-native way to log what they did during a workout and look back at past sessions — without fighting a bloated fitness app full of social feeds, paywalls, and onboarding. Today they fall back to notes apps or spreadsheets that have no exercise reference and make history awkward to review. The cost of not solving it: training data goes unrecorded, so progression is guesswork.

## Evidence

- Stated user intent (the builder): "need to be able to track workouts ... view workout history ... view past workouts ... edit or start a workout." Direct articulation of the core jobs.
- Common market signal: top fitness loggers (Strong, Hevy, FitNotes) all center on the same loop — start session → add exercises/sets → save → review history — which validates that this is the proven shape of value.
- Assumption needing validation: that a stripped-down POC (no programs, no analytics) is enough to be useful. Validate by dogfooding for a week.

## Proposed Solution

A single installable PWA (Next.js App Router + shadcn/ui) where a signed-in user starts a workout, picks exercises from wger's public exercise database (fetched live over HTTP — we host no exercise data), logs sets/reps/weight, saves the session, and reviews or edits past workouts from a history list. Auth is handled by Clerk (managed, generous free tier). Workout data persists in Supabase Postgres, accessed via Drizzle ORM, with every row scoped to the Clerk `userId`. Chosen over a native app (slower to ship) and over a self-hosted exercise DB (unnecessary; wger is free and comprehensive).

## Key Hypothesis

We believe a friction-free start→log→review loop in an installable PWA will let lifters reliably capture their training for regular trainees.
We'll know we're right when a user can complete a full workout log on their phone in under 2 minutes and return days later to view it accurately.

## What We're NOT Building

- **Workout programs / templates / routines** — POC validates logging, not programming.
- **Progress charts & analytics** — history list first; visualization is a later bet.
- **Social features (feeds, sharing, following)** — not part of the core job.
- **Rest timers, supersets, RPE, 1RM calculators** — power-user polish, deferred.
- **Our own exercise database / exercise CRUD** — wger provides this over HTTP.
- **Offline-first sync / conflict resolution** — PWA is installable, but online-only for the POC.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Time to log a full workout (5 exercises) | < 2 min | Manual stopwatch during dogfooding |
| Round-trip integrity | 100% | Logged session matches what's shown in history |
| Ship time | ≤ ~1 hour to working app | Wall clock from scaffold to running app |
| Installability | Passes PWA install prompt | Chrome/Safari "Add to Home Screen" works |

## Open Questions

- [ ] wger API: confirm the exact endpoint(s) and shape for searching/listing exercises with English names + equipment/category (`/api/v2/exercise/search/` vs `/exerciseinfo/`), and whether rate limits or CORS affect client-side calls (likely proxy via a Next.js route handler).
- [ ] Do we need exercise images/thumbnails for the POC, or is name + category enough? (Lean: name + category only.)
- [ ] Is online-only acceptable for v1, or is minimal offline logging a must-have? (Lean: online-only.)
- [ ] Units: kg-only for POC, or kg/lb toggle? (Lean: single unit, default kg, store the number raw.)

---

## Users & Context

**Primary User**
- **Who**: A regular gym-goer / lifter who already trains on a schedule and wants to record sets, reps, and weight per exercise.
- **Current behavior**: Logs in a notes app, a spreadsheet, or memory — no structured history, no exercise reference.
- **Trigger**: Standing in the gym between sets, phone in hand, wanting to record what they just did and check what they did last time.
- **Success state**: Opens the installed app, taps "Start Workout," logs as they go, saves, and can scroll history later to see exactly what was done.

**Job to Be Done**
When I'm at the gym about to train, I want to quickly log each exercise and set so I can track what I did and review past workouts to gauge progress.

**Non-Users**
- Coaches building/selling programs for clients (no programming tools here).
- Beginners who need exercise instruction/tutorials (we surface a reference list, not a coaching product).
- Anyone wanting social/competition features.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Sign in / sign up (Clerk) | Gate so workouts are user-scoped |
| Must | Start a new workout (creates a session) | Entry point to the core loop |
| Must | Add exercises from wger + log sets (reps, weight) | The actual value: capturing training |
| Must | Save workout to Supabase | Persistence per user |
| Must | View workout history (list of past sessions) | Half the stated value |
| Must | View a past workout's detail | "View past workouts" requirement |
| Should | Edit a past/in-progress workout | Explicitly requested; correcting logs |
| Should | Delete a workout | Natural counterpart to edit |
| Should | Installable PWA (manifest + service worker) | Stated requirement; phone-native feel |
| Could | Exercise search/filter (by category/equipment) | Improves add-exercise UX |
| Could | Duplicate last workout as a starting point | Speeds the repeat-session case |
| Won't | Programs, analytics, social, timers, offline sync | Out of scope for POC (see "NOT Building") |

### MVP Scope

Signed-in user → **Start Workout** → add exercises pulled from wger → enter sets (reps × weight) → **Save** → session appears in **History** → tap a session to **view detail** → **edit/delete** it. Everything else is deferred.

### User Flow

```
Sign in (Clerk)
  → Home: [Start Workout] + History list
    → Start Workout: empty session
       → Add Exercise (search wger) → adds exercise to session
          → Add set rows: reps + weight
       → Save → writes session + exercises + sets to Supabase
    → History: list of past sessions (date, exercise count)
       → Session detail: exercises + sets
          → Edit (mutate sets/exercises) / Delete
```

---

## Technical Approach

**Feasibility**: HIGH — every piece is a well-trodden managed service with first-class Next.js support; the only integration unknown is wger's exact response shape.

**Architecture Notes**
- **Framework**: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui. Server Components for reads, Server Actions (or route handlers) for writes.
- **Auth**: Clerk via `clerkMiddleware()` + `<ClerkProvider>`. Server-side `auth()` yields `userId`; unauthenticated users are redirected from app routes.
- **Data ownership**: Clerk and Supabase are separate vendors here, so we do **not** use Supabase RLS/JWT. Instead every query filters by the Clerk `userId` stored on the `workouts` row in our server code. Simple and correct for a POC; revisit RLS if we ever expose the DB directly to the client.
- **DB**: Supabase Postgres accessed via **Drizzle ORM** using `postgres-js` against the Supabase connection pooler URL (transaction pooler for serverless on Vercel). Migrations via `drizzle-kit`.
- **Schema (minimal)**:
  - `workouts` (id, user_id [Clerk], name?, started_at, completed_at?, created_at)
  - `workout_exercises` (id, workout_id → workouts, wger_exercise_id, name [denormalized from wger], position)
  - `sets` (id, workout_exercise_id → workout_exercises, set_number, reps, weight, completed?)
- **Exercises**: fetched from wger's public API. Proxy through a Next.js route handler (`/api/exercises`) to dodge CORS and add light caching; store only the wger id + display name on our side (no exercise mirror).
- **PWA**: `manifest.json` + icons + a minimal service worker (e.g. `next-pwa` or a hand-rolled SW) for installability. Online-only for the POC.
- **Deploy**: Vercel. Env vars for Clerk keys, Supabase connection string, and wger base URL via `vercel env` / dashboard.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| wger API shape/endpoints differ from assumption; CORS on client calls | M | Verify endpoints first; proxy via Next.js route handler; cache responses |
| Supabase pooler vs direct connection issues on Vercel serverless | M | Use the transaction pooler URL; set `prepare: false` for postgres-js |
| Clerk + Drizzle userId scoping bug leaks another user's data | M | Centralize the `where userId = ...` filter in a data-access layer; never query workouts without it |
| PWA install/service worker eats time | L | Ship core loop first; add manifest+SW last as a "Should," not a blocker |
| wger rate limits during dogfooding | L | Cache exercise list; it changes rarely |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently
  DEPENDS: phases that must complete first
  PRP: link to generated plan file once created
-->

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Scaffold & infra | Next.js + TS + Tailwind + shadcn, Clerk auth, Supabase+Drizzle schema/migration, env wiring | complete | - | - | [plan](../plans/completed/scaffold-and-infra.plan.md) · [report](../reports/scaffold-and-infra-report.md) |
| 2 | wger exercise proxy | Route handler to search/list exercises from wger, with caching + typed response | complete | with 3 | 1 | [plan](../plans/completed/wger-exercise-proxy.plan.md) · [report](../reports/wger-exercise-proxy-report.md) |
| 3 | Core logging loop | Start workout, add exercises, log sets, save to Supabase (user-scoped) | in-progress | with 2 | 1 | [plan](../plans/core-logging-loop.plan.md) |
| 4 | History & detail | List past workouts; view a session's exercises/sets | complete | - | 3 | [plan](../plans/completed/history-and-detail.plan.md) · [report](../reports/history-and-detail-report.md) |
| 5 | Edit & delete | Mutate/delete a saved workout and its sets | complete | - | 4 | [plan](../plans/completed/edit-and-delete.plan.md) · [report](../reports/edit-and-delete-report.md) |
| 6 | PWA + deploy | manifest, icons, service worker, installability; deploy to Vercel | complete | - | 3 | [plan](../plans/completed/pwa-and-deploy.plan.md) · [report](../reports/pwa-and-deploy-report.md) |

> Phase 1 verified: type-check, lint, unit test, and production build all green; `drizzle-kit push` applied the schema to Supabase (3 tables confirmed); unauthenticated `/` returns 307 → `/sign-in` (Clerk middleware active); sign-in/sign-up pages render the Clerk widget with valid keys. Only the interactive account-creation click-through remains as a manual browser check. See the [report](../reports/scaffold-and-infra-report.md).

### Phase Details

**Phase 1: Scaffold & infra**
- **Goal**: A running app where you can sign in and the DB schema exists.
- **Scope**: `create-next-app`, shadcn init, Clerk middleware + provider + sign-in routes, Drizzle schema + first migration against Supabase, `.env` wiring.
- **Success signal**: Sign in works; an empty protected home page renders for the authed user; `drizzle-kit push` succeeds.

**Phase 2: wger exercise proxy**
- **Goal**: App can fetch a searchable list of exercises without CORS pain.
- **Scope**: `/api/exercises` route handler hitting wger, returning `{ id, name, category, equipment? }`; light in-memory/Next cache.
- **Success signal**: Hitting the route returns real wger exercises as JSON; a search query filters them.

**Phase 3: Core logging loop**
- **Goal**: A user can record a full workout and it persists.
- **Scope**: Start Workout creates a session; add-exercise picker (uses Phase 2); set rows (reps, weight); Save via Server Action writing workouts/exercises/sets scoped to `userId`.
- **Success signal**: Saved workout exists in Supabase with correct `user_id` and nested sets.
- **Status**: Implemented — see [`reports/core-logging-loop-report.md`](../reports/core-logging-loop-report.md). Pending manual DB/browser verification with live Clerk + Supabase.

**Phase 4: History & detail**
- **Goal**: The "view history / view past workouts" half of the value.
- **Scope**: History list (date, exercise/set count) and a session detail view, both `userId`-filtered.
- **Success signal**: A saved session appears in history and its detail matches what was logged.
- **Status**: Complete — see [`plans/completed/history-and-detail.plan.md`](../plans/completed/history-and-detail.plan.md) and [`reports/history-and-detail-report.md`](../reports/history-and-detail-report.md).

**Phase 5: Edit & delete**
- **Goal**: Correct or remove past logs.
- **Scope**: Edit sets/exercises on an existing workout; delete a workout (cascade its children).
- **Success signal**: Edits persist and re-render; delete removes it from history.
- **Status**: Complete — see [`plans/completed/edit-and-delete.plan.md`](../plans/completed/edit-and-delete.plan.md) and [`reports/edit-and-delete-report.md`](../reports/edit-and-delete-report.md). Type-check, lint, unit tests (68), production build, and live e2e (3/3 against Clerk + Supabase) all green; the e2e asserts the edited set weight and the post-delete cascade directly in Postgres.

**Phase 6: PWA + deploy**
- **Goal**: Installable on a phone at a live URL.
- **Scope**: `manifest.json` + icons + minimal service worker; deploy to Vercel with env vars.
- **Success signal**: "Add to Home Screen" works; live URL serves the authed app.
- **Status**: Complete — see [`plans/completed/pwa-and-deploy.plan.md`](../plans/completed/pwa-and-deploy.plan.md) and [`reports/pwa-and-deploy-report.md`](../reports/pwa-and-deploy-report.md). Manifest (`app/manifest.ts`), generated icons (`next/og`), and a minimal online-only service worker shipped with zero new dependencies; type-check, lint, unit (76), production build, and e2e (8/8) all green. Deployed to Vercel production at https://poc-workout-tracker.vercel.app — manifest/SW/icons verified public over HTTPS. Remaining manual signal: on-phone "Add to Home Screen" + full round-trip.

### Parallelism Notes

Phases 2 and 3 can overlap: the wger proxy (2) and the workout/session persistence (3) touch different layers. Phase 3 only needs the proxy's response *shape* to integrate the exercise picker, so they can be built concurrently and joined at the picker. Phase 6 (PWA/deploy) depends only on a working core loop (3), so it can start before history/edit are finished if needed.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Auth provider | Clerk | Supabase Auth, Auth.js | Fastest drop-in for App Router; generous free tier; no self-rolled auth |
| Database | Supabase Postgres | Neon, Vercel/Neon | Managed Postgres, instant + free tier, quickest to stand up |
| DB access | Drizzle ORM | Prisma, supabase-js | Lightweight, type-safe, minimal boilerplate for a 3-table POC |
| Data scoping | Filter by Clerk `userId` in server code | Supabase RLS w/ JWT | Auth & DB are separate vendors; RLS integration adds setup time not worth it for POC |
| Exercise data | wger public API via Next proxy | Self-hosted exercise DB | Stated requirement; wger is free, comprehensive, no DB to maintain |
| Exercise calls | Server-side proxy route | Direct client fetch | Avoid CORS, enable caching, keep base URL server-side |
| Deploy target | Vercel | Local only | Builder wants a live installable PWA URL within the hour |
| Offline support | Online-only for POC | Offline-first sync | Out of scope; sync/conflict handling is a large bet |

---

## Research Summary

**Market Context**
- Established loggers (Strong, Hevy, FitNotes) converge on the same core loop: start session → add exercises → log sets → save → review history. This POC deliberately implements only that loop and defers programs/analytics/social — the features that differentiate mature apps but aren't needed to validate the core job.
- wger is an open-source fitness manager with a public REST API and a large exercise database, widely used as a free exercise data source — a good fit for "I don't want my own exercise database."

**Technical Context**
- Clerk + Next.js App Router is a documented, low-friction path (`clerkMiddleware`, `<ClerkProvider>`, server `auth()`), making auth a near-non-issue for ship speed.
- Supabase + Drizzle via `postgres-js` against the transaction pooler is a known-good serverless pattern on Vercel (`prepare: false`).
- Main unknown is wger's exact endpoint/response shape for searchable exercise listing — flagged as an open question and front-loaded into Phase 2.

---

*Generated: 2026-06-13*
*Status: DRAFT - needs validation*
