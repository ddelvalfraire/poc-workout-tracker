# PR Review: #128 — fix: ops errors toggle without page refresh

**Reviewed**: 2026-08-01
**Author**: ddelvalfraire
**Branch**: fix/ops-errors-toggle → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Right fix shape: rather than an authed API route + client fetch, both Sentry
windows join the page's existing parallel batch (one extra top-10 read) and
the toggle becomes pure client state — instant, zero navigation, and the
per-window degrade contract survives because each OpsResult travels intact.
searchParams handling removed from the page entirely (net-negative diff).
Buttons carry aria-pressed; the OpsPanel import chain becoming client code
is presentational-only and build-verified.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Toggle state resets to 24h on refresh/auto-refresh — correct default;
  persist to sessionStorage only if it ever annoys.
- Errors pill in the status strip stays 24h-anchored regardless of the
  panel's local toggle — intentional (the strip is the "now" read).

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 1897 tests |
| Build | Pass |
| Migration | None |

## Files Reviewed
- src/app/ops/page.tsx — dual-window batch, searchParams removed
- src/components/ops/errors-panel.tsx — client toggle
