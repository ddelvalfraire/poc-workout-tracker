# MCP Agent Server

## Problem Statement
Logging a workout still means opening the app and tapping every set in by hand. The lifter already *narrates* their training ("today was bench 5×5 at 100, then rows…") to other tools and assistants — but none of that can reach this app. There's no programmatic surface, so an AI agent can't read the user's history or write a session on their behalf.

## Evidence
- The app exposes its capabilities only through React Server Actions gated by Clerk (`src/app/workout/actions.ts`), and HTTP only via `/api/exercises` — there is no machine/agent entry point.
- Direct user signal (this request): *"here is my workout this week add it for me so i don't have to manually."*
- The data layer is already cleanly `userId`-parameterized (`src/db/workouts.ts`), so the capability exists internally; it's just not reachable by an agent.

## Proposed Solution
Ship an **MCP server as part of the existing Next.js app** — a route handler at `/api/mcp` (Vercel `mcp-handler`, Streamable HTTP transport) that exposes the app's existing data-layer functions as MCP tools. Read tools (list/get workouts, exercise history, search the wger catalog, get unit) and write tools (create/insert a workout, set unit) call `src/db/*` and `src/lib/wger.ts` directly, reusing `parseWorkoutInput` for validation. Because it lives in the app, it shares the Drizzle client, the wger Redis cache, and deploys to the same Vercel URL — so a remote MCP client (e.g. Claude) can connect to the live app and both read and write training data conversationally.

## Key Hypothesis
We believe **exposing the app's read/write capabilities as MCP tools** will let a lifter **log and review training by talking to an agent instead of tapping the UI**.
We'll know we're right when **an agent connected to `/api/mcp` can take "add my workout this week" and produce the correct persisted workout rows, and can read back a user's history** — verified end-to-end.

## What We're NOT Building
- **Auth / per-user security on the MCP endpoint** — explicit POC decision; the endpoint is public and the target user is resolved from a tool arg or a dev env var. Not production-safe; not in scope.
- **A new data model** — tools wrap the *existing* db/wger functions; no schema changes.
- **Rate limiting, quotas, audit logging, multi-tenant isolation** — deferred with auth.
- **A bespoke stdio/desktop server binary** — the HTTP route covers remote MCP clients; a stdio shim is a Could, not a Must.
- **NLP "parse my freeform paragraph" logic in the server** — the *agent* structures the workout into tool arguments; the server validates/persists.

## Success Metrics
| Metric | Target | How Measured |
|--------|--------|--------------|
| Agent can create a workout | "add this workout" → correct rows (exercises + sets) in Postgres | Connect an MCP client, call the tool, assert the row tree (mirrors `e2e/workout.spec.ts`) |
| Tool coverage of existing APIs | 100% of read paths + workout create exposed | Tool list vs `src/db/workouts.ts` + `src/lib/wger.ts` |
| Round-trip latency (read tool) | < 500 ms warm | Manual / tool timing |

## Open Questions
- [ ] How does the target `userId` reach a tool with no auth — a required tool arg, or a single `MCP_DEV_USER_ID` env default (so "add my workout" needs no id)? (Leaning: optional arg, env fallback.)
- [ ] Which MCP clients will connect for testing (Claude remote MCP via URL vs a local `mcp-handler` dev client)? Affects only the connection doc.
- [ ] Confirm `mcp-handler` ↔ Next 16 / Fluid Compute compatibility at plan time (verify current package + version).

---

## Users & Context

**Primary User**
- **Who**: The builder/lifter dogfooding the app — technical enough to connect an MCP client to a URL.
- **Current behavior**: Logs workouts by hand in the UI; narrates training in chat elsewhere.
- **Trigger**: Finishing (or planning) a session and wanting to capture it by telling an agent, not tapping.
- **Success state**: "Add this week's workouts" results in correct, reviewable sessions in the app; "what did I bench last week" returns real data.

**Job to Be Done**
When I've just trained (or want to review), I want to tell an AI agent what happened, so I can capture and query my training without manual data entry.

**Non-Users**
End users on the public app (no MCP UI), and any multi-tenant/production scenario — this is a single-developer POC surface.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | MCP endpoint at `/api/mcp` (Streamable HTTP) that an MCP client can connect to and list tools | The transport; nothing works without it |
| Must | `create_workout` tool — validate via `parseWorkoutInput`, persist via `saveWorkout(userId, input)` | The headline "add it for me" capability |
| Must | Read tools — `list_workouts`, `get_workout`, `search_exercises` | An agent must see history + find exercises to log correctly |
| Must | Public-route exemption for `/api/mcp` in `src/proxy.ts` | POC has no auth; the endpoint must bypass Clerk |
| Should | `get_exercise_history` / `last_performance`, `get_weight_unit`, `set_weight_unit` | Rounds out parity with the app's read surface + unit handling |
| Should | `update_workout`, `delete_workout` tools | Full CRUD parity for agent-driven edits |
| Could | A `workout://{id}` MCP resource + a connection/setup doc (README or skill) | Nicer agent ergonomics + how to connect Claude |
| Won't | Auth, rate limiting, freeform NLP parsing, separate stdio binary | Out of scope per POC decision |

### MVP Scope
The endpoint is live and public, exposes `create_workout` + `list_workouts` + `get_workout` + `search_exercises`, and a connected agent can both **insert** a multi-exercise workout (asserted in Postgres) and **read** it back. Units default to the user's stored preference; `userId` comes from a tool arg or `MCP_DEV_USER_ID`.

### User Flow
Connect MCP client to `https://<app>/api/mcp` → agent calls `search_exercises` to resolve names → agent calls `create_workout` with structured sets → server validates + persists → agent calls `get_workout`/`list_workouts` to confirm.

---

## Technical Approach

**Feasibility**: HIGH — the capability already exists in the data layer; this is an adapter, not new logic.

**Architecture Notes**
- **In-app route handler**, not a separate service: `app/api/mcp/[transport]/route.ts` via `mcp-handler` (Vercel's Next MCP adapter over `@modelcontextprotocol/sdk`). Reuses the Drizzle client (`src/db`), wger cache (`src/lib/wger.ts`), and deploys with the app.
- **Tools call the db layer directly** (`saveWorkout`, `listWorkoutSummaries`, `getWorkoutDetail`, `getExerciseHistoryBefore`, `getLastPerformance`, `deleteWorkout`, `updateWorkout`, `getWeightUnit`/`setWeightUnit`) — *not* the Server Actions, which require Clerk `requireUserId()` and won't run headless. Validation reuses `parseWorkoutInput` (`src/lib/workout-input.ts`).
- **`userId` resolution (POC)**: optional `userId` tool argument, falling back to `process.env.MCP_DEV_USER_ID`, so "add my workout" needs no id.
- **Public access**: add `/api/mcp(.*)` to `isPublicRoute` in `src/proxy.ts` so Clerk doesn't gate it.
- **Tool schemas**: zod, mirroring `WorkoutInput` (exercises[] with `{ wgerExerciseId, name, category? }` and sets[] `{ reps, weight }`); weights interpreted in the user's unit and stored as kg via the existing conversion path.

**Technical Risks**
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `mcp-handler` incompatible with Next 16 / Fluid Compute | M | Verify package + version during `/prp-plan`; fall back to a thin hand-rolled Streamable HTTP handler on `@modelcontextprotocol/sdk` if needed |
| Public unauthenticated write endpoint (data tampering) | H (by design) | Accepted for POC; documented loudly as not production-safe; revisit with auth before any real use |
| Agent sends malformed/garbage workout payloads | M | Reuse `parseWorkoutInput` strict validation; return structured tool errors, never 500s |
| Wrong `userId` → data written to the wrong account | M | Default to `MCP_DEV_USER_ID`; echo the resolved user back in tool results so the agent can confirm |

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
| 1 | MCP endpoint scaffold | `mcp-handler` route at `/api/mcp`, public-route exemption, a `ping`/`whoami` tool, connectable + tool listing | complete | - | - | [plan](../plans/completed/mcp-endpoint-scaffold.plan.md) · [report](../reports/mcp-endpoint-scaffold-report.md) |
| 2 | Read tools | `list_workouts`, `get_workout`, `search_exercises`, `get_exercise_history`/`last_performance`, `get_weight_unit` | complete | with 3 | 1 | [plan](../plans/completed/mcp-read-tools.plan.md) · [report](../reports/mcp-read-tools-report.md) |
| 3 | Write tools | `create_workout` (validate + persist), `set_weight_unit`; then `update_workout`/`delete_workout` | pending | with 2 | 1 | - |
| 4 | Ergonomics + connection doc | `userId` env/arg resolution polish, structured tool errors, optional `workout://{id}` resource, README/skill on connecting an MCP client | pending | - | 2, 3 | - |

### Phase Details

**Phase 1: MCP endpoint scaffold**
- **Goal**: A live, connectable MCP server inside the app.
- **Scope**: Add `mcp-handler` (verify vs Next 16); `app/api/mcp/[transport]/route.ts`; register a trivial `ping`/`whoami` tool; exempt `/api/mcp(.*)` from Clerk in `src/proxy.ts`.
- **Success signal**: An MCP client connects to `/api/mcp` and lists the `ping` tool; calling it returns successfully (locally and on the deployed URL).

**Phase 2: Read tools**
- **Goal**: An agent can see a user's training and find exercises.
- **Scope**: Tools wrapping `listWorkoutSummaries`, `getWorkoutDetail`, `searchExercises`, `getExerciseHistoryBefore`/`getLastPerformance`, `getWeightUnit`; zod arg schemas; weights rendered in the user's unit.
- **Success signal**: Agent retrieves accurate history and catalog matches for a given user.

**Phase 3: Write tools**
- **Goal**: The headline "add my workout for me" capability.
- **Scope**: `create_workout` (reuse `parseWorkoutInput` → `saveWorkout`), `set_weight_unit`, then `update_workout`/`delete_workout`; `userId` from arg or `MCP_DEV_USER_ID`.
- **Success signal**: A tool call inserts a multi-exercise workout; the row tree (workout→exercises→sets) is correct in Postgres.

**Phase 4: Ergonomics + connection doc**
- **Goal**: Make it pleasant to drive and easy to connect.
- **Scope**: Structured tool errors, resolved-user echo, optional `workout://{id}` resource, and a short doc/skill describing how to point an MCP client (e.g. Claude remote MCP) at the endpoint.
- **Success signal**: A fresh agent can connect and complete a read→create→read loop using only the doc.

### Parallelism Notes
Phase 1 is foundational (transport + access). Phases 2 (read) and 3 (write) touch independent tool sets over the same data layer and can be built concurrently once the endpoint exists. Phase 4 polishes after both tool sets land.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Server location | In-app Next route handler | Separate stdio/HTTP service | Reuses db client + wger cache, deploys with the app, reachable as remote MCP |
| Transport | Streamable HTTP via `mcp-handler` | stdio binary | Works with remote MCP clients against the live URL; no separate process |
| Tool target | `src/db/*` data layer directly | The Clerk-gated Server Actions | Actions require `requireUserId()`; the db layer takes `userId` and runs headless |
| Auth | None (public endpoint) | Clerk / token | Explicit POC decision — feature test only |
| `userId` source | Tool arg, env fallback `MCP_DEV_USER_ID` | Required arg only | "add my workout" should need no id during dogfooding |

## Research Summary

**Market Context**
Exposing app capabilities to agents via MCP is the current idiomatic pattern (Anthropic MCP; Vercel ships a Next.js MCP adapter and promotes in-app MCP route handlers on Fluid Compute). Wrapping an existing service/data layer as MCP tools — rather than rebuilding logic — is the established approach.

**Technical Context**
- Data layer is `userId`-parameterized and headless-ready: `src/db/workouts.ts` (`saveWorkout`, `listWorkoutSummaries`, `getWorkoutDetail`, `getExerciseHistoryBefore`, `getLastPerformance`, `updateWorkout`, `deleteWorkout`), `src/db/preferences.ts` (`getWeightUnit`/`setWeightUnit`).
- Validation exists: `parseWorkoutInput` + `WorkoutInput`/`ExerciseInput`/`SetInput` (`src/lib/workout-input.ts`).
- Catalog: `searchExercises`/`getAllExercises` (`src/lib/wger.ts`, Redis-cached).
- Server Actions (`src/app/workout/actions.ts`, `src/app/actions.ts`) are Clerk-gated → not the integration point.
- Middleware (`src/proxy.ts`) gates all non-public routes incl. `/api/*` → needs an explicit public exemption for `/api/mcp`.
- Stack: Next 16.2.9 (App Router, Turbopack), Drizzle + Supabase, no MCP deps yet.

---

*Generated: 2026-06-15*
*Status: DRAFT - needs validation*
