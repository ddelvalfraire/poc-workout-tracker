# PR Review: #127 — feat: ops dashboard v2

**Reviewed**: 2026-08-01
**Author**: ddelvalfraire
**Branch**: feat/ops-v2 → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The rebuild is grounded rather than guessed: every deepened endpoint was
probed live before rendering was built on it, which caught three vendor
realities the spec had wrong (Sentry rejects 7d — toggle is 24h|14d;
Langfuse's list endpoint is deprecated — v2 observations adopted with
fields confirmed against live OpenAPI; healthchecks read-only keys expose
unique_key not uuid — flips keyed accordingly). The degrade contract and
fail-closed gate survived the rebuild intact (unconfigured adapters still
provably network-silent), old card component retired with no dead files,
zero new dependencies, and the desktop-first grid follows the spec's
overview→panel structure with anchor-linked status pills.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Both Langfuse endpoints in use carry deprecation notices upstream —
  documented in the adapter headers; the amber-dot canary covers eventual
  removal, and the migration is adapter-local by design.
- App-vitals day buckets are UTC while the user reads local — consistent
  with the cron's documented UTC stance; label if it ever confuses.
- Auto-refresh interval work continues in hidden tabs — negligible for an
  internal page, noted.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 133 files, 1897 tests (ops 31→60) |
| Build | Pass env-absent |
| Live probes | All 200 (status codes only) |
| Migration | None |

## Files Reviewed
- src/lib/ops/{sentry,langfuse,vercel,healthchecks,app-vitals}.ts(+tests) — deepened adapters
- src/lib/ops/time.ts, series.ts (+tests) — pure helpers
- src/components/ops/* — panels, strip, charts, auto-refresh; ops-card deleted
- src/app/ops/page.tsx — 12-col grid, searchParam toggle
