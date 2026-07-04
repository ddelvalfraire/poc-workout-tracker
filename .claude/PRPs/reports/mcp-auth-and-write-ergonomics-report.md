# Implementation Report: MCP Auth & Write Ergonomics (PRD Phases 5–8)

## Summary
Authenticated the MCP endpoint with Clerk OAuth so every call acts as the
token's signed-in user (no more `MCP_DEV_USER_ID` default in prod), and closed
three write-surface gaps: legible **not-found** for malformed ids, **backdating**
via `startedAt`, and **partial edits** (patch a single set / workout meta without
a full replace). Delivered as four phase-scoped commits on one branch, in the
plan's recommended order **6 → 7 → 5 → 8** so each stays independently reviewable.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large (XL; auth the bulk) | Large — matched; auth's signature ripple was the widest change |
| Confidence | n/a | High — `@clerk/mcp-tools@0.5.0` integrated cleanly, no hand-rolled fallback needed |
| Files Changed | ~16 (4 created, ~12 updated) | 24 touched: 6 created, 18 updated (incl. tests) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 6.1 | `assertWorkoutIdShape` guard | ✅ Complete | |
| 6.2 | Guard unit tests | ✅ Complete | |
| 6.3 | Call guard in get/update/delete + resource | ✅ Complete | Placeholder test ids promoted to real UUIDs so they exercise the DB path |
| 7.1 | `startedAt` on input contract | ✅ Complete | `parseStartedAt` accepts ISO string or Date, rejects future/invalid |
| 7.2 | Persist `startedAt` in DB layer | ✅ Complete | Omit-when-absent preserves `now()` default / existing value |
| 7.3 | Expose `startedAt` on create/update tools | ✅ Complete | `z.string().datetime().optional()` |
| 5.1 | Install `@clerk/mcp-tools` + verify compat | ✅ Complete | 0.5.0, `./next` helpers present; Clerk 7 / Next 16 OK |
| 5.2 | `resolveUserId(extra, arg)` authed-id precedence | ✅ Complete | Token > arg(dev) > env(dev); no impersonation |
| 5.3 | Thread `extra` through every tool/resource | ✅ Complete | 9 user-scoped handlers + resource; `search_exercises` left (no user) |
| 5.4 | Wrap route with `withMcpAuth` | ✅ Complete | `required` gated on `NODE_ENV==='production'` |
| 5.5 | `.well-known` metadata routes | ✅ Complete | Protected-resource + auth-server, GET + CORS OPTIONS |
| 5.6 | Exempt `.well-known` in `proxy.ts` | ✅ Complete | + proxy.test assertion |
| 5.7 | Prod env cutover | ⏳ Owner | `vercel env rm MCP_DEV_USER_ID production` + live OAuth E2E — post-deploy |
| 8.1 | SPIKE — choose shape | ✅ Complete | Decision: **(A) granular tools** (clarity, small blast radius, explicit renumber) |
| 8.2 | Data-access ops for granular edits | ✅ Complete | `updateSet/addSet/removeSet/updateWorkoutMeta`, ownership via join, renumber on remove |
| 8.3 | `patch-tools.ts` granular tools | ✅ Complete | `update_set/add_set/remove_set/set_workout_meta` |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (`tsc --noEmit`) | ✅ Pass | Zero errors |
| Lint (`eslint src`) | ✅ Pass | Clean |
| Unit Tests (`vitest run src`) | ✅ Pass | 244 tests, 27 files |
| Build (`next build`) | ✅ Pass | Both `.well-known` routes + `/api/[transport]` compile as dynamic functions |
| Integration (live auth smoke) | ⏳ Owner | 401/well-known curl + Clerk sign-in E2E is the post-deploy owner step (5.7); `.well-known/oauth-authorization-server` proxies Clerk's live metadata |

## Files Changed (highlights)

| File | Action | Phase |
|---|---|---|
| `src/lib/mcp/workout-id.ts` (+test) | CREATED | 6 |
| `src/lib/workout-input.ts` | UPDATED (`startedAt` + `parseStartedAt`) | 7 |
| `src/db/workouts.ts` | UPDATED (persist `startedAt`; 4 set-level ops) | 7,8 |
| `src/lib/mcp/resolve-user.ts` | UPDATED (`(extra, arg)` precedence) | 5 |
| `src/lib/mcp/{read,write,tools,resources}.ts` | UPDATED (thread `extra`) | 5 |
| `src/app/api/[transport]/route.ts` | UPDATED (`withMcpAuth`) | 5 |
| `src/app/.well-known/**` (2 routes) | CREATED | 5 |
| `src/proxy.ts` (+test) | UPDATED (`.well-known` public) | 5 |
| `src/lib/mcp/patch-tools.ts` (+test) | CREATED | 8 |
| `src/db/patch-sets.test.ts` | CREATED | 8 |

## Deviations from Plan
- **Test id placeholders → real UUIDs.** The Phase-6 shape guard runs before the
  DB mocks, so the existing `'w1'`/`'missing'` placeholders in read/write/resource
  tests would trip the guard rather than reach the mocked DB path. Promoted them
  to valid UUIDs so each test still exercises the intended DB branch.
- **`parseStartedAt` exported** (plan kept it private) so `set_workout_meta` reuses
  the future-date check rather than duplicating it (DRY).
- **24 files vs ~16 predicted** — the extra files are colocated test suites
  (patch-tools, patch-sets) and the id-placeholder updates, not new surface area.

## Issues Encountered
- **Shell cwd drift** from an earlier `cd node_modules/...` made a couple of
  relative-path commands fail; resolved by using absolute paths / `cd`-to-root.
  No impact on the implementation.

## Tests Written

| Test File | Focus |
|---|---|
| `workout-id.test.ts` | UUID-shape guard (valid/invalid/empty) |
| `resolve-user.test.ts` (rewritten) | authed-id precedence, no-impersonation, dev fallbacks |
| `patch-tools.test.ts` | 4 granular tools: convert/echo, not-found, no-user gate, auth override |
| `patch-sets.test.ts` | DB ops: ownership gate (null when not owned), renumber on remove |
| `write-tools.test.ts` (extended) | backdate persisted, future rejected, bad-id not-found, auth override |
| `workout-input.test.ts` (extended) | `startedAt` parse/keep/reject-future/omit-blank |
| `proxy.test.ts` (extended) | `.well-known` paths public when signed out |

## Next Steps
- [ ] Owner (post-deploy, Task 5.7): `vercel env rm MCP_DEV_USER_ID production`, deploy,
      then add the connector in an MCP client, complete Clerk sign-in, confirm
      `whoami` returns the token's Clerk id; spot-check backdate + patch-set + bad-id.
- [ ] Open the four stacked PRs (order 6 → 7 → 5 → 8) or one combined PR per preference.
- [ ] `/code-review` before merge.
