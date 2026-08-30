# Personas: users in known states, and the screens rig

A seeder that materializes users in defined states — day-one blank slate,
five-year veteran, daily logger who never opened Programs — plus a one-command
screenshot gallery of any user's screens, and a clone-to-local pipeline for
reproducing a real user's bug. Requirements only; no implementation here.

- Status: requirements / codebase-verified / no implementation
- Date: 2026-08-30
- Depends on: the e2e harness (`playwright.config.ts`, `e2e/auth.ts`), the seed
  scripts (`scripts/seed-templates.ts`), `scripts/migrate-user-id.ts`,
  entitlements (`src/db/entitlements.ts`), prescriptions
  (`src/db/prescriptions.ts`)
- Research: industry survey and design rationale live in the Persona Foundry
  report (artifact); this doc is the buildable subset.

## 01 · What this is for

Four consumers, one foundation:

1. **UI review.** Every `page.tsx` is a server component that reads Postgres
   behind `requireUserId()`. Storybook cannot render those surfaces —
   `src/components/home/home-bento.stories.tsx:18-21` says so explicitly — so
   the only way to *see* the app as a given kind of user is to be one. Personas
   are the page-state harness; Storybook stays the component-state harness.
2. **Test fixtures.** Specs that need "a user with history" currently build it
   through the UI, the slowest and flakiest option. A seeded persona plus a
   saved session is the Playwright-recommended replacement.
3. **Correctness.** A generator that plays five years through the real program
   engine is a long-horizon integration test of autoreg, deloads, and TM bumps
   that nothing else exercises. If it cannot produce five lawful years, that is
   a bug found.
4. **QA repro.** "A user reports a bug" becomes: clone prod to the scratch DB,
   rewrite their id to a local emulator user, sign in, look.

## 02 · Rule zero: safety

The worktree's `.env.local` points `DATABASE_URL` at live Supabase prod, and
`src/db/index.ts:7` connects at module load. Every requirement below is
subordinate to these:

- **S-1** Every tool in this spec MUST validate that the target database host
  is local (`localhost`, `127.0.0.1`, `host.docker.internal`, `db`) **before**
  importing anything that transitively imports `src/db/index.ts`. Copy the
  guard shape from `playwright.config.ts:17-29`, including its single
  documented escape hatch (`E2E_ALLOW_REMOTE_DB=1` is the precedent; the
  seeder's flag may be its own name but MUST NOT default on).
- **S-2** No prod escape hatch ships in v1. Seeding production is out of scope;
  if ever revisited it arrives as a separate change gated like
  `src/lib/ops/access.ts` (fail closed: no allowlist ⇒ nobody).
- **S-3** All scripts are manual-only: the `MANUAL INVOCATION ONLY` header
  convention from `scripts/seed-templates.ts:5`, never wired into build, CI,
  or app code paths.
- **S-4** The seeder writes rows only for the user id it created or was
  explicitly given via `--user-id`.
- **S-5** Anything destructive (purge, clone-restore, id-rewrite) is dry-run
  by default and requires `--commit`, the `scripts/migrate-user-id.ts:105-108`
  idiom.
- **S-6** No session-minting or cookie-forging path is added. Authentication is
  the WorkOS emulator or nothing — the stance recorded in `e2e/auth.ts:14-16`
  stands.

## 03 · The persona roster

Personas are **user-authored definition scripts over a feature-agnostic
engine** — the roster below is the starter library, not the API (owner
decision, 2026-08-30: "this product shouldn't care at all what our users are
or how we define them"). The roster is chosen so every `HomeState`
(`src/lib/home-status.ts:49-56`) and every scale regime the UI must survive
has at least one definition landing on it.

| Persona | Definition | Covers |
|---|---|---|
| `day-one` | Emulator user, consents recorded, nothing else | `fresh` (day-one copy), empty states everywhere |
| `week-one` | Adopted a library template 5 days ago, 2 workouts done | `program-due` / `rest-day`, early sparklines |
| `freestyle-lifer` | 5y, ~5 sessions/wk, zero programs ever; customs, notes, bodyweight logs | Ad-hoc-only surfaces; autoreg correctly inert |
| `veteran` | 5y, ~1000 workouts through programs: blocks, deloads, stalls, TM bumps, technique groups | Scale (~20k set rows), trends, `block-complete` |
| `drifting` | Veteran variant, last workout 6+ days ago (threshold is 4 — `home-status.ts:21`) | `drifting`, lapse copy |
| `mid-session` | Live draft in progress right now | `session-live`, resume flows |
| `edge-kitchen-sink` | Every `logging_type`, cardio metric modes, unit switches, deprecated customs, active shares | Named edge cases, one record each |

- **P-1** The engine exposes a typed **action API** whose actions map 1:1
  onto domain writes (`createUser`, `consent`, `grant`,
  `logFreestyleSession`, `adoptProgram`, `playProgramDay`, …). The engine
  itself contains no persona knowledge — no roster, no dimension enum.
- **P-2** Persona definitions are separate scripts authored against that API
  (TypeScript modules proposed — D-6). A definition composes actions over
  simulated time; typical knobs (history depth, sessions/week with gaps,
  program usage, custom-exercise count, logging variety, body-data density,
  entitlement tier — free = no grant, paid via `applyGrant`, lapsed = past
  `endsAt`) live in the definitions, not the engine.
- **P-3** All generated dates are offsets from the run anchor (default: now),
  never fixed calendar dates, so definitions cannot rot.
- **P-4** New product features become new action bindings; existing
  definitions keep running. A definition may create **multiple users and
  relationships between them** — the engine's unit is the scenario (N users +
  links), single-user personas being the degenerate case. Concrete
  relationship actions (e.g. friends) arrive with the product feature, not
  speculatively.
- **P-5** The starter library (the roster above) ships across PRs 1–4 (§09);
  adding a persona later means writing a definition, never touching the
  engine.

## 04 · The seeder CLI

`scripts/seed-persona.ts`, in the mold of `scripts/seed-templates.ts`
(dotenv → guard → dynamic import → idempotent).

- **C-1** Interface: `--persona <slug>` (repeatable or `all`), `--seed <n>`,
  `--user-id <id>` (target an existing id instead of creating one),
  `--emulator` (create a WorkOS emulator user via the `e2e/auth.ts`
  `createTestUser` path and print its email), `--purge` (tear down via
  `purgeUserData()`, `src/db/purge-user-data.ts:66`).
- **C-2** Deterministic: one seeded RNG for the entire run; same seed + same
  anchor ⇒ identical database content (wall-clock columns like
  `originalRecordedAt` excepted — that column truthfully records write time
  and cannot be backdated). The seed and anchor are printed at the end of
  every run so a state can be named in a bug report.
- **C-3** All writes go through the domain layer — `saveWorkout`
  (`src/db/workouts.ts:670`), `saveProgram`/`adoptProgram`,
  `instantiateProgramDay` (`src/db/prescriptions.ts:556`), `applyGrant`
  (`src/db/entitlements.ts:89`, `reason` required), `recordConsent`
  (`src/db/consent.ts`) — never raw SQL into domain tables. Consent is seeded
  through `recordConsent` (appends are lawful on the append-only ledger); the
  e2e suite keeps clicking `/welcome` because it is testing the gate.
- **C-4** History is built exclusively with full `saveWorkout` calls carrying
  backdated `startedAt`/`completedAt` (`src/db/workouts.ts:685-697`). The
  set-level patch paths stamp `now()` (`src/db/workouts.ts:1169`) and MUST NOT
  be used for history.
- **C-5** Exercise ids are preflighted against `getAllExercises()` before any
  write, aborting the run on a miss — the `scripts/seed-templates.ts:47-56`
  idiom.
- **C-6** `user_preferences.unit` is set to `kg` (matching the pinned-spec
  convention, e.g. `e2e/workout.spec.ts:29`) unless the persona says
  otherwise.
- **C-7** Idempotent per persona slug: re-running refreshes rather than
  duplicates (purge-then-reseed is an acceptable v1 strategy).
- **C-8** The run emits a manifest at `e2e/.state/<persona>.json` with
  synthetic-example shape:

  ```json
  {
    "persona": "veteran",
    "userId": "user_xxx",
    "email": "persona_veteran@example.com",
    "seed": 42,
    "anchor": "2026-08-30T12:00:00Z",
    "workoutId": "<uuid of latest completed workout>",
    "programId": "<uuid>",
    "templateId": "<uuid>",
    "exerciseRef": "wger:345",
    "programShareToken": "<32-char token or null>",
    "workoutShareToken": "<32-char token or null>"
  }
  ```

  All dates ISO-8601 UTC. This file is how the screens rig resolves the 13
  param-taking routes.
- **C-9** The workout-events actor union (`src/db/workout-events.ts:19-30`)
  gains `'seed'`, mirroring program events (`src/db/program-events.ts:18`), so
  seeded data is honestly attributed and filterable.

## 05 · The history engines

- **H-1** **Freestyle engine** (powers `freestyle-lifer`, `drifting`,
  `mid-session`): a day loop from `anchor − years` to `anchor`; each day rests
  or trains by seeded probability; sessions draw exercises, loads, and rep
  outcomes from realistic progression curves with plateaus and gaps. Reuse the
  per-scheme generators in `src/lib/testing/arbitraries.ts` (0.5 kg lattice)
  where they fit.
- **H-2** **Program engine** (powers `veteran`, `week-one`,
  `edge-kitchen-sink`): adopt a seeded library template, then *play* it —
  `instantiateProgramDay` per scheduled day (one live instantiation per
  (day, week) is enforced at `src/db/prescriptions.ts:586-607`), fill sets
  against the snapshotted prescriptions, complete with the simulated day's
  timestamp. Block boundaries restart program entities; deloads and TM bumps
  happen because the real engine fires them, never by writing their outputs
  directly.
- **H-3** Simulated time only moves forward and never passes the anchor, so
  the future-date guard (`src/lib/workout-input.ts:230`) never trips.
- **H-4** After generation, the predicates in `src/lib/testing/invariants.ts`
  run over the produced data as a final assertion; a violation fails the run
  loudly.
- **H-5** Soft performance target: `veteran` (~1000 workouts, one transaction
  each on the 6543 pooler) completes in ≤ ~10 minutes. Batching is a permitted
  later optimization, not a v1 requirement.

## 06 · The screens rig

"Given a user, screenshots of what their screens look like" — without logging
in. Standard Playwright practice: auth-state reuse + a route-manifest walker +
the HTML report as the gallery. No new app, no new service.

- **G-1** A setup step signs in once per persona through the existing
  emulator `signIn()` flow (`e2e/auth.ts:101`) and saves
  `playwright/.auth/<persona>.json` via `storageState`. The directory is
  gitignored. Capture projects declare `storageState` +
  `dependencies: ['setup']` and never see a login screen.
- **G-2** A route manifest (checked in, hand-authored) lists every capturable
  route with: path template, param source (manifest field from C-8), ready
  signal, lane, and viewport set. Ready signals are per-route content
  assertions — the working pattern in `e2e/visual.spec.ts:42-70` —
  never `networkidle` (PostHog polls; the drawer refetches on focus).
- **G-3** Two lanes per route. `diffable`: deterministic under seeded data,
  eligible for `toHaveScreenshot()` baselines. `gallery-only`: captured but
  never diffed, per the rule already recorded at `e2e/visual.spec.ts:57-64`
  (a baseline over live data "is a change detector, not a regression test").
  Gallery-only in v1: `/programs/templates` (live wger), `/body` (signed photo
  URLs), `/coach` (LLM). Excluded entirely in v1: `/ops/*` (vendor fan-out,
  and the allowlist needs a user id that only exists after creation).
- **G-4** Matrix: persona × route × viewport. Viewports: phone 390×844
  everywhere; desktop 1280×900 only for surfaces that widen (home, program
  editor) — the Storybook set (`.storybook/preview.tsx:33-54`) is the
  reference. Theme is NOT an axis: the app is dark-only
  (`src/app/layout.tsx:85`); a light theme is a product change.
- **G-5** Captures run with `prefers-reduced-motion: reduce` emulated (view
  transitions, vaul), full-page, written to
  `screens/<persona>/<route-slug>@<width>.png` and attached to the test via
  `testInfo.attach()` so `npx playwright show-report` is the gallery viewer.
- **G-6** Entry point: `npm run screens` runs seed-if-missing → setup →
  capture for all personas; `-- --persona <slug>` filters; `-- --user <email>`
  captures an arbitrary existing emulator user (the clone composition, Q-4).
  The script maps to a dedicated Playwright project so `npm run test:e2e`
  stays unchanged.
- **G-7** Diff promotion is a follow-up, not v1: a small keep-list (home,
  logger, history, programs) may graduate to `toHaveScreenshot()` with
  committed baselines. Baselines are platform-suffixed (existing ones are
  `-darwin`); CI diffing waits until CI exists and generates baselines in the
  pinned Playwright Docker image. Hosted review services are explicitly
  deferred (Argos is the recorded first choice if churn ever hurts; Lost Pixel
  is archived — do not adopt).

## 07 · Clone-to-local (QA repro)

- **Q-1** `scripts/clone-to-scratch.ts` orchestrates: `pg_dump` prod (direct
  connection) → restore into the local scratch DB (S-1 guard applies to the
  restore target; the dump source is read-only) → rewrite the affected user's
  WorkOS id to a freshly created emulator user via the
  `scripts/migrate-user-id.ts` machinery → print sign-in instructions.
- **Q-2** `userScopedTableNames()` (`src/db/user-scoped-tables.ts:19`) gains
  `app_user_id` awareness so `rc_webhook_events` is covered — the drift test
  (`src/db/purge-user-data.test.ts:123`) already knows about both spellings;
  the runtime helper must match.
- **Q-3** Documented limitations, accepted: progress-photo blobs live in a
  private Supabase bucket and will not resolve locally; the consent ledger
  id-rewrite uses the same trigger-satisfying path the WorkOS migration used.
- **Q-4** Composition: after a clone, `npm run screens -- --user <email>`
  yields the reporter's full screen gallery (G-6).
- **Q-5** Privacy rule, written into the script's output: clones stay on this
  machine and are deleted after the repro. Masking (PostgreSQL Anonymizer) is
  explicitly out of scope until a copy ever needs to leave the machine.

## 08 · Non-functional & out of scope

Non-functional:

- No new runtime dependencies for the app; the seeder may add dev-only
  dependencies sparingly (a tiny seedable PRNG is preferred over faker; if
  faker is used, its seed AND ref-date must both be pinned — unpinned relative
  dates silently break determinism).
- Schema/type changes are limited to C-9 (`'seed'` actor) and Q-2
  (`app_user_id`); everything else is scripts and test config.
- No components ⇒ no stories obligation; lint ratchets and `tokens:check`
  untouched.
- Scratch-DB provisioning stays user-supplied in v1 (a documented one-liner in
  the script header); docker-compose is a separate decision (D-3).

Out of scope (recorded so they stay out): prod seeding, prod impersonation
("view as user"), per-user subsetting/extraction tooling, hosted visual-diff
services, CI wiring, a light theme, `@snaplet/seed`/drizzle-seed for domain
data (schema-level random rows cannot satisfy the invariants).

## 09 · Acceptance, by PR

Five PRs, each independently shippable and reviewable:

1. **Seeder skeleton** — S-1..S-6, C-1..C-3 (consent, prefs, grants), C-6..C-8
   partial, personas `day-one` + `week-one`. Accept: run against scratch DB
   creates an emulator user that signs into `/` past the consent gate showing
   the correct `HomeState`; `--purge` leaves zero rows; pointing at a
   non-local host aborts before any connection.
2. **Screens rig** — G-1..G-6. Accept: `npm run screens` produces a browsable
   report of both existing personas across the manifest with zero manual
   logins; re-run requires no re-auth within the run.
3. **Freestyle engine** — H-1, H-3..H-5, C-4, C-5, C-9; personas
   `freestyle-lifer`, `drifting`, `mid-session`. Accept: same seed twice ⇒
   identical row counts and values (wall-clock columns excepted); invariants
   pass; home shows `drifting` for the drifting persona.
4. **Program engine** — H-2; personas `veteran`, `edge-kitchen-sink`. Accept:
   ~1000-workout veteran generates within H-5's budget; prescriptions are
   engine-stamped (never written directly); deload/TM-bump rows exist where
   the program dictates; invariants pass.
5. **Clone-to-local** — Q-1..Q-5. Accept: a prod user cloned to scratch signs
   in locally as an emulator user and renders their real data; dry-run prints
   per-table counts and changes nothing.

## 10 · Open decisions (defaults proposed, decide at PR time)

- **D-1** Which library template the `veteran` plays (default: the GZCLP-shaped
  fixture already used in `src/app/status-hero.test.tsx`), and whether the five
  years switch programs mid-history (default: yes, twice).
- **D-2** RNG choice (default: a ~20-line local mulberry32; no dependency).
- **D-3** Whether to add a `docker-compose.yml` for the scratch Postgres
  (default: no in v1; document `createdb`/docker-run one-liners instead).
- **D-4** The diff-lane keep-list and when to generate Linux baselines
  (default: defer both until CI exists).
- **D-5** Whether `week-one`'s adopted template counts against the same
  library-template seeding PR 1 depends on (`npm run db:seed-templates` as a
  documented prerequisite vs the seeder invoking it; default: documented
  prerequisite).
- **D-6** Persona definition language (default: TypeScript modules typed
  against the action API — definitions stay type-checked as the domain
  evolves, zero new runtime; alternatives considered: embedded Lua, JSON
  DSL). Owner floated "a lua script or something" — the requirement being
  scriptability and engine-independence, which TS modules satisfy; revisit if
  non-TS authors ever need to write definitions.
