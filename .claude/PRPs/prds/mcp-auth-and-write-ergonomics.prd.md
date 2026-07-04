# MCP Auth & Write Ergonomics

## Problem Statement
The MCP agent server works, but it's a single-user POC: the endpoint is public and unauthenticated, and every call acts as one `MCP_DEV_USER_ID`. Anyone who reaches the URL can read and write that user's training. It can't be safely used as *you*, signed in, and it can't serve more than one person. Separately, the write surface has sharp edges: you can't log yesterday's session (workouts are always stamped `now()`), edits are full-replace only, and a malformed workout id returns an opaque `"MCP tool failed"` instead of a clear "not found".

## Evidence
- The endpoint is public by design (`src/proxy.ts` exempts `/api/mcp`; `resolveUserId` falls back to `process.env.MCP_DEV_USER_ID`). The prior PRD (`mcp-agent-server.prd.md`) listed auth as an explicit non-goal — that decision is now being reversed for real use.
- Direct user signal (this session): *"lets add auth and mcp sign up or sign in and install for us"*, *"should be able to backdate a workout"*, *"should also spike on a partial edit endpoint"*, *"should return not found instead of tool failed"*.
- Confirmed in schema: `workouts.started_at` is `defaultNow().notNull()` and `saveWorkout` never sets it → no backdating. `update_workout` deletes+reinserts all children → full replace only. A non-UUID id hits a Postgres uuid-cast error that `errorResult` genericizes.

## Proposed Solution
Authenticate the MCP endpoint with **Clerk acting as the OAuth authorization server**, using `mcp-handler`'s `withMcpAuth` seam plus `@clerk/mcp-tools`. MCP clients (Claude included) perform OAuth 2.1 sign-in/up with Dynamic Client Registration; the verified Clerk user id flows to each tool via `authInfo.extra.userId`, replacing the `MCP_DEV_USER_ID` default (kept only as a dev fallback). On top of that authenticated base, close the write-ergonomics gaps: optional **backdating** on create/update, a **partial-edit** capability (spike first, then implement the chosen shape), and a **not-found** result for missing/malformed ids instead of the generic error.

## Key Hypothesis
We believe **authenticating the MCP server with Clerk OAuth and tightening the write surface** will let a lifter **safely use the agent against their own real account and edit history precisely**.
We'll know we're right when **a signed-out MCP client is challenged, completes Clerk OAuth sign-in, and every tool acts as the authenticated user with no env default** — and when an agent can **backdate a workout, patch a single set without resending the whole workout, and gets a clear "not found" for a bad id.**

## What We're NOT Building
- **Our own OAuth/identity server** — Clerk is the authorization server; we implement only the resource-server side (metadata + token verification).
- **Per-user rate limiting, quotas, audit logging** — still deferred; auth is the prerequisite, these come later.
- **Multi-tenant org/team scoping** — single user per token; no orgs.
- **Client-credentials / machine-to-machine MCP access** — interactive user-consent OAuth only (Clerk doesn't support client_credentials for this anyway).
- **A bespoke set-level data model change** — partial edit reuses the existing workout→exercise→set schema; no new tables.
- **Removing `MCP_DEV_USER_ID` entirely** — it stays as a non-production dev fallback (off in prod once auth lands).

## Success Metrics
| Metric | Target | How Measured |
|--------|--------|--------------|
| Auth required in prod | Unauthenticated call → `401` + `WWW-Authenticate`; authenticated call resolves the token's user | `curl` the prod endpoint with/without a token |
| Real sign-in works | Claude (or another MCP client) completes Clerk OAuth and lists/calls tools as the signed-in user | Manual: add the connector, sign in, run `whoami` → returns the Clerk user from the token, not the env default |
| Backdating | `create_workout`/`update_workout` accept a date and persist it as `started_at` | Create with an explicit past date, assert the row's `started_at` |
| Partial edit | A single set/exercise can be changed without resending the whole workout | Call the partial-edit tool, assert only the targeted row changed |
| Clear not-found | A missing or malformed id returns a surfaced "not found" (`ToolError`), never the generic `"MCP tool failed"` | Call `get_workout`/`update`/`delete` with a bad id |

## Open Questions
- [x] **Clerk dashboard prerequisite** — ✅ DONE: OAuth app created on the dev instance (`proud-grizzly-7`), **DCR ON**, Public/PKCE, Consent ON, scopes `openid profile email`, redirect URIs registered (claude.ai/.com + loopback). Client creds staged in `.env.local` + Vercel prod (`CLERK_OAUTH_CLIENT_ID/SECRET`). See plan's "Clerk OAuth — CONFIGURED".
- [ ] **`@clerk/mcp-tools@0.5.0` ↔ `@clerk/nextjs@7.5.2` / Next 16** compatibility — verify at plan/spike time; fall back to a hand-rolled `verifyToken` calling `auth({ acceptsToken: 'oauth_token' })` if the helper lags.
- [ ] **`.well-known` routes vs `proxy.ts`** — the protected-resource + auth-server metadata routes must be public; confirm they're exempted and that the Next 16 `proxy` middleware quirk we already hit doesn't interfere.
- [ ] **Partial-edit shape** — granular tools (`add_set`/`update_set`/`remove_set`, `add_exercise`/…) vs one `patch_workout` merge tool. Resolved by the spike.
- [ ] **Backdate field name & bounds** — `startedAt` ISO string vs `date`; reject future dates? Allow date-only vs full timestamp?

---

## Users & Context

**Primary User**
- **Who**: The builder/lifter dogfooding the app, now wanting to use it as their authenticated self rather than an env default.
- **Current behavior**: Talks to an agent connected to the public POC endpoint acting as one hardcoded user.
- **Trigger**: Wanting real, safe, per-user use — and precise edits (fix a set, log a missed past session).
- **Success state**: Signs in once from the MCP client; thereafter the agent reads/writes their own data, can backdate and patch, and errors are legible.

**Job to Be Done**
When I connect an agent to my tracker, I want it authenticated as me and able to edit my history precisely, so I can trust it with my real training data.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | `withMcpAuth` wrapping `/api/mcp`; unauthenticated → 401 + `WWW-Authenticate` | The gate; nothing is authenticated without it |
| Must | `/.well-known/oauth-protected-resource` (+ auth-server metadata) route handlers, public | Spec-required discovery for the client's OAuth flow |
| Must | Clerk token verification (`verifyClerkToken` / `auth({acceptsToken:'oauth_token'})`) → `authInfo.extra.userId` | Ties each request to a real Clerk user |
| Must | Thread `authInfo` into tools; `resolveUserId` prefers the authenticated id, env only as dev fallback | Removes the single-user default |
| Must | Not-found (or invalid-id) `ToolError` for missing/malformed ids across get/update/delete + resource | Direct user ask; legible errors |
| Should | Backdating: optional date on `create_workout` / `update_workout` persisted to `started_at` | Direct user ask; log past sessions |
| Should | Partial edit: spike the shape, then implement chosen granular/patch tool(s) | Direct user ask; precise edits without full replace |
| Could | `set_weight_unit` and reads unchanged but now per authenticated user | Falls out of the auth swap |
| Won't | Orgs/teams, rate limiting, M2M tokens, new schema | Out of scope per above |

### MVP Scope
Prod `/api/mcp` requires a valid Clerk OAuth token; an MCP client signs in via Clerk and all tools act as that user (verified by `whoami`). `MCP_DEV_USER_ID` is disabled in prod. The not-found fix ships with it. Backdating and partial-edit land in the same combined effort, partial-edit gated behind a short spike.

### User Flow (auth)
Add connector → client `POST`s without token → server `401 + WWW-Authenticate (resource_metadata=…)` → client fetches protected-resource metadata → discovers Clerk AS → DCR + PKCE → browser Clerk sign-in/consent → token exchange (audience-bound) → client retries with `Authorization: Bearer` → server `verifyToken` → `authInfo.extra.userId` → tools act as that user.

---

## Technical Approach

**Feasibility**: HIGH — both `mcp-handler` (`withMcpAuth`, installed `1.1.0`) and Clerk (`@clerk/mcp-tools`, official MCP support) provide the pieces; Claude clients speak the full OAuth+DCR flow.

**Architecture (from research, see Research Summary)**
- **Metadata routes** (public, exempt in `proxy.ts`):
  - `src/app/.well-known/oauth-protected-resource/mcp/route.ts` → `protectedResourceHandlerClerk(...)` + CORS OPTIONS.
  - `src/app/.well-known/oauth-authorization-server/route.ts` → `authServerMetadataHandlerClerk()` + CORS OPTIONS.
- **Route wrap** (`src/app/api/[transport]/route.ts`): `withMcpAuth(handler, verifyToken, { required: true, resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp' })`, where `verifyToken` calls `verifyClerkToken(await auth({ acceptsToken: 'oauth_token' }), token)`.
- **User resolution**: the MCP SDK passes `extra` (incl. `authInfo`) to each tool callback. Thread it into `tools.ts`/`read-tools.ts`/`write-tools.ts`/`resources.ts`; `resolveUserId(extra)` prefers `extra.authInfo.extra.userId`, then the `userId` arg (dev), then `MCP_DEV_USER_ID` (dev only).
- **Backdate**: extend `WorkoutInput` (and the create/update zod schemas) with an optional `startedAt`; pass to `saveWorkout`/`updateWorkout` (`.values({ ..., startedAt })`). Validate it's a real date, not absurd.
- **Not-found**: at the tool boundary, validate the id (UUID shape) and/or catch the DB cast error, returning `ToolError("Workout <id> not found …")` instead of letting it genericize.
- **Partial edit (spike)**: evaluate (a) granular tools (`add_set`/`update_set`/`remove_set`, exercise-level equivalents) vs (b) a single `patch_workout` that merges a partial tree; pick one, implement against the existing schema (set `setNumber`/`position` reindexing rules defined in the spike).

**Technical Risks**
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `@clerk/mcp-tools` vs `@clerk/nextjs@7.5.2`/Next 16 incompatibility | M | Verify in the plan/spike; fall back to hand-rolled `verifyToken` over `auth({acceptsToken:'oauth_token'})` |
| `.well-known` routes gated by Clerk middleware (`proxy.ts`) | M | Add explicit public exemptions; reuse the lesson from the recent middleware fix |
| Threading `authInfo` touches every tool | M | Centralize in `resolveUserId(extra)`; one signature change rippled through registrations |
| Backdate lets data drift (future dates, wrong "last performance") | L | Validate/bound the date; decide future-date policy in the spike |
| Claude DCR loopback quirks | L | Document connector setup; pre-registered client id fallback |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  This PRD is implemented as ONE combined plan (per the owner's choice); phases
  below are the logical units the plan sequences, not separate plans.
-->

| # | Phase | Description | Status | Depends | PRP Plan |
|---|-------|-------------|--------|---------|----------|
| 5 | MCP authentication (Clerk OAuth) | `.well-known` routes, `withMcpAuth` + `verifyClerkToken`, thread `authInfo.userId`, demote `MCP_DEV_USER_ID` | code-complete (prod env cutover + live OAuth E2E pending owner) | dashboard DCR toggle | [plan](../plans/completed/mcp-auth-and-write-ergonomics.plan.md) |
| 6 | Not-found over generic error | UUID/id validation → `ToolError` not-found across get/update/delete + resource | complete | - | [plan](../plans/completed/mcp-auth-and-write-ergonomics.plan.md) |
| 7 | Backdate workouts | optional `startedAt` on create/update, validated, persisted to `started_at` | complete | - | [plan](../plans/completed/mcp-auth-and-write-ergonomics.plan.md) |
| 8 | Partial edit (spike → implement) | granular tools (update_set/add_set/remove_set/set_workout_meta) against existing schema | complete | 5 (acts per authed user) | [plan](../plans/completed/mcp-auth-and-write-ergonomics.plan.md) |

### Phase Details

**Phase 5: MCP authentication (Clerk OAuth)**
- **Goal**: Every prod MCP call is tied to a real Clerk user via OAuth; no env default.
- **Scope**: metadata routes; `withMcpAuth` + Clerk token verify; `authInfo.extra.userId` threaded into tools; `resolveUserId` precedence updated; `proxy.ts` exemptions; disable `MCP_DEV_USER_ID` in prod.
- **Success signal**: unauthenticated `401`; an MCP client completes Clerk sign-in and `whoami` returns the token's user.

**Phase 6: Not-found over generic error**
- **Goal**: Missing/malformed ids return a surfaced "not found", never the generic failure.
- **Scope**: validate id at the boundary (and/or catch the uuid cast error) in `get_workout`, `update_workout`, `delete_workout`, and the `workout://{id}` resource.
- **Success signal**: a bad id → `ToolError`/not-found message; a valid-but-absent id → not-found; no `"MCP tool failed"`.

**Phase 7: Backdate workouts**
- **Goal**: Log a session with its real date.
- **Scope**: optional `startedAt` through `WorkoutInput` + create/update zod schemas + `saveWorkout`/`updateWorkout`; validation/bounds.
- **Success signal**: create with a past date → row's `started_at` matches; reads/`get_last_performance` order correctly.

**Phase 8: Partial edit (spike → implement)**
- **Goal**: Precise edits without a full replace.
- **Scope**: spike the shape (granular set/exercise tools vs `patch_workout`); implement the chosen approach with clear reindexing rules; tests.
- **Success signal**: change one set; only that set's row changes; the rest of the workout is untouched.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Auth model | Full Clerk OAuth for MCP (interactive sign-in/up) | Bearer-token bridge; bearer-only | Owner wants real sign-in/up; Clerk + mcp-handler support it first-class |
| Authorization server | Clerk | Roll our own; Vercel SSO | App already uses Clerk; `@clerk/mcp-tools` is purpose-built |
| Token verify seam | `withMcpAuth` + `verifyClerkToken` | Hand-rolled middleware | Installed `mcp-handler@1.1.0` provides it; Clerk helper matches |
| `MCP_DEV_USER_ID` | Demote to dev-only fallback (off in prod) | Remove entirely | Keeps local dev frictionless |
| Delivery | One combined PRD → one plan | Per-item PRDs/plans | Owner's choice; shared `resolveUserId`/write-tools seams |
| Partial edit | Spike then implement | Build granular tools blind | Shape (granular vs patch) is a real design fork |

## Research Summary

**Auth (verified, early 2026)** — `mcp-handler@1.1.0` exports `withMcpAuth(handler, verifyToken, opts)`, `protectedResourceHandler`, `metadataCorsOptionsRequestHandler`, `generateProtectedResourceMetadata`; `verifyToken` returns an `AuthInfo` whose `extra` carries `userId`, and `undefined` triggers the spec `401 + WWW-Authenticate` challenge. Clerk has first-class MCP support via `@clerk/mcp-tools` (`verifyClerkToken`, `protectedResourceHandlerClerk`, `authServerMetadataHandlerClerk`) acting as the OAuth authorization server, gated on enabling an OAuth application with Dynamic Client Registration. The MCP authorization spec requires the resource server to expose RFC 9728 protected-resource metadata, issue a `WWW-Authenticate` challenge, and validate token audience (RFC 8707). Claude (claude.ai + Claude Code) supports the full OAuth 2.1 discovery + DCR/PKCE flow for remote MCP (Claude Code uses RFC 8252 loopback redirects). Sources: mcp-handler AUTHORIZATION.md + installed `1.1.0` types; Clerk "Build an MCP server (Next.js)" + `@clerk/mcp-tools`; MCP spec draft authorization; Claude custom-connector + Claude Code MCP docs.

**Write ergonomics (verified in repo)** — `workouts.started_at` `defaultNow().notNull()` with no setter (backdate gap); `updateWorkout` deletes+reinserts children (full replace); non-UUID id → Postgres cast error genericized by `errorResult`.

---

*Generated: 2026-06-28*
*Status: DRAFT — needs owner review, then `/prp-plan`*
