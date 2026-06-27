# Implementation Report: MCP Endpoint Scaffold (Phase 1)

## Summary
Stood up a live, connectable MCP server inside the existing Next.js app as a
Streamable HTTP route handler at `/api/mcp` using Vercel's `mcp-handler`. Phase 1
delivers the transport, the Clerk public-route exemption, a shared `resolveUserId`
helper (the userId authorization boundary reused by Phases 2/3), and two trivial
tools — `ping` and `whoami`. No business tools (those are Phases 2/3).

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Small–Medium | Small–Medium (as predicted) |
| Files Changed | 6 (3 CREATE, 3 UPDATE) | 6 (3 CREATE, 3 UPDATE) + lockfile |
| Dependency resolution | Clean, no `--legacy-peer-deps` | Clean — SDK deduped to 1.26.0 |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Install deps (mcp-handler, SDK 1.26.0, zod) | Complete | SDK deduped across mcp-handler + shadcn; no ERESOLVE |
| 2 | `resolveUserId` helper | Complete | Pure fn; loud POC auth-boundary doc comment |
| 3 | Resolver unit test (TDD) | Complete | 4 tests, AAA, env restored in afterEach |
| 4 | MCP route handler `[transport]` | Complete | `basePath:'/api'` → client URL `/api/mcp`; `serverInfo` set; tools delegated to `registerTools` |
| 5 | Exempt `/api/mcp` from Clerk | Complete | Added `/api/mcp(.*)` to `isPublicRoute` only; matcher untouched |
| 6 | Document `MCP_DEV_USER_ID` | Complete | Optional var; not added to any `requireEnv` |
| 7 | Code-review fixes | Complete | Extracted `registerTools` into `src/lib/mcp/tools.ts` (testable without HTTP handshake) + 5 tool tests; added `serverInfo` so clients see a named server |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static — tsc | Pass | `npx tsc --noEmit` clean |
| Static — lint | Pass (changed files) | 4 changed files lint at exit 0. Repo-wide lint reports pre-existing noise from `.claude/worktrees/**/.next` build artifacts (out of scope) |
| Unit Tests | Pass | 9 new MCP tests (4 resolver + 5 tool handlers); full project suite green excluding the stray worktree |
| Build | Pass | `/api/[transport]` + `/api/exercises` both compile; no segment collision; Proxy middleware present |
| Integration / Live | Pass | Verified with a real MCP client (SDK `StreamableHTTPClientTransport`, the same protocol the Inspector uses): connects with no Clerk redirect, lists `ping`+`whoami`, `ping`→`pong`, `whoami` resolves arg + env, `serverInfo` reads back `workout-tracker 0.1.0`. Also confirmed the exemption is scoped — `GET /` still 307s to `/sign-in`. |
| Edge Cases | Pass | whitespace-only arg, missing arg+env, and the tool `isError` path all covered |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `package.json` | UPDATED | +5 / -1 (deps) |
| `package-lock.json` | UPDATED | +162 / -5 |
| `src/lib/mcp/resolve-user.ts` | CREATED | +19 |
| `src/lib/mcp/resolve-user.test.ts` | CREATED | +42 |
| `src/lib/mcp/tools.ts` | CREATED | +47 |
| `src/lib/mcp/tools.test.ts` | CREATED | +96 |
| `src/app/api/[transport]/route.ts` | CREATED | +28 |
| `src/proxy.ts` | UPDATED | +1 / -1 |
| `.env.example` | UPDATED | +4 |

## Deviations from Plan
- **File path** `src/app/api/[transport]/route.ts` (not the PRD's literal
  `app/api/mcp/[transport]`). Intentional and documented in the plan's Risks — with
  `basePath:'/api'` this yields the PRD's stated client URL `/api/mcp`, the #1 success
  metric. The static `/api/exercises` route still wins over the dynamic `[transport]`
  by Next's static-over-dynamic precedence; build confirmed no collision.

## Issues Encountered
- **Repo-wide lint and `npm run test` report failures from `.claude/worktrees/feat+unit-preference-kg-lb/`** —
  a separate, untracked sibling git worktree whose `.next` build artifacts and
  unmerged source (`@/lib/uuid`) are scanned by the project's eslint/vitest globs.
  These are entirely pre-existing and unrelated to this change. Confirmed by scoping:
  the 4 changed files lint clean, and excluding `**/.claude/**` yields 131/131 tests
  passing. Not fixed here (out of scope — no drive-by changes).

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/mcp/resolve-user.test.ts` | 4 | arg-wins, env-fallback, missing-both-throws, whitespace-arg-ignored |
| `src/lib/mcp/tools.test.ts` | 5 | both tools register; `ping`→`pong`; `whoami` arg-wins; `whoami` env-fallback; `whoami` `isError` when unresolved |

## Code Review
- Reviewed local; decision **APPROVE with comments**. No CRITICAL/HIGH defects in the
  shipped code. Two findings addressed before commit: (MEDIUM) no automated test for the
  route handler → extracted `registerTools` and added 5 tool tests; (LOW) server had no
  identity → added `serverInfo`.
- **Standing gate (HIGH, forward-looking):** this endpoint is unauthenticated by design.
  Do NOT register any user-data tool on it until auth lands. `resolveUserId` trusting an
  arbitrary `userId` arg becomes an IDOR the moment Phase 2/3 read/write tools attach.

## Next Steps
- [x] Live MCP-client check (connect / list / call / scoped exemption) — passed.
- [x] Code review + fixes — done.
- [x] Commit + PR — committed; PR via `/prp-pr`.
- [ ] Repeat the live check against the deployed Vercel URL after merge.
- [ ] Plan Phase 2 (read tools) / Phase 3 (write tools) — both reuse `resolveUserId`;
      gate them behind auth per the standing review note above.
