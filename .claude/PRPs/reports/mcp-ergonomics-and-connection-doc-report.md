# Implementation Report: MCP Ergonomics + Connection Doc (Phase 4)

## Summary
Added the two genuinely-new Phase 4 items: a read-only `workout://{id}` MCP **resource** (the addressable twin of the `get_workout` tool, reusing a shared payload projection) and an **"MCP Agent Server" README section** documenting the endpoint, the env-var user model, the full tool/resource surface, and a worked read→create→read loop. The other Phase 4 "polish" bullets (structured tool errors, resolved-user echo, `userId` arg/env resolution) already shipped in Phases 2–3 and needed no work, as the plan called out.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Small | Small — confirmed |
| Confidence | 9/10 | Justified — single-pass, no deviations |
| Files Changed | 6 (2 created, 4 updated) | 7 (2 created, 5 updated) — +1 was the PRD status flip, already counted in the plan's Task 7 |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Extract `buildWorkoutPayload` in read-tools.ts | Complete | Behavior-preserving; 20 existing `get_workout`/read tests pass unchanged |
| 2 | Create resources.ts (`workout://{id}`) | Complete | TDD GREEN after stub→RED |
| 3 | Write resources.test.ts | Complete | 5 tests, written RED-first against a stub |
| 4 | Wire `registerResources` into `registerTools` | Complete | Doc comment refreshed |
| 5 | Update tools.test.ts fakeServer + resource assertion | Complete | Added `registerResource` recorder + 1 test (RED→GREEN) |
| 5b | read/write test fakeServers | Complete | No change needed (verified — only `tools.ts` calls `registerResources`) |
| 6 | README "MCP Agent Server" section | Complete | Endpoint, no-auth warning, env user, tool/resource table, example loop |
| 7 | PRD Phase 4 → in-progress + plan link | Complete | Done during planning; flipped to `complete` in this report step |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (tsc) | Pass | Zero type errors |
| Lint (`eslint src/lib/mcp`) | Pass | Clean; project-wide lint remains polluted by `.claude/worktrees/**` (known, out of scope) |
| Unit Tests (MCP) | Pass | 56/56 |
| Full Project Suite | Pass | 23 files, 183 tests (run with `--exclude '**/.claude/**'` to skip stale worktree tests) |
| Build | N/A | Pure lib + doc change; compilation covered by tsc. A full `next build` would spuriously fail on the worktree's lint errors |
| Integration (live MCP client) | Deferred | Needs a running server + MCP client; manual checklist in the plan |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/lib/mcp/resources.ts` | CREATED | +52 |
| `src/lib/mcp/resources.test.ts` | CREATED | +160 |
| `src/lib/mcp/read-tools.ts` | UPDATED | net ~+8 (extracted `buildWorkoutPayload`, `get_workout` now delegates) |
| `src/lib/mcp/tools.ts` | UPDATED | +3 / ~-2 (import + call + comment) |
| `src/lib/mcp/tools.test.ts` | UPDATED | +~15 (fakeServer `registerResource` recorder + assertion test) |
| `README.md` | UPDATED | +56 |
| `.claude/PRPs/prds/mcp-agent-server.prd.md` | UPDATED | Phase 4 status + plan/report links |

## Deviations from Plan
None — implemented exactly as planned. The only refinement: the resource test asserts `content.uri` with `toContain('w1')` rather than an exact `href` match, to stay robust against `URL` normalization of the custom `workout://` scheme.

## Issues Encountered
- **Worktree pollution** continues to make bare `npx vitest run` / project-wide `eslint` report failures from `.claude/worktrees/feat+unit-preference-kg-lb/**` (a stale checkout importing a since-renamed `@/lib/uuid`). Not from this change; worked around by scoping the run with `--exclude '**/.claude/**'`. The clean project signal is 183/183.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/mcp/resources.test.ts` | 5 | resource registration (template pattern), happy-path payload + unit conversion, not-found throw, no-user throw (db not queried), leak-safe generic on db error |
| `src/lib/mcp/tools.test.ts` | +1 | asserts `registerTools` registers the `workout` resource |

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] Manual: connect a live MCP client, list the `workout` resource, run the README example loop
