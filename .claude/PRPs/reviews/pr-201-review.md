# PR Review: #201 — feat: visual-regression screenshot suite; fix NavDrawer SSR window crash

**Reviewed**: 2026-08-10
**Author**: ddelvalfraire
**Branch**: feat/visual-regression-suite → main
**Decision**: APPROVE

## Summary
Five committed baselines over the deterministic fresh-account surfaces, plus a real SSR bug fix the suite caught on its first verification run. The bundling is justified: the suite is not stable without the fix.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
None

### LOW
- The program-template-library baseline depends on the seeded canon — a seed-script change legitimately regenerates it (documented in the spec comment).
- Baselines are darwin/chromium-specific (`-chromium-darwin.png`); running on CI Linux would need its own baselines. Fine for the current local-only e2e workflow.

## Correctness notes (SSR fix)
- `useState` initializers run during SSR; the `typeof window` guard makes the server value null while client hydration re-runs the initializer and gets the real controller. Effects are browser-only, so every effect sees the instance; `dismissForNavigation` no-ops only in the discarded server pass.
- Behavior pinned by the hook's existing 10 tests (all green, unchanged).
- This also removes a production defect: every NavDrawer page was silently downgrading from SSR to client rendering.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Unit tests | Pass (3,037 / 210 files) |
| Visual suite | Baselines regenerated post-fix; two consecutive runs green |

## Files Reviewed
- `e2e/visual.spec.ts` — Added
- `e2e/visual.spec.ts-snapshots/*` — 5 baselines
- `src/lib/use-history-dismissable.ts` — SSR-safe controller init
