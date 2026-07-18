# Custom Exercises

## Problem Statement

The app's exercise identity is an integer `wgerExerciseId` pointing at wger's public catalog, but the catalog is missing common movements (no cable face pull, no kneeling cable crunch, no plain "chest-supported machine row") and has trap entries that caused 15 wrong IDs in the user's live program. The user has approved a negative-ID stopgap for custom movements, but identity-by-sign-bit is invisible convention: nothing in the data says "custom", customs can't be searched, and they're excluded from muscle tagging and any volume-by-muscle feature.

## Evidence

- Catalog audit (2026-07-04) found 15 of ~30 program slots pointing at wrong entries (e.g. "Barbell Bench Press" → "Pin Bench Press BB"; "Back Squat" → a bodyweight "Slow Squat").
- Two program slots have **no correct entry at all**: Face Pulls (nearest: "Dumbbell Bent Over Face Pull") and Cable Crunch (nearest: "Weighted Crunch", dumbbell).
- Spike (2026-07-04) proved negative IDs work end-to-end (validation, instantiation, logging, e1RM, last-performance) — feasible, but user rejected it as the durable design: "discriminator is fine."

## Proposed Solution

First-class custom exercises: a per-user `custom_exercises` table with full app-side wger parity (name, category, equipment, primary/secondary muscles — the `Exercise` shape in `src/lib/wger.ts:38-47`; wger's descriptions/images are never surfaced by this app), plus a `source: 'wger' | 'custom'` discriminator column on `workout_exercises` and `program_exercises`. Exercise identity becomes the composite `(source, id)`. Customs merge into the existing in-memory catalog so search, muscle tagging, history, progression, and program stats treat them identically to wger entries.

**Revised 2026-07-15 (post-stats):** the surface order flips to **web-UI-first** — creation lives inside the logger's picker as the "none of these match" escape hatch at the bottom of search results (dedup at the source: you create only after staring at the catalog's best matches), editing lives on the custom's `/exercises/custom/[id]` page, and the logger draft learns `source` so the five wger-hardcoded call sites become composite-correct. **Ownership stays strictly per-user; no global/shared catalog** — wger IS the shared catalog, and cross-user sharing is an entity-resolution/moderation problem (fifty spellings of "V-Bar Cable Row") that corrupts strangers' stats when merged wrong. If a custom ever deserves promotion, that's a future curation action, not automatic sharing. MCP tools ship as the final parity phase.

## Key Hypothesis

We believe first-class custom exercises will eliminate wrong-ID/nearest-match noise for movements wger lacks.
We'll know we're right when the two known nearest-match slots (Face Pulls, Cable Crunch) are replaced by true customs that show correct muscle tags and accumulate history/progression indistinguishably from wger exercises.

## What We're NOT Building

- **Global/shared custom catalog (all users)** — decided 2026-07-15: per-user ownership only. Dedup happens at creation (the picker shows catalog matches before the create option), not by merging users' customs after the fact. Promote-to-catalog curation is the future path if ever needed.
- **Delete for custom exercises** — create + edit only in v1; deletion semantics (orphaned history) deferred until there's a real need.
- **Upstreaming to wger** — no wger account integration/contribution flow; customs are local to this user.
- **Free-text categories** — custom exercises use wger's fixed category set so merged filtering stays coherent.
- **Required muscle tagging** — category is required (drives grouping); muscles optional-but-encouraged (they feed muscle-volume and replacement suggestions; untagged customs land in the volume page's 'Other' row).

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Custom parity | A custom exercise supports search, muscle tags, logging, e1RM, last-performance, progression, and program stats with zero special-casing at call sites | Tests + live walkthrough |
| Merged search | `search_exercises` returns wger + customs, each labeled with source, one call | Tool output |
| No stopgap residue | Zero negative-ID exercise references remain after migration | DB query in migration validation |
| Dogfood swap | Face Pulls + Cable Crunch slots in the live block point at true customs | `get_program` output |

## Open Questions

- [x] Custom ID space: own serial sequence (customs and wger IDs may numerically collide — fine, since identity is composite) vs. offset. Default: plain serial; the discriminator carries the meaning. **Resolved (Phase 1): integer identity PK, own sequence; identity is the composite `(source, id)`.**
- [x] Muscle storage on `custom_exercises`: text[] columns vs. child rows. Default: mirror the `Exercise` interface (arrays) since it's catalog data, not aggregated-over relational data — but the plan phase should check against the `program_exercise_muscles` precedent (columns-vs-JSON boundary rule in that schema's comments). **Resolved (Phase 1): text[] columns — catalog data nothing aggregates over; `program_exercise_muscles` stays the aggregation surface, fed from these arrays in Phase 3.**
- [ ] Does `get_last_performance` (MCP) grow a `source` arg with `'wger'` default, or a single composite ref? Decide in phase-4 plan; must stay backward-compatible for existing callers.
- [ ] Catalog cache versioning: merged catalog must not be cached in the shared Redis wger key (`wger:exercise-catalog:v1`) since customs are per-user. Likely merge-at-query, not merge-at-cache.

---

## Users & Context

**Primary User**
- **Who**: The app's owner — mid-block lifter whose gyms have machines/movements wger doesn't model.
- **Current behavior**: Accepts nearest-match wger entries (wrong equipment, wrong movement) or would use negative-ID convention that only he and Claude understand.
- **Trigger**: Programming or logging a movement that catalog search can't find (cable face pull, kneeling cable crunch, specific machines).
- **Success state**: Creates the movement once via Claude, and it behaves like any catalog exercise forever after.

**Job to Be Done**
When a movement I actually perform doesn't exist in the wger catalog, I want to define it once as a first-class exercise, so I can program, log, and track it without mislabeled data or invisible conventions.

**Non-Users**
Multi-user/coach scenarios; users wanting to browse/import community exercise databases.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | `custom_exercises` table (per-user) + `source` discriminator on exercise references | The identity model everything else hangs on |
| Must | Composite-key `(source, id)` history/progression/stats | Without it customs are second-class; this is the bulk of the work |
| Must | Merged catalog: search + muscle tagging include customs | "Zero special-casing" parity target |
| Must | MCP create/update/list custom exercise tools | MCP-first surface |
| Must | Negative-ID migration (backfill into `custom_exercises`, rewrite refs) | Kills the stopgap cleanly; currently zero rows, cheap insurance |
| Should | Dogfood: swap Face Pulls + Cable Crunch to true customs | The validation case; final phase |
| Could | `source` shown in get_workout/get_program outputs | Cheap observability of custom-ness |
| Won't | Web picker integration, delete, sharing, free-text categories | See "Not Building" |

### MVP Scope

Phases 1–4 below: schema + entity, composite identity, merged catalog, MCP tools. Phase 5 (dogfood swap) is the acceptance test.

### User Flow

"Create a custom exercise: Cable Face Pull, shoulders, cable, rear delts primary" → tool returns `(custom, 1)` → swap the program slot to it → next Upper day logs against it → history/e1RM/program-stats all show it like any other lift.

---

## Technical Approach

**Feasibility**: HIGH — the catalog is already an in-memory list behind one accessor, and identity is already denormalized onto every reference row.

**Architecture Notes**
- Parity = the app's `Exercise` interface (`src/lib/wger.ts:38-47`): `{ id, name, category, equipment?, muscles?, musclesSecondary? }` — NOT the full wger model.
- New `source` text column (default `'wger'`, app-level enum like `set_type`) on `workout_exercises` and `program_exercises`; `custom_exercises` table owns `user_id` (same ownership pattern as `workouts`/`programs` roots).
- Merged catalog: `loadExerciseCatalog`/`searchExercises` gain a per-user custom overlay merged at query time. The shared Redis key `wger:exercise-catalog:v1` stays wger-only (customs are per-user and change often).
- Composite key touch points: `getLastPerformance`, `getExerciseHistoryBefore`, `deriveDayPrescription`'s e1rm/lastSets maps, `instantiateProgramDay` copy, `muscleRowsFor`, program-stats grouping (`src/db/program-stats.ts`, keyed on `wgerExerciseId` alone today — see program-stats PRD).
- Column naming: `wgerExerciseId` becomes a misnomer for custom rows; plan phase decides rename (`exercise_id` + `source`) vs. keep-name-with-comment. Rename is the honest choice but widens the diff; decide per-phase.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| A query site keeps filtering on bare integer id and silently mixes a wger and custom exercise with the same number | M | Grep-audit all `wgerExerciseId` predicates in phase 2; tests pin composite behavior with deliberately colliding ids |
| Per-user customs leak into shared catalog cache | M | Merge-at-query design; never write merged lists to the shared Redis key |
| Program-stats phase(s) land before this and hard-code the scalar key | H (it's sequenced first) | Program-stats PRD already notes the widening; phase-2 plan here includes that refactor explicitly |
| `upsert_program` full-replace path needs `source` on its exercise input or replaces would downgrade customs to wger | M | Phase 4 extends the input schema + validation together with the granular tools |

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
| 1 | Entity + schema | `custom_exercises` table, `source` columns (default 'wger'), negative-ID backfill migration, `src/db/custom-exercises.ts` CRUD (create/update/list, no delete) | complete | - | - | `.claude/PRPs/plans/completed/custom-exercises-entity-schema.plan.md` |
| 2 | Source-aware drafts + identity plumbing | `DraftExercise`/payload codec learn `source` (versioned, old drafts parse); save/edit paths persist it; fix the five wger-hardcoded sites (`getLastPerformance(+Action)`, `getExerciseHistoryBefore`, `getExerciseSheetAction`, `getExerciseBestAction`); audit remaining scalar-key sites — exercise-stats/program-stats/muscle-volume are already composite | complete | - | 1 | [plan](../plans/completed/custom-exercises-source-aware-drafts.plan.md) · [review](../reviews/custom-exercises-source-drafts-review.md) |
| 3 | Merged catalog + create/edit UI | Per-user overlay in search (`/api/exercises` + picker, source-labeled); picker "Create '<query>'…" flow (name + required category + optional muscles); Edit on `/exercises/custom/[id]` | complete | - | 2 | [plan](../plans/completed/custom-exercises-create-ui.plan.md) · [review](../reviews/custom-exercises-create-ui-review.md) |
| 4 | MCP surface | **4a complete (PR #71)**: `create/update/list_custom_exercise` tools; `source` on `get_last_performance` + workout write tools; merged `search_exercises` output. **4b in-progress** ([plan](../plans/custom-exercises-source-aware-program-writes.plan.md)): `source` on `upsert_program` + program patch tool inputs; custom-aware `muscleRowsFor`; unpin the 'wger' derives in `programs.ts`; unlock program-builder/substitute flows | in-progress | - | 2, 3 | [review](../reviews/custom-exercises-mcp-review.md) |
| 5 | Dogfood swap | Create Cable Face Pull + Kneeling Cable Crunch customs (via the new UI); swap the two live-program slots; verify parity end-to-end incl. stats/sheet/PR/muscle-volume | pending | - | 4 | - |

### Phase Details

**Phase 1: Entity + schema**
- **Goal**: The identity model exists and the stopgap is dead.
- **Scope**: Drizzle schema + migration (table, columns, backfill), user-scoped CRUD module following `db/programs.ts` auth-boundary conventions; wger category enum enforced at the input boundary.
- **Success signal**: Migration runs clean; CRUD tests green; zero negative-ID references possible post-backfill.

**Phase 2: Composite identity**
- **Goal**: Customs are indistinguishable from wger exercises in every read path.
- **Scope**: `(source, id)` through `getLastPerformance`, `getExerciseHistoryBefore`, `deriveDayPrescription`, `instantiateProgramDay`, `muscleRowsFor`, program-stats grouping key; collision tests (same integer, different source).
- **Success signal**: A custom exercise with an id colliding with a wger id keeps fully separate history/stats.

**Phase 3: Merged catalog**
- **Goal**: One search, one catalog, both sources.
- **Scope**: Per-user merge at query time in `searchExercises`/`loadExerciseCatalog`; results labeled with source; shared Redis cache untouched; author-time muscle tagging reads custom muscle definitions.
- **Success signal**: `search_exercises` finds a custom by name; saving a program with it produces correct `program_exercise_muscles` rows.

**Phase 4: MCP surface**
- **Goal**: Claude can manage the full custom-exercise lifecycle.
- **Scope**: New tools (create/update/list) with existing `read-tools.ts`/`write-tools.ts` registration + test conventions; `source` parameter (default `'wger'`) threaded through exercise-referencing tools and `upsert_program`/patch-tool input schemas, backward-compatible.
- **Success signal**: End-to-end via MCP only: create custom → add to program → instantiate → log → `get_last_performance` returns it.

**Phase 5: Dogfood swap**
- **Goal**: The live block's two nearest-match slots become honest.
- **Scope**: Create the two customs with proper muscle tags; `update_program_exercise` the Upper-day Face Pulls and Legs-day Cable Crunch slots (granular tools only — never full-replace an in-flight program); note the known in-block history detach for those two accessories.
- **Success signal**: `get_program` shows both slots with `source: custom`; next logged session accrues history under them.

### Parallelism Notes

Phases 2 (query-site widening) and 3 (catalog merge) both depend only on phase 1 and touch disjoint surfaces (db read paths vs. catalog/lib layer), so they can run concurrently. Phase 4 needs both (tools expose merged search and composite refs). Phase 5 is manual validation gated on 4.

### Sequencing vs. program-stats PRD

This feature starts only after the program-stats phases complete (their success metric is zero schema migrations). Phase 2 here explicitly includes widening the by-then-existing `src/db/program-stats.ts` grouping key.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Identity model | `source` discriminator + composite `(source, id)` | Negative IDs (spiked, works); offset ranges; UUIDs everywhere | Explicit > sign-bit convention; user: "discriminator is fine" |
| Entity richness | Full app-side wger parity (`Exercise` shape) | Name-only; full wger model incl. descriptions | User chose parity; app never surfaces more than the 5-field shape anyway |
| Surfaces | MCP-first, UI later | MCP+UI together; MCP-only forever | App is MCP-first in practice; picker is additive later |
| Search | Merged, source-labeled | Separate list tool | One lookup everywhere; parity target |
| Lifecycle | Create + edit, no delete | Full CRUD; create-only | Dodges orphaned-history semantics until needed |
| Categories | wger's fixed set, enforced | Free text | Merged category filtering stays coherent |
| Stopgap rows | Migrate to `custom_exercises` | Freeze; forbid | Seamless history; currently zero rows so near-free |
| Dogfooding | Final phase swaps Face Pulls + Cable Crunch | Leave block alone | It's the hypothesis test; user accepted the small history detach |
| Ownership (2026-07-15) | Strictly per-user; no all-users catalog | Global shared customs with dedup/moderation | User raised it; dedup-at-source (picker steers to catalog matches before create) beats after-the-fact entity resolution; promote-to-catalog is the future curation path |
| Surface order (2026-07-15) | Web-UI-first (picker create, detail-page edit), MCP last | MCP-first (original) | Post-stats the UI is the daily surface; five hardcoded sites now carry correctness risk |
| Create form (2026-07-15) | Name + required category, optional muscles/equipment | Name-only; everything required | Category drives grouping; optional muscles keep gym-floor friction low while feeding volume/replacement when provided |
| Management (2026-07-15) | Edit on /exercises/custom/[id]; no delete | Create-only; full manage page + delete | The stats detail page already exists per custom; delete still dodged (orphaned history) |

---

## Research Summary

**Market Context**
Mainstream trackers (Strong, Hevy) all offer user-created custom exercises as first-class records alongside their built-in catalogs — table stakes for serious logging. None expose the catalog/custom distinction as a leaky convention; the discriminator design matches the norm. (Prior product knowledge; low-risk, framing only.)

**Technical Context**
Spike (2026-07-04, this session) validated every code path is sign/id-agnostic: negative-ID custom exercise created, supersetted (`supersetGroup`), instantiated, logged (e1RM computed), returned by `get_last_performance`, and cleaned up. Catalog is a single in-memory list behind `getCatalog()` (`src/lib/wger.ts`) with a shared Redis layer that must stay wger-only. Validation boundaries (`program-input.ts:178`, `workout-input.ts:112`) accept any integer. Spike side-findings: `upsert_program` input lacks `supersetGroup` (full replace wipes groupings — phase 4 should fix alongside `source`), and `get_workout`'s plan overlay omits `supersetGroup` (candidate incidental fix).

---

*Generated: 2026-07-04*
*Status: DRAFT - needs validation*
