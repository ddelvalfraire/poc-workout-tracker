# Persona Foundry

## Problem Statement

A solo developer dogfooding an ~80k-line training app cannot see, test, or
debug it as anyone but himself. Every page is a DB-backed server component
behind auth, so page-level states (day-one empty, five-year veteran, lapsed
logger, program-less daily user) are unreviewable, e2e specs rebuild state
through the UI, and a real user's bug has no reproduction path. The cost is
shipping surfaces whose most common states have never been looked at.

## Evidence

- Owner, this session: "it's one of the biggest gaps in our program" and "it's
  how I can continue building as a solo dev at the scale of an 80k line
  project."
- `src/components/home/home-bento.stories.tsx:18-21` documents that the real
  home sections are async RSCs reaching the database and cannot be storied —
  there is no page-state harness at all.
- Every Playwright spec drives the emulator login UI from scratch; no
  `storageState` exists anywhere (`playwright.config.ts:41-48`, `e2e/auth.ts`).
- `HomeState` enumerates 7 states in code (`src/lib/home-status.ts:49-56`);
  most have never rendered with realistic data.

## Proposed Solution

A **feature-agnostic simulation engine** plus **user-authored persona
definitions**, a **one-command screenshot gallery**, and a **clone-to-local
repro pipeline** — all dev tooling in this repo, no new app or service.

The engine knows nothing about what users are. It provides: safety rails
(local-DB-only, dry-run), a deterministic seeded RNG, a forward-moving
simulated clock that backdates writes through the real domain layer, and a
library of composable **actions** that map 1:1 onto domain writes
(`createUser`, `consent`, `grant`, `logFreestyleSession`, `adoptProgram`,
`playProgramDay`, …). Persona definitions are separate scripts we write
against that action API — the named personas (day-one, freestyle-lifer,
veteran, …) are a starter library, not the product. When the app grows a
feature (e.g. friends), we add an action binding and scripts can compose it,
including multi-user scenarios with relationships. Screens: sign in once per
persona (Playwright `storageState`), walk a route manifest, browse the HTML
report as a gallery. Repro: dump prod → restore to scratch → rewrite the
user's id to an emulator user (`scripts/migrate-user-id.ts`) → sign in, or
run the gallery against them.

Chosen over alternatives: raw-SQL/schema-level seeding cannot satisfy the
domain invariants (snapshotted prescriptions, technique CHECKs, TM-bump
ledger); a fixed persona enum cannot survive product growth; a standalone app
duplicates what Playwright already provides.

## Key Hypothesis

We believe scriptable persona seeding plus per-persona screen galleries will
let a solo developer review, test, and debug the app from any user's
perspective without manual setup. We'll know we're right when any defined
user's full gallery renders in ≤10 minutes from cold with zero manual logins,
every release review covers all 7 HomeStates and the keep-list routes, and the
tooling surfaces at least one real issue in its first month.

## What We're NOT Building

- **A standalone app or service** — Playwright supplies auth reuse, capture,
  diffing, and the gallery viewer; the product is scripts + config.
- **Prod seeding or prod impersonation** — local scratch DB only; "view as
  user" in prod is deferred indefinitely (clone-to-local + session replay
  cover the need).
- **Per-user data extraction with referential-integrity solving** — whole-dump
  + id-rewrite wins at this database size.
- **A hosted visual-diff service** — deferred until baseline churn hurts
  (Argos is the recorded first choice; Lost Pixel is archived).
- **A fixed persona product** — the engine ships with a starter library, but
  defining users is deliberately left to scripts outside the engine.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Glance time | Any persona's full gallery ≤10 min from cold, 0 manual logins | Timed run of `npm run screens -- --persona <slug>` on a fresh scratch DB |
| State coverage | 7/7 HomeStates + 100% of keep-list routes captured per release review | Route-manifest completeness check in the screens run summary |
| Bugs surfaced | ≥1 real UI/data/engine issue found via personas, gallery, or the invariant pass in month one | Issues/PRs tagged as found-by-foundry |

## Open Questions

- [ ] Scripting layer confirmation: TypeScript persona modules typed against
      the action API (proposed default) vs an embedded DSL (Lua was floated).
      TS is proposed because definitions stay type-checked as the domain
      evolves — the GitLab factory rationale — with zero new runtime.
- [ ] Relationship primitives: engine must support multi-user scenarios from
      day one (scenario = N users + links), but concrete relationship actions
      wait for the product feature (friends) to exist. Confirm this split.
- [ ] D-1..D-5 from `docs/specs/personas-and-screens.md` §10 (veteran's
      template, RNG, docker-compose, diff keep-list timing, template-library
      prerequisite).
- [ ] "Bugs surfaced" instrumentation: is a found-by-foundry tag on issues/PRs
      enough, or keep a small journal in the docs?

---

## Users & Context

**Primary User**
- **Who**: The owner/solo developer (also the ops user and the QA of record).
- **Current behavior**: Reviews UI as his own prod account only; builds e2e
  state through the UI; cannot reproduce other users' states at all.
- **Trigger**: Shipping or reviewing a surface; a bug report from a real user;
  wanting to dogfood a state he doesn't personally inhabit (day-one, lapsed,
  program-less).
- **Success state**: One command materializes the user and shows every screen;
  a reported bug is reproduced locally on the reporter's actual data shape.

**Job to Be Done**
When I ship a surface or receive a bug report, I want to materialize any
defined user state and see every screen as that user, so I can review, verify,
and debug without manual setup or logging in.

**Non-Users**
End users and external contributors. This is internal dev tooling; nothing in
it ships to production or appears in the app.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Engine: safety rails (S-1..S-6), seeded determinism, forward-through-past simulated clock, manifest output | Rule zero + reproducible states nameable in bug reports |
| Must | Action API mapped 1:1 to domain writes; persona definitions live outside the engine as scripts | The composability requirement — the engine "shouldn't care what our users are" |
| Must | Starter library: day-one, week-one, freestyle-lifer, veteran, drifting, mid-session, edge-kitchen-sink | Covers all 7 HomeStates + scale regimes on day one |
| Must | History engines: freestyle day-loop + program play-through with invariant post-assertion | Realism and the long-horizon correctness dividend |
| Must | Screens rig: per-persona `storageState`, route manifest, `npm run screens`, report-as-gallery, `--user <email>` | The "glance without logging in" requirement |
| Must | Clone-to-local: dump → restore → id-rewrite → sign in; `app_user_id` fix | QA repro is a co-equal v1 goal (owner decision) |
| Should | Multi-user scenarios (N users + links) as an engine capability, primitives arriving with product features | Future-proofing for friends/social without speculative API |
| Should | Diff lane: promote a small keep-list to `toHaveScreenshot()` baselines | Regression protection once the gallery stabilizes |
| Could | Nightly/CI runs; publishing a run's gallery as a shareable artifact | Waits on CI existing at all |
| Won't | Prod seeding, prod impersonation, per-user extraction, hosted diff service, light-theme axis | Recorded with reasons in spec §08 |

### MVP Scope

Owner decision: **there is no MVP cut — all five phases are the product.**
This is infrastructure for continuing to build solo at current scale, not an
experiment to validate. The hypothesis is instead tested by the three success
metrics once the phases land.

### User Flow

1. `npm run persona -- --persona veteran` (or a custom definition file) →
   guard passes on the scratch DB → engine executes the script through the
   action API → prints seed, anchor, email, manifest path.
2. `npm run screens -- --persona veteran` → signs in once, walks the manifest,
   `npx playwright show-report` shows the grid.
3. Bug report path: `npm run clone -- --user <workos-id>` (dry-run, then
   `--commit`) → sign in locally as the emulator user →
   `npm run screens -- --user <email>` for the reporter's full gallery.

---

## Technical Approach

**Feasibility**: HIGH — verified against the codebase this session.

**Architecture Notes**
- Writes go through the domain layer exclusively; backdating rides
  `saveWorkout`'s `startedAt`/`completedAt` (`src/db/workouts.ts:685-697`);
  set-level patches stamp `now()` and are forbidden for history.
- The engine/action split is the load-bearing decision: actions are thin
  typed bindings over `src/db/*` writes, so persona scripts survive schema
  evolution and new features become new actions, not engine changes.
- Auth is the WorkOS emulator or nothing (`e2e/auth.ts:14-16` stance);
  sessions reuse via Playwright `storageState`.
- Full requirements with file:line evidence: `docs/specs/personas-and-screens.md`.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Tool pointed at prod (`.env.local` is live Supabase; DB connects at import) | M | S-1 host guard before any DB import; no prod escape hatch in v1 |
| Program play-through drifts from engine semantics (TM bumps, deloads, block restarts) | M | Only ever call the real engine (`instantiateProgramDay`); invariant predicates as post-assertion; failures are findings |
| Veteran generation too slow (~1000 transactions on the 6543 pooler) | L | Soft ≤10 min budget; batching is a permitted later optimization |
| Action API churn as features land | M | Actions are 1:1 domain bindings — churn is additive; persona scripts are type-checked against it |
| Screenshot nondeterminism (live wger, signed URLs, LLM) | L | Two lanes; gallery-only routes never diffed (rule already recorded in `e2e/visual.spec.ts:57-64`) |

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
| 1 | Engine core | Guard, RNG, clock, action API foundation (user/consent/prefs/grant), manifest, defs: day-one + week-one | complete | - | - | `.claude/PRPs/plans/completed/persona-foundry-phase-1-engine-core.plan.md` — report: `.claude/PRPs/reports/persona-foundry-phase-1-engine-core-report.md` |
| 2 | Screens rig | storageState per persona, route manifest, `npm run screens`, report-as-gallery, `--user` | pending | with 3, 5 | 1 | - |
| 3 | Freestyle actions | Day-loop scheduler, logging actions, `'seed'` actor; defs: freestyle-lifer, drifting, mid-session | pending | with 2, 5 | 1 | - |
| 4 | Program actions | Adopt/play-through actions, blocks/deloads/TM bumps, invariant post-assertion; defs: veteran, edge-kitchen-sink | pending | - | 3 | - |
| 5 | Clone-to-local | Dump → restore → id-rewrite orchestration, `app_user_id` fix, privacy rule | pending | with 2, 3 | 1 | - |

### Phase Details

**Phase 1: Engine core**
- **Goal**: A safe, deterministic engine that runs persona definition files.
- **Scope**: `scripts/` CLI, S-1..S-6, action API seam with the non-history
  actions, emulator-user creation, `--purge`, manifest emission, two starter
  definitions.
- **Success signal**: Seeded user signs into `/` past the consent gate showing
  the correct HomeState; `--purge` leaves zero rows; non-local host aborts
  before any connection.

**Phase 2: Screens rig**
- **Goal**: One command → every screen for any authenticated user.
- **Scope**: Setup project + storageState, route manifest (path, param source,
  ready signal, lane, viewports), `screens` Playwright project, npm script.
- **Success signal**: Full gallery of existing personas with zero manual
  logins; report browsable via `show-report`.

**Phase 3: Freestyle actions**
- **Goal**: Realistic multi-year ad-hoc history through the domain layer.
- **Scope**: Day-loop with seeded probabilities, backdated `saveWorkout` only,
  progression curves + gaps, bodyweight/notes/customs actions, `'seed'` actor
  union widening.
- **Success signal**: Same seed twice ⇒ identical content (wall-clock columns
  excepted); drifting persona renders `drifting` on home.

**Phase 4: Program actions**
- **Goal**: The veteran — five lawful years played through the real program
  engine.
- **Scope**: Adopt/instantiate/fill/complete actions, block restarts, deloads,
  TM bumps, technique doses; invariants run as post-assertion.
- **Success signal**: ~1000-workout veteran within budget; prescriptions
  engine-stamped; invariant pass green.

**Phase 5: Clone-to-local**
- **Goal**: Reproduce any real user's state locally in minutes.
- **Scope**: `pg_dump`/restore orchestration, id-rewrite via
  `migrate-user-id.ts` machinery, `userScopedTableNames()` `app_user_id` fix,
  delete-after-repro rule in output.
- **Success signal**: A prod user cloned to scratch signs in locally and
  renders their real data; dry-run changes nothing.

### Parallelism Notes

Phase 1 is the foundation; 2, 3, and 5 all depend only on it and can proceed
in parallel (they touch disjoint files: e2e config vs engine actions vs
scripts). Phase 4 extends Phase 3's scheduler. As stacked PRs: 1 → {2, 3, 5}
→ 4, each reviewed independently.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Seeding layer | Through domain functions | Raw SQL; drizzle-seed/@snaplet/seed | Invariants (snapshotted prescriptions, technique CHECKs, TM ledger) make row-level seeding corrupt-by-construction; Snaplet frozen |
| Persona definition form | External scripts over a typed action API (TS modules proposed) | Hardcoded roster; JSON config; embedded Lua | Owner requirement: engine must not care what users are; TS keeps definitions type-checked as the domain evolves — pending confirmation (open question) |
| Time model | Simulate forward through past time, backdated writes | Virtual clock engine (PostHog Matrix); rate compression | Realism at ~1% of the cost; write paths already support backdating; future-date guard never trips |
| Gallery viewer | Playwright HTML report via `testInfo.attach()` | Custom viewer app; hosted service | Zero build; industry-standard; hosted review deferred to Argos if churn hurts |
| QA repro | Whole-dump + id-rewrite to emulator user | Per-user extraction; prod impersonation | Industry does environment cloning; extraction is Greenmask/Tonic-tier hard; impersonation is real security work deferred |
| Auth for seeded users | WorkOS emulator only | Session minting/test-login route | Recorded e2e stance: a bypass route is a permanent security surface |
| MVP framing | No MVP — all five phases are the product | Ship seeder+gallery first, rest later | Owner decision: this is scale infrastructure for solo development, not an experiment |
| Cadence | On demand only | Pre-deploy checklist step; nightly | Owner decision; no CI exists; revisit at CI time |

---

## Research Summary

**Market Context** (full citations in the Persona Foundry artifact)
- Named personas + config escape hatch is the canonical sandbox design
  (Plaid); age-relative fixture dates keep personas evergreen; nobody
  retrofits history onto existing accounts — backdating only for objects born
  in the sandbox (Stripe test clocks).
- Curated, scenario-tagged datasets beat random generators (Shopify deleted
  `shopify populate` for exactly this); realistic history comes from
  simulation scaled to need (PostHog Matrix at the high end, GitLab
  factory-level seeds as the proportionate version).
- Authenticated visual QA = storageState reuse + route-manifest galleries
  (BBC Wraith → GOV.UK lineage) + small diff keep-lists; hosted review
  (Argos/Chromatic) only when churn justifies it; Lost Pixel archived 2026-04.
- Bug repro is whole-environment cloning (Neon branches, thin clones,
  dump/restore) — no prominent public per-user extraction tooling exists.

**Technical Context** (verified this session, file:line in spec)
- Backdating supported (`saveWorkout`), future dates rejected, set patches
  stamp `now()`; `instantiateProgramDay` enforces one live instantiation per
  (day, week); `applyGrant` backdatable; `recordConsent` is the lawful consent
  seam; `purgeUserData` + pinned roster give teardown; `migrate-user-id.ts`
  gives id-rewrite; the Playwright host guard is the safety precedent; the
  worktree `.env.local` points at live prod (rule zero); app is dark-only; no
  CI exists.

---

*Generated: 2026-08-30*
*Status: DRAFT - needs validation*
