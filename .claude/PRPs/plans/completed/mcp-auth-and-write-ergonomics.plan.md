# Plan: MCP Auth & Write Ergonomics (PRD Phases 5–8)

## Summary
Authenticate the MCP endpoint with Clerk OAuth (`withMcpAuth` + `@clerk/mcp-tools`) so every call acts as a real signed-in user instead of the `MCP_DEV_USER_ID` default, and close three write-surface gaps: legible **not-found** for bad ids, **backdating**, and **partial edits**. Delivered as one plan but **implemented as four stacked PRs** (one per phase) to stay reviewable.

## User Story
As a lifter connecting an agent to my tracker, I want it authenticated as me via sign-in and able to edit history precisely (backdate, patch a set, get clear errors), so I can trust it with my real data.

## Problem → Solution
Public single-user endpoint + full-replace-only writes + `now()`-stamped workouts + opaque errors → Clerk-OAuth-gated per-user endpoint + partial edits + backdating + surfaced not-found.

## Metadata
- **Complexity**: Large (XL overall; auth is the bulk)
- **Source PRD**: `.claude/PRPs/prds/mcp-auth-and-write-ergonomics.prd.md`
- **PRD Phases**: 5 (auth), 6 (not-found), 7 (backdate), 8 (partial-edit spike→impl)
- **Estimated Files**: ~16 (4 created, ~12 updated)
- **Delivery**: 4 stacked PRs, recommended order **6 → 7 → 5 → 8** (small/isolated first; auth's signature ripple before partial-edit's new tools)

---

## UX Design

### Before
```
MCP client ──(no auth, public)──▶ /api/mcp   acts as MCP_DEV_USER_ID
  • bad id → "MCP tool failed"
  • update = full replace; no backdate
```

### After
```
MCP client ──401 → Clerk OAuth sign-in/up → Bearer token──▶ /api/mcp   acts as the token's user
  • bad id → "Workout <id> not found"
  • create/update accept a date (backdate); patch a single set without resending the workout
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Connecting | Paste URL, public | Sign in via Clerk OAuth in the client | DCR; no token pasting |
| User identity | `MCP_DEV_USER_ID` | Authenticated Clerk user from the token | `whoami` proves it |
| Bad/edit id | "MCP tool failed" | "Workout … not found" | Phase 6 |
| Logging a past session | impossible | `startedAt` arg | Phase 7 |
| Fixing one set | resend whole workout | targeted patch tool | Phase 8 |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/app/api/[transport]/route.ts` | all | Where `withMcpAuth` wraps the handler |
| P0 | `src/lib/mcp/resolve-user.ts` | all | The seam to thread authenticated id through; precedence change |
| P0 | `src/lib/mcp/tools.ts` / `read-tools.ts` / `write-tools.ts` / `resources.ts` | all | Every tool/resource callback gains `extra`; `resolveUserId(extra, userId)` |
| P0 | `src/lib/mcp/write-tools.ts` | 88-170 | create/update/delete handlers — backdate + not-found land here |
| P0 | `src/db/workouts.ts` | 136-231 | `createWorkout`/`saveWorkout`/`updateWorkout`/`deleteWorkout`/`getWorkoutDetail` contracts; `started_at` insertion point |
| P0 | `src/lib/workout-input.ts` | all | `WorkoutInput` + `parseWorkoutInput` — add optional `startedAt` |
| P1 | `src/db/schema.ts` | 13-44 | `workouts.started_at` (`defaultNow().notNull()`); `sets`/`workoutExercises` columns for partial edit |
| P1 | `src/proxy.ts` | all | Add `.well-known/*` to `isPublicRoute`; the runtime quirk we fixed |
| P1 | `src/app/api/exercises/route.ts` | 1-25 | Next route-handler + `auth()` pattern to mirror for `.well-known` routes |
| P1 | `src/lib/mcp/resolve-user.test.ts` | all | Test scaffold to extend for `resolveUserId(extra, …)` |
| P1 | `src/lib/mcp/write-tools.test.ts` | 1-56 | `vi.mock` + `fakeServer` + handler-invoke pattern; handlers will now receive `extra` |
| P2 | `src/lib/mcp/errors.ts` / `result.ts` | all | `ToolError`/`errorResult` split reused by not-found + auth errors |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| `withMcpAuth` | installed `mcp-handler@1.1.0` `dist/index.d.ts:128` | `withMcpAuth(handler, verifyToken, { required, resourceMetadataPath, requiredScopes, resourceUrl })`; `verifyToken(req, bearer?) → AuthInfo \| undefined`; `undefined` ⇒ spec 401 |
| `AuthInfo` | `@modelcontextprotocol/sdk/.../auth/types.d.ts` | `{ token, clientId, scopes, expiresAt?, resource?, extra? }`; stash `userId` in `extra` |
| Tool/resource `extra` | SDK `mcp.d.ts:250-324`, `protocol.d.ts:181` | Callback `(args, extra)`; `extra.authInfo?: AuthInfo` |
| `@clerk/mcp-tools` | npm `0.5.0` (NOT installed) | `verifyClerkToken`, `protectedResourceHandlerClerk`, `authServerMetadataHandlerClerk`, `metadataCorsOptionsRequestHandler` (from `@clerk/mcp-tools/next`) |
| Clerk token verify | Clerk MCP guide | `verifyClerkToken(await auth({ acceptsToken: 'oauth_token' }), token)` → user in `authInfo.extra.userId` |
| Clerk dashboard | `dashboard.clerk.com/~/oauth-applications` | ✅ **DONE** — OAuth app created + **Dynamic Client Registration ON** (see config block below) |

KEY_INSIGHT: The authenticated id flows `verifyToken → AuthInfo.extra.userId → tool extra.authInfo.extra.userId`. APPLIES_TO: `resolveUserId`. GOTCHA: when authenticated, the id MUST come from the token, never a client-supplied `userId` arg (no impersonation).

### Clerk OAuth — CONFIGURED (dev instance) ✅
The dashboard prerequisite is complete. Concrete config for Phase 5 (secret values live in env, **not** in this tracked doc):

- **Clerk instance** (dev): `proud-grizzly-7.clerk.accounts.dev`
- **Discovery / endpoints** (Clerk-issued, public):
  - OIDC config: `https://proud-grizzly-7.clerk.accounts.dev/.well-known/openid-configuration`
  - authorize: `…/oauth/authorize` · token: `…/oauth/token` · userinfo: `…/oauth/userinfo` · introspection: `…/oauth/token_info`
- **OAuth app**: Public (PKCE/S256), Consent screen ON (force-enabled by DCR), **Dynamic Client Registration ON**
- **Scopes granted**: `openid profile email`
- **Redirect URIs registered**: `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`, `http://localhost/callback`, `http://127.0.0.1/callback`
- **Client credentials**: stored in `.env.local` + Vercel **production** as `CLERK_OAUTH_CLIENT_ID` / `CLERK_OAUTH_CLIENT_SECRET`. NOTE: server-side token verification uses `CLERK_SECRET_KEY` (already set); these client creds are for the pre-registered/non-DCR fallback or `/oauth/token_info` introspection — **the server does not need the secret for the DCR flow**.
- **Implication for Task 5.5**: advertise `scopes_supported: ['openid','profile','email']` so app + metadata agree.
- **Remaining owner action**: at prod cutover only — `vercel env rm MCP_DEV_USER_ID production` (Task 5.7).

---

## Patterns to Mirror

### NAMING_CONVENTION / REGISTER
```ts
// SOURCE: src/lib/mcp/write-tools.ts:88
async ({ name, exercises, unit, userId }) => {
  try { const resolved = resolveUserId(userId); /* ... */ }
  catch (error: unknown) { return errorResult(error) }
}
// AFTER auth: handler gains `extra`, resolveUserId takes it:
async ({ name, exercises, unit, userId }, extra) => {
  try { const resolved = resolveUserId(extra, userId); /* ... */ }
  catch (error: unknown) { return errorResult(error) }
}
```

### LEAK-SAFE ERROR SPLIT
```ts
// SOURCE: src/lib/mcp/result.ts:23-29 — ToolError surfaces; else generic + log
if (error instanceof ToolError) return { content:[{type:'text',text:error.message}], isError:true }
console.error('MCP tool error:', error); return { content:[{type:'text',text:'MCP tool failed'}], isError:true }
```

### ROUTE HANDLER (for .well-known)
```ts
// SOURCE: src/app/api/exercises/route.ts:1-22 — Next route handler exporting GET
import { NextResponse } from 'next/server'
export async function GET(request: Request): Promise<NextResponse> { /* ... */ }
```

### DB INSERT (backdate point)
```ts
// SOURCE: src/db/workouts.ts:189-192
const [workout] = await tx.insert(workouts).values({ userId, name: input.name }).returning({ id: workouts.id })
// AFTER: .values({ userId, name: input.name, ...(input.startedAt ? { startedAt: input.startedAt } : {}) })
```

### VALIDATION (mirror for startedAt + backdate)
```ts
// SOURCE: src/lib/workout-input.ts:50-57,110-121 — field parsers throw plain Error; parseWorkoutInput composes
function parseName(raw: unknown): string | undefined { /* typeof + trim + bound */ }
```

### TEST_STRUCTURE
```ts
// SOURCE: src/lib/mcp/write-tools.test.ts:4-56 — vi.mock db, fakeServer records registerTool, invoke handler directly
// Handlers now take (args, extra): tests pass a fake extra, e.g. { authInfo: { extra: { userId: 'user_tok' } } }
```

---

## Files to Change

| File | Action | Phase | Justification |
|---|---|---|---|
| `src/lib/mcp/resolve-user.ts` | UPDATE | 5 | `resolveUserId(extra, argUserId?)` — prefer authed id |
| `src/lib/mcp/resolve-user.test.ts` | UPDATE | 5 | cover authed-id precedence + dev fallbacks |
| `src/lib/mcp/tools.ts` | UPDATE | 5 | `whoami` handler takes `extra`; pass through |
| `src/lib/mcp/read-tools.ts` | UPDATE | 5 | every read handler `(args, extra)` → `resolveUserId(extra, userId)` |
| `src/lib/mcp/write-tools.ts` | UPDATE | 5,6,7 | auth thread + not-found guard + backdate arg |
| `src/lib/mcp/resources.ts` | UPDATE | 5,6 | resource read uses `extra` for user; not-found guard |
| `src/app/api/[transport]/route.ts` | UPDATE | 5 | wrap with `withMcpAuth` + `verifyToken` |
| `src/app/.well-known/oauth-protected-resource/mcp/route.ts` | CREATE | 5 | protected-resource metadata |
| `src/app/.well-known/oauth-authorization-server/route.ts` | CREATE | 5 | auth-server metadata |
| `src/proxy.ts` | UPDATE | 5 | exempt `/.well-known/*` (+ keep `/api/mcp`) |
| `src/proxy.test.ts` | UPDATE | 5 | assert `.well-known` is public |
| `src/lib/mcp/workout-id.ts` | CREATE | 6 | uuid-shape guard → not-found |
| `src/lib/mcp/workout-id.test.ts` | CREATE | 6 | guard unit tests |
| `src/lib/workout-input.ts` | UPDATE | 7 | optional `startedAt` on `WorkoutInput` + `parseWorkoutInput` |
| `src/lib/workout-input.test.ts` | UPDATE | 7 | startedAt parse/validate/reject-future |
| `src/db/workouts.ts` | UPDATE | 7,8 | persist `startedAt`; partial-edit data ops |
| `src/lib/mcp/patch-tools.ts` (+ test) | CREATE | 8 | partial-edit tools (shape per spike) |
| `package.json` | UPDATE | 5 | add `@clerk/mcp-tools` |
| `.claude/PRPs/prds/mcp-auth-and-write-ergonomics.prd.md` | UPDATE | all | phase statuses |

## NOT Building
- Our own OAuth server; orgs/teams; rate limiting; M2M/client-credentials; new tables.
- Removing `MCP_DEV_USER_ID` (kept as dev fallback; **off in prod** via unset env).
- Pasting static tokens (full OAuth only).

---

## Step-by-Step Tasks

> Each phase = its own PR/commit. Run the per-phase VALIDATE before moving on.

### ── PHASE 6: Not-found over generic error (smallest, first) ──

### Task 6.1: uuid-shape guard
- **ACTION**: New `src/lib/mcp/workout-id.ts` exporting `assertWorkoutIdShape(id: string): void` that throws `ToolError(\`Workout ${id} not found for this user\`)` when `id` isn't a v4-ish UUID.
- **IMPLEMENT**:
  ```ts
  import { ToolError } from './errors'
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  /** A malformed (non-UUID) workout id can't match any row; surface a clean
   *  not-found rather than letting the Postgres uuid cast error genericize. */
  export function assertWorkoutIdShape(id: string): void {
    if (!UUID_RE.test(id)) throw new ToolError(`Workout ${id} not found`)
  }
  ```
- **MIRROR**: LEAK-SAFE split (throw `ToolError`, caught by each handler's existing try/catch → surfaced).
- **VALIDATE**: `npx vitest run src/lib/mcp/workout-id.test.ts` (Task 6.2) — RED first.

### Task 6.2: tests for the guard (TDD)
- **ACTION**: `src/lib/mcp/workout-id.test.ts`: valid UUID → no throw; `'abc'`/`'8c2f0cc9'` (truncated) → `ToolError` `/not found/`; empty → throw.
- **MIRROR**: `resolve-user.test.ts` AAA style.
- **VALIDATE**: RED (no impl) → GREEN after 6.1.

### Task 6.3: call the guard in get/update/delete + resource
- **ACTION**: In `get_workout` (read-tools.ts:59), `update_workout` & `delete_workout` (write-tools.ts:115,139), and `resources.ts` read callback, call `assertWorkoutIdShape(id)` **inside the try**, before the DB call.
- **IMPLEMENT**: e.g. write-tools `update_workout`: `const resolved = resolveUserId(...); assertWorkoutIdShape(id); const result = await updateWorkout(...)`.
- **GOTCHA**: resource throws (no `isError`); the guard throws `ToolError` which its catch re-throws verbatim — already correct.
- **VALIDATE**: add a write-tools test: `update_workout({id:'not-a-uuid', ...})` → `isError` `/not found/`, `updateWorkout` not called. `npx vitest run src/lib/mcp`.

### ── PHASE 7: Backdate workouts ──

### Task 7.1: `startedAt` on the input contract (TDD)
- **ACTION**: Add optional `startedAt?: Date` to `WorkoutInput` (`workout-input.ts:31`) and parse it in `parseWorkoutInput`.
- **IMPLEMENT**: `parseStartedAt(raw: unknown): Date | undefined` — accept an ISO string or Date; `new Date(x)`; throw on `Number.isNaN(d.getTime())`; **reject future dates** (`d.getTime() > Date.now()` → "workout date can't be in the future"). Add to the returned object only when present.
  ```ts
  return name === undefined
    ? { exercises, ...(startedAt && { startedAt }) }
    : { name, exercises, ...(startedAt && { startedAt }) }
  ```
- **MIRROR**: `parseName`/`parseSet` (workout-input.ts:50,60).
- **GOTCHA**: `parseWorkoutInput` takes `unknown`; the MCP layer passes a Date already converted from the tool's ISO string arg (see 7.3). Bound: future-date reject is the policy decision (PRD open Q → resolved: reject future).
- **VALIDATE**: extend `workout-input.test.ts` — valid past date kept; future → throws `/future/`; bad string → throws; absent → omitted. RED→GREEN.

### Task 7.2: persist `startedAt` in the DB layer (TDD-via-integration)
- **ACTION**: `saveWorkout` and `updateWorkout` (workouts.ts:187,214) write `startedAt` when present.
- **IMPLEMENT**: insert `...(input.startedAt ? { startedAt: input.startedAt } : {})`; `updateWorkout`'s `.set({ name: input.name ?? null, ...(input.startedAt ? { startedAt: input.startedAt } : {}) })`.
- **GOTCHA**: omit the key when absent so the DB default (`now()`) still applies on create and the existing value is preserved on update.
- **VALIDATE**: covered by the MCP create test asserting `saveWorkout` called with `expect.objectContaining({ startedAt })`.

### Task 7.3: expose `startedAt` on create/update tools (TDD)
- **ACTION**: Add `startedAt: z.string().datetime().optional()` to the `create_workout`/`update_workout` `inputSchema` (write-tools.ts:81,107). Convert to `Date` and pass into the validated body.
- **IMPLEMENT**: in the handler, fold `startedAt` into the object handed to `validate(...)` — extend `RawWorkout` with `startedAt?: string`; in `toKgInput`/`validate`, pass `startedAt` through (string → `parseWorkoutInput` parses to Date). Simpler: convert in the handler: `validate({ name, exercises, startedAt }, basis)` and let `parseWorkoutInput` handle the string→Date+future check.
- **MIRROR**: existing `unit`/`userId` optional args (write-tools.ts:84-86).
- **GOTCHA**: keep `displayToKg` weight conversion unchanged; `startedAt` is orthogonal.
- **VALIDATE**: write-tools test — `create_workout({...BODY, startedAt:'2026-01-02T00:00:00.000Z'})` → `saveWorkout` called with that Date; future date → `isError` `/future/`.

### ── PHASE 5: MCP authentication (Clerk OAuth) — the big one ──

### Task 5.1: install `@clerk/mcp-tools` + verify compat
- **ACTION**: `npm i @clerk/mcp-tools`; confirm it imports under `@clerk/nextjs@7.5.2` / Next 16. If broken, fall back to hand-rolled `verifyToken` (Task 5.4 alt).
- **VALIDATE**: `npx tsc --noEmit` after wiring 5.4.

### Task 5.2: `resolveUserId(extra, argUserId?)` — authed-id precedence (TDD)
- **ACTION**: Change signature to take the tool `extra` first; read `extra?.authInfo?.extra?.userId`.
- **IMPLEMENT**:
  ```ts
  // Accept a minimal shape to stay test-friendly (avoids importing the SDK type into tests):
  type AuthCtx = { authInfo?: { extra?: Record<string, unknown> } }
  export function resolveUserId(extra?: AuthCtx, argUserId?: string): string {
    const authed = extra?.authInfo?.extra?.userId
    if (typeof authed === 'string' && authed.trim()) return authed   // token wins; no impersonation
    const fromArg = argUserId?.trim(); if (fromArg) return fromArg     // dev convenience
    const fromEnv = process.env.MCP_DEV_USER_ID?.trim(); if (fromEnv) return fromEnv
    throw new ToolError('No userId: authenticate, or set MCP_DEV_USER_ID (dev only).')
  }
  ```
- **MIRROR**: existing resolve-user.ts:13.
- **GOTCHA**: authed id takes precedence over the `userId` arg — security-critical. Keep arg/env strictly as dev fallbacks.
- **VALIDATE**: extend `resolve-user.test.ts` — authed id beats arg+env; no authed → arg → env → throw; whitespace authed ignored. RED→GREEN.

### Task 5.3: thread `extra` through every tool/resource
- **ACTION**: Update each handler to `(args, extra)` and call `resolveUserId(extra, userId)`: `whoami` (tools.ts:36), all of `read-tools.ts`, all of `write-tools.ts`, and `resources.ts` (read callback already gets `extra` as its 3rd param).
- **GOTCHA**: `search_exercises` has no user — leave it. The resource callback signature is `(uri, variables, extra)` — use `extra`.
- **VALIDATE**: `npx tsc --noEmit`; update tool tests to pass a fake `extra` (default `{}` → falls back to env, preserving existing assertions); add one test per surface that an `authInfo.extra.userId` is used and **overrides** a passed `userId` arg.

### Task 5.4: wrap the route with `withMcpAuth`
- **ACTION**: In `route.ts`, wrap `handler` with `withMcpAuth(handler, verifyToken, { required, resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp' })`.
- **IMPLEMENT**:
  ```ts
  import { createMcpHandler, withMcpAuth } from 'mcp-handler'
  import { verifyClerkToken } from '@clerk/mcp-tools/next'
  import { auth } from '@clerk/nextjs/server'
  const base = createMcpHandler(registerTools, { serverInfo: { name: 'workout-tracker', version: '0.1.0' } }, { basePath: '/api', maxDuration: 60 })
  const verifyToken = async (_req: Request, token?: string) =>
    token ? verifyClerkToken(await auth({ acceptsToken: 'oauth_token' }), token) : undefined
  const handler = withMcpAuth(base, verifyToken, {
    required: process.env.NODE_ENV === 'production',   // dev keeps MCP_DEV_USER_ID
    resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
  })
  export { handler as GET, handler as POST }
  ```
- **GOTCHA**: `required: true` means **no token → 401**; gating on prod keeps local dev usable via `MCP_DEV_USER_ID`. The authed user lands in `extra.authInfo.extra.userId` per the SDK.
- **VALIDATE**: `npx tsc --noEmit`; local prod build → unauthenticated `POST /api/mcp` returns 401 with `WWW-Authenticate`.

### Task 5.5: `.well-known` metadata routes (public)
- **ACTION**: Create the two route handlers using `@clerk/mcp-tools/next` helpers; export GET + CORS OPTIONS.
- **IMPLEMENT**: `protectedResourceHandlerClerk({ scopes_supported: ['openid','profile','email'] })` at `/.well-known/oauth-protected-resource/mcp/route.ts` (matches the granted app scopes); `authServerMetadataHandlerClerk()` at `/.well-known/oauth-authorization-server/route.ts`; `metadataCorsOptionsRequestHandler()` for OPTIONS.
- **MIRROR**: ROUTE HANDLER pattern (api/exercises/route.ts).
- **VALIDATE**: `curl` each `.well-known` path → 200 JSON metadata.

### Task 5.6: exempt `.well-known` in `proxy.ts` (TDD)
- **ACTION**: Add `'/.well-known/(.*)'` to `isPublicRoute` (keep `/api/mcp(.*)`).
- **MIRROR**: proxy.ts:3 matcher list.
- **VALIDATE**: extend `proxy.test.ts` — a `/.well-known/oauth-protected-resource/mcp` request is public (no redirect). `npx vitest run src/proxy.test.ts`.

### Task 5.7: prod env cutover
- **STATUS**: Clerk OAuth app + DCR + redirect URIs + scopes — ✅ DONE (see "Clerk OAuth — CONFIGURED"). `CLERK_OAUTH_CLIENT_ID/SECRET` already staged in `.env.local` + Vercel prod.
- **ACTION** (at cutover, after 5.1–5.6 land + deploy): remove `MCP_DEV_USER_ID` from Vercel **production** (`vercel env rm MCP_DEV_USER_ID production`) so prod relies solely on the token. Keep it in `.env.local` for dev.
- **VALIDATE**: post-deploy — unauthenticated prod call → 401; an MCP client signs in via Clerk; `whoami` returns the token's Clerk user.

### ── PHASE 8: Partial edit (spike → implement) ──

### Task 8.1: SPIKE — choose the shape
- **ACTION**: Evaluate two designs and pick one; record the decision in the plan/report.
  - **(A) Granular tools** (recommended default): `update_set`, `add_set`, `remove_set` (keyed by `workoutId` + exercise position/id + setNumber), plus `set_workout_meta` (rename + backdate). Maps cleanly to "fix set 3"; each tool is single-purpose and agent-legible.
  - **(B) `patch_workout`**: one tool taking a sparse tree; server merges. Fewer tools, more merge/reindex complexity and ambiguous semantics.
- **DECISION DEFAULT**: **(A) granular**, unless the spike surfaces a blocker. Rationale: clarity for the agent, smaller blast radius per call, simpler reindexing.
- **GOTCHA**: define reindex rules now — `setNumber` is 1-based contiguous per exercise; removing set N renumbers N+1.. ; `position` is 0-based per workout.
- **VALIDATE**: a short written decision (2–3 sentences) + the tool signatures below confirmed against `sets`/`workoutExercises` schema.

### Task 8.2: data-access ops for granular edits (TDD)
- **ACTION**: In `db/workouts.ts`, add user-scoped ops the tools need, each verifying ownership via a join to `workouts.userId`: `updateSet(userId, workoutId, exercisePosition, setNumber, {reps?,weight?})`, `addSet(...)`, `removeSet(...)` (+ renumber). Reuse the transaction style of `updateWorkout`.
- **MIRROR**: `updateWorkout` (workouts.ts:214) ownership-gate-via-returning; `insertWorkoutChildren` (143).
- **GOTCHA**: every op must filter by `userId` (module is the authz boundary); return null when not owned → tool surfaces not-found.
- **VALIDATE**: unit tests with mocked `db` asserting the scoping + renumber.

### Task 8.3: `patch-tools.ts` — register the granular tools (TDD)
- **ACTION**: New `src/lib/mcp/patch-tools.ts` exporting `registerPatchTools(server)`, registered in `tools.ts`. Tools take `(args, extra)`, `resolveUserId(extra, userId)`, `assertWorkoutIdShape`, weights via `displayToKg`, leak-safe errors, echo `userId`/`unit`.
- **MIRROR**: write-tools.ts structure + result/error helpers.
- **VALIDATE**: `patch-tools.test.ts` mirroring write-tools.test.ts — happy path mutates only the target, not-found on bad id/owner, no-user gate. `npx vitest run src/lib/mcp`.

---

## Testing Strategy

### Unit Tests (highlights)
| Test | Input | Expected | Phase |
|---|---|---|---|
| uuid guard | `'abc'` | throws `ToolError /not found/` | 6 |
| update bad id | `{id:'abc'}` | `isError /not found/`, db not called | 6 |
| backdate kept | `startedAt` past ISO | `saveWorkout` gets that Date | 7 |
| backdate future | future ISO | `isError /future/` | 7 |
| resolveUserId authed | `extra.authInfo.extra.userId` + arg + env | returns authed id | 5 |
| auth overrides arg | authed `A`, arg `B` | returns `A` (no impersonation) | 5 |
| well-known public | `/.well-known/...` req | no redirect | 5 |
| update_set | one set | only that row changes | 8 |

### Edge Cases
- [ ] Non-UUID id (6) · valid-but-absent id (existing not-found) (6)
- [ ] Future/invalid/absent `startedAt` (7)
- [ ] No token + `required` (5 → 401) · token present, user in `extra` (5)
- [ ] `userId` arg present but authed → arg ignored (5)
- [ ] remove last set / renumber / not-owned (8)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
```
EXPECT: zero errors.

### Lint (scoped — worktree noise)
```bash
npx eslint src
```
EXPECT: clean.

### Unit/MCP tests
```bash
npx vitest run src --exclude '**/.claude/**'
```
EXPECT: all pass incl. new suites.

### Auth smoke (local, prod build)
```bash
npm run build && npm run start &
# unauthenticated → 401 + WWW-Authenticate  (only when required; set NODE_ENV=production for this check)
curl -i -s -X POST localhost:3000/api/mcp -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | head -20
# well-known is public 200
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/.well-known/oauth-protected-resource/mcp
```
EXPECT: 401 with `WWW-Authenticate` on `/api/mcp` (prod mode); 200 on `.well-known`.

### Manual (post-deploy, owner)
- [ ] Enable Clerk OAuth app + DCR; `vercel env rm MCP_DEV_USER_ID production`; deploy.
- [ ] Add the connector in a client; complete Clerk sign-in; `whoami` → your Clerk id.
- [ ] Backdate a workout; patch a set; bad id → "not found".

---

## Acceptance Criteria
- [ ] Prod `/api/mcp` requires a Clerk token (401 otherwise); tools act as the token's user; `whoami` proves it
- [ ] `.well-known` metadata routes public and correct
- [ ] Bad/malformed id → surfaced "not found" everywhere (get/update/delete/resource)
- [ ] create/update accept and persist `startedAt`; future dates rejected
- [ ] A single set can be patched without a full replace; only the target row changes
- [ ] `tsc` clean · `eslint src` clean · `vitest run src` green · no regressions

## Completion Checklist
- [ ] Each phase shipped as its own reviewable PR (order 6→7→5→8)
- [ ] `resolveUserId` precedence: token > arg(dev) > env(dev); no impersonation
- [ ] Error handling mirrors `ToolError`/genericize split
- [ ] Tests mirror existing `vi.mock`/`fakeServer` scaffolds; handlers tested with a fake `extra`
- [ ] `MCP_DEV_USER_ID` off in prod, kept for dev
- [ ] No new tables; partial edit on existing schema
- [ ] PRD phase statuses updated

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `@clerk/mcp-tools` ↔ Clerk7/Next16 incompat | M | blocks auth | Verify in 5.1; fall back to hand-rolled `verifyToken` over `auth({acceptsToken:'oauth_token'})` |
| `.well-known` gated by middleware | M | client can't discover AS | 5.6 exemption + proxy.test assertion |
| `required:true` breaks local dev | M | dev friction | gate `required` on `NODE_ENV==='production'` |
| `extra` threading misses a handler | M | that tool ignores auth | tsc + a per-surface auth test; centralize in `resolveUserId` |
| Backdate corrupts "last performance" ordering | L | wrong reads | reject future dates; ordering already by `started_at` |
| Partial-edit reindex bugs | M | corrupt set order | explicit renumber rules + targeted tests (8.2) |
| Dashboard DCR not enabled | M | E2E auth can't run | owner action called out in 5.7 + PRD open Q |

## Notes
- **Implemented as 4 stacked PRs** (6→7→5→8) despite being one plan — honors the "≤300-line, one-ticket-one-PR" rule while satisfying the "one combined plan" choice.
- **Dev stays usable**: `required` auth only in prod; `MCP_DEV_USER_ID` remains the dev path.
- **Partial-edit** is spike-gated (8.1) with a default recommendation (granular tools) so implementation isn't blocked, but the decision is explicit.
- Deps: `@clerk/mcp-tools` (new). No schema/table changes.
