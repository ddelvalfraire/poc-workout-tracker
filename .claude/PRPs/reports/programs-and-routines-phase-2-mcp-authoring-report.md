# Implementation Report: Programs & Routines — Phase 2 (MCP Coarse Authoring + Read)

## Summary
Exposed the Phase 1 program data layer to the agent. New `registerProgramTools` adds `upsert_program` (create + full-replace, display→kg conversion, Zod validation, one transaction), `get_program`, `list_programs`, `delete_program`, `set_program_status`, plus the `program://{id}` resource. All twin the existing workout MCP surface (resolveUserId authz boundary, `ToolError`/`errorResult` leak-safe split, id-shape guard, display↔kg conversion). Wired into `registerTools`.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large |
| Confidence | 8/10 | Single-pass; one additive deviation (a dedicated program-id test) |
| Files Changed | 3 new + 4 edited | 4 new + 4 edited (added `program-id.test.ts`) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | `program-id.ts` (+ `assertProgramIdShape`) | Complete | Added a dedicated `program-id.test.ts` — see Deviations |
| 2 | `program-tools.ts` (5 tools + `buildProgramPayload`) | Complete | `rawProgramSchema.shape` spread into the upsert input to DRY the schema |
| 3 | Wire into `tools.ts` | Complete | + updated registrar doc comment |
| 4 | `program://{id}` in `resources.ts` | Complete | Twin of the workout resource |
| 5 | Update `tools.test.ts` | Complete | Tool list (20 tools) + program resource asserted |
| 6 | `program-tools.test.ts` | Complete | 25 tests |
| 7 | Extend `resources.test.ts` | Complete | +6 program-resource tests |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `tsc --noEmit` clean; `eslint src` clean |
| Unit Tests | Pass | 313 pass (excl. stray worktree); MCP suite 130; 38 new/updated |
| Build | Pass | `next build` succeeds; route table unchanged (`/api/[transport]` already existed) |
| Integration | N/A | No new runtime route; the MCP transport route already serves these tools |
| Edge Cases | Pass | empty days, timed-without-duration, over-max load (unit-aware message), not-owned, no-user gate, malformed id, db-leak |

## Files Changed

| File | Action | Lines (approx) |
|---|---|---|
| `src/lib/mcp/program-id.ts` | CREATED | +16 |
| `src/lib/mcp/program-id.test.ts` | CREATED | +28 |
| `src/lib/mcp/program-tools.ts` | CREATED | +360 |
| `src/lib/mcp/program-tools.test.ts` | CREATED | +400 |
| `src/lib/mcp/tools.ts` | UPDATED | +6 / -2 |
| `src/lib/mcp/tools.test.ts` | UPDATED | +10 / -4 |
| `src/lib/mcp/resources.ts` | UPDATED | +40 / -2 |
| `src/lib/mcp/resources.test.ts` | UPDATED | +150 / -2 |

## Deviations from Plan

1. **Added a dedicated `program-id.test.ts`** (not in the plan's file list). During Task 1 I found a sibling `workout-id.test.ts` exists, so I mirrored it for parity rather than folding id-guard coverage solely into the tool tests. Strictly additive.
2. **DRY'd the upsert input schema** via `...rawProgramSchema.shape` (a `z.object` spread) instead of re-declaring every field twice. Same advertised shape, less duplication; documented inline.

## Issues Encountered

1. **Stray-worktree tooling pollution persists** (`.claude/worktrees/feat+unit-preference-kg-lb/`). `npm run test`/`npm run lint` still pick it up. Scoped commands stay clean: `vitest run --exclude '**/.claude/worktrees/**'` → 313 pass; `eslint src` → clean. Pre-existing; out of scope.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/mcp/program-id.test.ts` | 6 | UUID-shape guard accept/reject |
| `src/lib/mcp/program-tools.test.ts` | 25 | All 5 tools: create/replace, conversion, defaults, impersonation, no-user gate, over-max, timed-no-duration, not-owned, malformed id, db-leak, read render |
| `src/lib/mcp/resources.test.ts` | +6 | `program://{id}`: registration, payload render, not-found, missing-id, no-user, db-leak |
| `src/lib/mcp/tools.test.ts` | updated | Exact 20-tool list + `program` resource |

## Design Note — unit policy (as planned)
`suggestedLoad` (the typed per-set column) converts display↔kg exactly like `create_workout`. The `technique`/`progression` JSONB tail passes through **verbatim as kg**, documented in the tool descriptions. `distanceM` (meters) is never unit-converted. This is the deliberate Phase-2 boundary; Phase 5 unifies when the engine renders those fields.

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Commit / open PR (Phase 1 + 2 on `feat/programs-phase-1-schema`)
- [ ] Proceed to **Phase 3** (instantiation: `instantiate_program_day` + `get_workout` plan overlay)
