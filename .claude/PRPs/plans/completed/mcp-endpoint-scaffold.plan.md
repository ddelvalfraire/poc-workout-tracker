# Plan: MCP Endpoint Scaffold (Phase 1)

## Summary
Stand up a live, connectable MCP server **inside the existing Next.js app** as a route handler, using Vercel's `mcp-handler` (Streamable HTTP transport over `@modelcontextprotocol/sdk`). Phase 1 delivers the transport, the Clerk public-route exemption, a `userId` resolver shared by later phases, and two trivial tools (`ping`, `whoami`) — proving an MCP client can connect to `/api/mcp` and list/call tools. No business tools yet (those are Phases 2/3).

## User Story
As a builder dogfooding the app, I want a connectable MCP endpoint exposing a trivial tool, so that I can verify an agent can reach the app over MCP before I wire up real read/write tools.

## Problem → Solution
The app has no machine/agent entry point — capabilities live behind Clerk-gated Server Actions and one HTTP route (`/api/exercises`). → A public `/api/mcp` Streamable HTTP endpoint that an MCP client can connect to, list tools, and call a `ping`/`whoami` tool successfully (locally and on the deployed Vercel URL).

## Metadata
- **Complexity**: Small–Medium (1 new route, 1 new lib + test, 1 middleware edit, dep install)
- **Source PRD**: `.claude/PRPs/prds/mcp-agent-server.prd.md`
- **PRD Phase**: Phase 1 — MCP endpoint scaffold
- **Estimated Files**: 6 (3 CREATE, 3 UPDATE)

---

## UX Design

Internal/agent-facing change — no end-user UI.

### Before
```
┌───────────────────────────────────────────┐
│ App surfaces:                              │
│  • Clerk-gated Server Actions (UI only)    │
│  • GET /api/exercises (Clerk-gated)        │
│ No agent/machine entry point.              │
└───────────────────────────────────────────┘
```

### After
```
┌───────────────────────────────────────────┐
│ MCP client (Claude / MCP Inspector)        │
│        │  Streamable HTTP                   │
│        ▼                                    │
│  POST /api/mcp   ← PUBLIC (no Clerk)        │
│        │                                    │
│        ▼                                    │
│  mcp-handler → registers tools:            │
│    • ping    → "pong"                       │
│    • whoami  → resolved target userId       │
└───────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| `/api/mcp` | 404 / Clerk-gated | Public MCP Streamable HTTP endpoint | Exempted in `src/proxy.ts` |
| Tool list | none | `ping`, `whoami` | Trivial connectivity/identity tools |
| `userId` source | Clerk session (`auth()`) | tool arg → `MCP_DEV_USER_ID` env | POC; no auth on this endpoint |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/proxy.ts` | 1-17 | The Clerk middleware to exempt `/api/mcp` from; shows `createRouteMatcher`/matcher config |
| P0 | `src/app/api/exercises/route.ts` | 1-49 | The established route-handler + error-handling + doc-comment conventions to mirror |
| P0 | `src/lib/env.ts` | 1-8 | `requireEnv` pattern; `MCP_DEV_USER_ID` is *optional*, so do NOT use `requireEnv` for it |
| P1 | `src/app/api/exercises/route.test.ts` | 1-124 | The vitest test conventions (AAA, `vi.mock`, describe/it) to mirror for the resolver test |
| P1 | `src/db/workouts.ts` | 6-13, 173-186 | The "this module is the authorization boundary / always scoped to userId" doc-comment voice to echo |
| P2 | `src/lib/workout-input.ts` | 1-15, 105-121 | Validation/trust-boundary voice (referenced more heavily in Phases 2/3) |
| P2 | `package.json` | 18-48 | Current deps; confirms zod is NOT yet a direct dep, SDK present transitively at 1.29.0 |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| mcp-handler Next.js quick start | `mcp-handler@1.1.0` README (npm) | File at `app/api/[transport]/route.ts`; `createMcpHandler(init, serverOpts, { basePath, maxDuration, verboseLogs })`; `basePath` "must match where `[transport]` is located"; client connects to `{basePath}/mcp` |
| Tool registration API | mcp-handler README / SDK 1.26 `McpServer` | `server.registerTool(name, { title, description, inputSchema }, handler)`; `inputSchema` is a **zod raw shape** (`{ field: z.string() }`), not a `z.object(...)`; handler returns `{ content: [{ type: 'text', text }], isError? }` |
| Transport / Redis | mcp-handler README "Features" | Redis is **only** for SSE resumability. Streamable HTTP needs no Redis — omit `redisUrl` |
| Client connect string | mcp-handler README "Connecting Clients" | Streamable HTTP clients use `{ "url": "http://localhost:3000/api/mcp" }`; stdio-only clients wrap with `mcp-remote` |
| Version compatibility (verified) | `npm view` at plan time | `mcp-handler@1.1.0` peers: `next >=13.0.0` (16.2.9 ✓), `@modelcontextprotocol/sdk` **exactly `1.26.0`**. SDK 1.26 peers `zod ^3.25 || ^4.0` (zod@4.4.3 ✓). `shadcn@4.11.0` needs sdk `^1.26.0` — a direct `1.26.0` satisfies it too |

---

## Patterns to Mirror

### NAMING_CONVENTION
```ts
// SOURCE: src/app/api/exercises/route.ts:18, src/db/preferences.ts:15
// Exported route handlers are UPPERCASE HTTP verbs; lib functions camelCase with
// explicit param + return types; doc-comment every exported symbol.
export async function GET(request: Request): Promise<NextResponse> { /* ... */ }
export async function getWeightUnit(userId: string): Promise<WeightUnit> { /* ... */ }
```

### ERROR_HANDLING
```ts
// SOURCE: src/app/api/exercises/route.ts:42-48
// try/catch around the external/IO call; console.error with a context string;
// return a structured payload (never let a raw 500 leak). For MCP tools the
// equivalent is returning { content: [...], isError: true } instead of throwing.
try {
  const exercises = await searchExercises({ search, category, limit })
  return NextResponse.json(exercises)
} catch (error: unknown) {
  console.error('GET /api/exercises failed', error)
  return NextResponse.json({ error: 'Failed to fetch exercises' }, { status: 502 })
}
```

### ENV_ACCESS
```ts
// SOURCE: src/lib/env.ts:1-8
// requireEnv throws on a MISSING REQUIRED var. MCP_DEV_USER_ID is OPTIONAL
// (a tool arg can supply userId instead), so read process.env directly and
// throw a tool-level error only when BOTH arg and env are absent.
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}
```

### AUTH_BOUNDARY_DOCCOMMENT
```ts
// SOURCE: src/db/workouts.ts:6-13
// Echo this "this module is the authorization boundary; every entry takes a
// userId" voice in the resolver's doc comment — make the POC trade-off loud.
/**
 * Data access for workouts, always scoped to a Clerk userId.
 * ... this module is the authorization boundary: every query filters by user_id.
 */
```

### TEST_STRUCTURE
```ts
// SOURCE: src/app/api/exercises/route.test.ts:1-39
// vitest; AAA comments; describe/it with behavior-describing names; vi.mock for
// boundaries. The resolver is a pure function, so its test needs no mocks beyond
// stubbing process.env.
import { describe, it, expect, beforeEach } from 'vitest'

describe('GET /api/exercises', () => {
  it('returns the exercises as a JSON array', async () => {
    // Arrange
    const exercises = [{ id: 1, name: 'Bench Press', category: 'Chest' }]
    mockedSearch.mockResolvedValue(exercises)
    // Act
    const res = await get()
    // Assert
    expect(res.status).toBe(200)
  })
})
```

### ROUTE_HANDLER_EXPORTS
```ts
// SOURCE: mcp-handler README + src/app/api/exercises/route.ts (verb-named exports)
// mcp-handler returns ONE fetch handler; alias it to the HTTP verbs it serves.
// Streamable HTTP uses POST; GET is for SSE. Mirror the README: export GET + POST.
const handler = createMcpHandler(/* ... */)
export { handler as GET, handler as POST }
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `package.json` / lockfile | UPDATE | Add `mcp-handler@1.1.0`, pin `@modelcontextprotocol/sdk@1.26.0`, add `zod@^4` (all via one `npm install`) |
| `src/lib/mcp/resolve-user.ts` | CREATE | Shared `resolveUserId(argUserId?)` → arg ?? `MCP_DEV_USER_ID`; the userId boundary reused by Phases 2/3 |
| `src/lib/mcp/resolve-user.test.ts` | CREATE | Unit test: arg wins, env fallback, throws clear error when neither present |
| `src/app/api/[transport]/route.ts` | CREATE | The mcp-handler Streamable HTTP endpoint; registers `ping` + `whoami` |
| `src/proxy.ts` | UPDATE | Add `/api/mcp(.*)` to `isPublicRoute` so Clerk doesn't gate the endpoint |
| `.env.example` | UPDATE | Document the new optional `MCP_DEV_USER_ID` var |

## NOT Building
- **Read tools** (`list_workouts`, `get_workout`, `search_exercises`, history, `get_weight_unit`) — Phase 2.
- **Write tools** (`create_workout`, `set_weight_unit`, `update_workout`, `delete_workout`) — Phase 3.
- **Auth / per-user security** on the endpoint — explicit POC exclusion; endpoint stays public.
- **`workout://{id}` resource, structured-error polish, connection doc/skill** — Phase 4.
- **SSE transport + Redis resumability** — Streamable HTTP only; no `redisUrl`.
- **A stdio/desktop server binary** — out of scope (the HTTP route covers remote MCP clients).
- **Full MCP-client E2E harness** — Phase 1 validates via MCP Inspector + a resolver unit test; a programmatic create→read E2E lands with Phase 3.

---

## Step-by-Step Tasks

### Task 1: Install dependencies (resolve the version pins)
- **ACTION**: Add `mcp-handler`, a pinned SDK, and a direct zod.
- **IMPLEMENT**:
  ```bash
  npm install mcp-handler@1.1.0 @modelcontextprotocol/sdk@1.26.0 zod@^4
  ```
- **MIRROR**: n/a (tooling step).
- **IMPORTS**: n/a.
- **GOTCHA**: `mcp-handler@1.1.0` peer-pins `@modelcontextprotocol/sdk` to **exactly `1.26.0`**. The repo currently resolves `1.29.0` transitively (via `shadcn`, which only needs `^1.26.0`). You MUST add a direct `@modelcontextprotocol/sdk@1.26.0` — it satisfies both mcp-handler's exact peer AND shadcn's `^1.26.0`, so the install resolves cleanly with **no** `--legacy-peer-deps`/`overrides`. zod is currently only transitive (4.4.3); the route imports it directly, so it must become a direct dep. SDK 1.26 peers `zod ^3.25 || ^4.0`, so zod@4 is supported despite the README's `zod@^3` suggestion.
- **VALIDATE**:
  ```bash
  npm ls mcp-handler @modelcontextprotocol/sdk zod   # SDK shows 1.26.0, no ERESOLVE/UNMET PEER
  ```

### Task 2: Create the `resolveUserId` helper
- **ACTION**: Create `src/lib/mcp/resolve-user.ts`.
- **IMPLEMENT**: A pure function that returns the target user id, preferring an explicit arg and falling back to the env default; throws a clear `Error` when neither is set.
  ```ts
  /**
   * Resolves the target userId for an MCP tool call (POC, unauthenticated endpoint).
   *
   * This is the *only* place the agent's target user is decided, so it is the de-facto
   * authorization boundary for the whole MCP surface: every tool that touches user data
   * funnels its `userId` through here. Prefers an explicit `userId` tool argument and
   * falls back to `process.env.MCP_DEV_USER_ID` so "add my workout" needs no id during
   * dogfooding. Not production-safe — there is no auth; see the MCP PRD's "What We're NOT
   * Building".
   */
  export function resolveUserId(argUserId?: string): string {
    const fromArg = argUserId?.trim()
    if (fromArg) return fromArg
    const fromEnv = process.env.MCP_DEV_USER_ID?.trim()
    if (fromEnv) return fromEnv
    throw new Error(
      'No userId: pass a `userId` argument or set MCP_DEV_USER_ID in the environment.',
    )
  }
  ```
- **MIRROR**: `ENV_ACCESS` (optional env, not `requireEnv`) + `AUTH_BOUNDARY_DOCCOMMENT` (loud POC trade-off voice).
- **IMPORTS**: none.
- **GOTCHA**: Treat whitespace-only arg/env as absent (`.trim()` then truthiness) — an empty string must not silently become the user id. Do NOT use `requireEnv` here; the env var is optional by design.
- **VALIDATE**: covered by Task 3's test.

### Task 3: Test the resolver (TDD — write before/with Task 2)
- **ACTION**: Create `src/lib/mcp/resolve-user.test.ts`.
- **IMPLEMENT**: Four behaviors, AAA style, stubbing `process.env.MCP_DEV_USER_ID`.
  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest'
  import { resolveUserId } from './resolve-user'

  describe('resolveUserId', () => {
    const original = process.env.MCP_DEV_USER_ID
    beforeEach(() => { delete process.env.MCP_DEV_USER_ID })
    afterEach(() => {
      if (original === undefined) delete process.env.MCP_DEV_USER_ID
      else process.env.MCP_DEV_USER_ID = original
    })

    it('prefers the explicit userId argument over the env default', () => {
      process.env.MCP_DEV_USER_ID = 'user_env'
      expect(resolveUserId('user_arg')).toBe('user_arg')
    })

    it('falls back to MCP_DEV_USER_ID when no argument is given', () => {
      process.env.MCP_DEV_USER_ID = 'user_env'
      expect(resolveUserId()).toBe('user_env')
    })

    it('throws a clear error when neither argument nor env is set', () => {
      expect(() => resolveUserId()).toThrow(/userId/)
    })

    it('treats a whitespace-only argument as absent and falls back to env', () => {
      process.env.MCP_DEV_USER_ID = 'user_env'
      expect(resolveUserId('   ')).toBe('user_env')
    })
  })
  ```
- **MIRROR**: `TEST_STRUCTURE`.
- **IMPORTS**: `vitest`, the unit under test.
- **GOTCHA**: Restore `process.env.MCP_DEV_USER_ID` in `afterEach` so the suite doesn't leak env state into other test files (vitest shares the process by default).
- **VALIDATE**: `npm run test -- resolve-user` → all pass.

### Task 4: Create the MCP route handler
- **ACTION**: Create `src/app/api/[transport]/route.ts`.
- **IMPLEMENT**:
  ```ts
  import { createMcpHandler } from 'mcp-handler'
  import { z } from 'zod'
  import { resolveUserId } from '@/lib/mcp/resolve-user'

  /**
   * MCP server for the workout tracker, exposed as an in-app Streamable HTTP
   * endpoint at /api/mcp (the [transport] segment resolves to "mcp"). PUBLIC and
   * UNAUTHENTICATED by design — a POC agent surface; see the MCP PRD. The Clerk
   * middleware (src/proxy.ts) exempts /api/mcp so this handler runs headless.
   *
   * Phase 1 registers only connectivity/identity tools (ping, whoami); the read
   * and write tools land in Phases 2 and 3.
   */
  const handler = createMcpHandler(
    (server) => {
      server.registerTool(
        'ping',
        {
          title: 'Ping',
          description: 'Liveness check — returns "pong". Use to confirm the MCP endpoint is reachable.',
          inputSchema: {},
        },
        async () => ({ content: [{ type: 'text', text: 'pong' }] }),
      )

      server.registerTool(
        'whoami',
        {
          title: 'Who Am I',
          description:
            'Returns the resolved target userId (the `userId` argument, else the MCP_DEV_USER_ID env default). Confirm this before any write.',
          inputSchema: { userId: z.string().optional() },
        },
        async ({ userId }) => {
          try {
            const resolved = resolveUserId(userId)
            return { content: [{ type: 'text', text: JSON.stringify({ userId: resolved }) }] }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to resolve userId'
            return { content: [{ type: 'text', text: message }], isError: true }
          }
        },
      )
    },
    {},
    {
      // basePath must match where the [transport] segment lives so the client URL
      // is exactly /api/mcp. Streamable HTTP only — no redisUrl (Redis is SSE-only).
      basePath: '/api',
      maxDuration: 60,
      verboseLogs: process.env.NODE_ENV !== 'production',
    },
  )

  export { handler as GET, handler as POST }
  ```
- **MIRROR**: `ROUTE_HANDLER_EXPORTS`, `ERROR_HANDLING` (tool returns `isError` instead of throwing).
- **IMPORTS**: `createMcpHandler` from `mcp-handler`; `z` from `zod`; `resolveUserId` from `@/lib/mcp/resolve-user`.
- **GOTCHA**:
  - `inputSchema` is a **zod raw shape** (`{ userId: z.string().optional() }`), **not** `z.object({...})` — passing a `z.object` will fail schema generation.
  - File path is `app/api/[transport]/route.ts` (dynamic segment directly under `api`), **not** the PRD's literal `app/api/mcp/[transport]`. With `basePath:'/api'` this makes the live client URL exactly `/api/mcp` (the PRD's #1 success metric). The static `app/api/exercises` route still wins over the dynamic `[transport]` by Next's static-over-dynamic precedence, so `/api/exercises` is unaffected. (Deviation noted in Risks.)
  - Do **not** add `export const runtime = 'edge'` — the SDK needs Node APIs; route handlers default to the Node runtime, which is correct for Fluid Compute.
- **VALIDATE**: `npx tsc --noEmit` clean; `npm run build` succeeds (route compiles, no segment-collision error).

### Task 5: Exempt `/api/mcp` from Clerk
- **ACTION**: Edit `src/proxy.ts`.
- **IMPLEMENT**: Add the MCP route to the public matcher.
  ```ts
  const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)', '/api/mcp(.*)'])
  ```
- **MIRROR**: existing `createRouteMatcher` usage in the same file.
- **IMPORTS**: none (already imported).
- **GOTCHA**: Leave `config.matcher` as-is — `/api/mcp` still needs to *run through* the middleware (so the matcher must keep matching `/api/*`); `isPublicRoute` is what skips `auth.protect()`. Only `/api/mcp` is exempted; `/api/sse`/`/api/message` (unused SSE endpoints) stay gated, which is fine.
- **VALIDATE**: see Manual Validation — unauthenticated POST to `/api/mcp` is no longer redirected to sign-in.

### Task 6: Document the new env var
- **ACTION**: Append to `.env.example`.
- **IMPLEMENT**:
  ```bash
  # Target userId for unauthenticated MCP tool calls (POC). When set, MCP tools
  # (e.g. "add my workout") need no userId argument. Use a real Clerk user id.
  MCP_DEV_USER_ID=
  ```
- **MIRROR**: existing comment style in `.env.example`.
- **IMPORTS**: n/a.
- **GOTCHA**: It's optional — do not add it to any `requireEnv` startup check.
- **VALIDATE**: visual; key present with explanatory comment.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| arg preferred over env | `resolveUserId('user_arg')` with env `user_env` | `'user_arg'` | No |
| env fallback | `resolveUserId()` with env `user_env` | `'user_env'` | No |
| missing both throws | `resolveUserId()` no env | throws `/userId/` | Yes |
| whitespace arg ignored | `resolveUserId('   ')` with env set | `'user_env'` | Yes |

### Edge Cases Checklist
- [x] Empty/whitespace arg → treated as absent (covered)
- [x] Missing env + missing arg → clear thrown error (covered)
- [ ] Maximum size input — n/a (id is an opaque string)
- [ ] Invalid types — TypeScript prevents non-string args; not runtime-tested
- [ ] Concurrent access — n/a (pure function, no shared state)
- [ ] Network failure — n/a (Phase 1 tools do no IO)
- [x] Permission denied — endpoint is intentionally public (POC); documented

> Note: a programmatic MCP-client `tools/list`/`tools/call` test against the handler requires the full initialize handshake and is deferred — Phase 1 validates tool listing/calling via **MCP Inspector** (Manual Validation). The create→read E2E that asserts Postgres rows lands with Phase 3.

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
```
EXPECT: Zero type errors.

```bash
npm run lint
```
EXPECT: No lint errors (no `console.log`; `console.error` only if used).

### Unit Tests
```bash
npm run test -- resolve-user
```
EXPECT: All resolver tests pass.

### Full Test Suite
```bash
npm run test
```
EXPECT: No regressions across the existing suite.

### Build Verification
```bash
npm run build
```
EXPECT: Build succeeds; `/api/[transport]` compiles; no route-segment collision with `/api/exercises`.

### Dependency Sanity
```bash
npm ls mcp-handler @modelcontextprotocol/sdk zod
```
EXPECT: `@modelcontextprotocol/sdk@1.26.0`, `mcp-handler@1.1.0`, a `zod@4.x` — no `UNMET PEER DEPENDENCY` / `ERESOLVE`.

### Manual Validation (MCP Inspector — the Phase-1 success signal)
```bash
# Terminal 1: run the app (ensure MCP_DEV_USER_ID is set in .env.local to a real Clerk user id)
npm run dev

# Terminal 2: launch the MCP Inspector and point it at the endpoint
npx @modelcontextprotocol/inspector
# In the Inspector UI: Transport = "Streamable HTTP", URL = http://localhost:3000/api/mcp → Connect
```
- [ ] Inspector connects without a Clerk sign-in redirect (proves the public exemption).
- [ ] Tool list shows `ping` and `whoami`.
- [ ] Calling `ping` returns `pong`.
- [ ] Calling `whoami` (no args) returns the `MCP_DEV_USER_ID`; calling with `{ "userId": "user_x" }` returns `user_x`.
- [ ] After deploy, repeat against `https://<app>/api/mcp` (PRD success signal: connectable on the deployed URL).

---

## Acceptance Criteria
- [ ] `npm install` resolves cleanly with SDK pinned to 1.26.0 (no peer errors).
- [ ] An MCP client connects to `/api/mcp` and lists `ping` + `whoami` (local + deployed).
- [ ] `ping` returns `pong`; `whoami` echoes the resolved userId (arg or env).
- [ ] Unauthenticated request to `/api/mcp` is NOT redirected to sign-in.
- [ ] All validation commands pass; resolver unit tests green; no type/lint errors.

## Completion Checklist
- [ ] Code follows discovered patterns (route exports, env access, doc-comment voice).
- [ ] Error handling matches codebase style (tool returns `isError`, no thrown 500s).
- [ ] No `console.log`; doc comments on every exported symbol.
- [ ] Tests follow the AAA/vitest pattern; env state restored in `afterEach`.
- [ ] No hardcoded user ids or secrets; `MCP_DEV_USER_ID` documented in `.env.example`.
- [ ] POC "no auth / public endpoint" trade-off documented loudly in the route + resolver doc comments.
- [ ] No scope creep into Phase 2/3 tools.
- [ ] Self-contained — implementable from this plan without further searching.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| File path deviates from PRD's literal `app/api/mcp/[transport]` | Certain (intentional) | Low | `app/api/[transport]` + `basePath:'/api'` yields the PRD's stated client URL `/api/mcp`; documented here. If a reviewer insists on the literal path, use `app/api/mcp/[transport]/route.ts` + `basePath:'/api/mcp'` and connect to `/api/mcp/mcp` (still covered by the `/api/mcp(.*)` exemption). |
| zod v4 raw-shape incompatibility with SDK 1.26 `registerTool` | Low | Med | SDK 1.26 peers `zod ^3.25 || ^4.0`; verified at plan time. If JSON-schema generation throws at build/runtime, fall back to a direct `zod@^3.25` dep (changes nothing in the `ping`/`whoami` shapes). |
| Dynamic `[transport]` segment shadows another `/api/*` route | Low | Med | Next resolves static segments (`/api/exercises`) before dynamic (`[transport]`); `npm run build` will surface any collision. Only `mcp`/`sse` transports are handled; others 404 from mcp-handler. |
| Public unauthenticated endpoint (data exposure once Phase 2/3 land) | High (by design) | High (later) | Accepted POC decision; Phase 1 tools touch no user data. Documented as not production-safe; revisit with auth before real use. |
| `mcp-handler` cold-start / 60s `maxDuration` on Vercel | Low | Low | Streamable HTTP requests are short; `maxDuration: 60` is ample for `ping`/`whoami`. Fluid Compute reuses instances, reducing cold starts. |

## Notes
- **Version facts verified at plan time** (`npm view`): `mcp-handler@1.1.0` (peers `next >=13.0.0`, `@modelcontextprotocol/sdk` exact `1.26.0`); `@modelcontextprotocol/sdk@1.26.0` (peers `zod ^3.25 || ^4.0`); `shadcn@4.11.0` needs sdk `^1.26.0`; zod is not yet a direct dependency. This clears the PRD's Open Question / "mcp-handler ↔ Next 16 / Fluid Compute" risk: **compatible**.
- The `whoami` tool intentionally previews the Phase 2/3 `resolveUserId` boundary so those phases inherit a tested helper rather than re-deriving user resolution.
- Redis is deliberately omitted (`@upstash/redis` in the repo is for the wger cache, not MCP). Streamable HTTP needs no Redis; only SSE resumability would.
- Phases 2 (read) and 3 (write) can proceed in parallel once this lands, both reusing `resolveUserId` and calling `src/db/*` / `src/lib/wger.ts` directly (never the Clerk-gated Server Actions).
