# PR Review: #131 — fix: ops vendor cache

**Reviewed**: 2026-08-01
**Author**: ddelvalfraire
**Branch**: fix/ops-vendor-cache → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The contract survived the caching layer intact — that's the review's main
concern and it holds: unconfigured never caches (the env-var-naming degrade
stays instant and honest), no-Redis passes straight through, every Redis
error fails soft, and stale-on-error only ever upgrades a degrade (a
last-good snapshot with staleAt beats "Unavailable"). TTLs are
quota-derived, not arbitrary (3h = 8/day under Langfuse's 10). Live-verified
both ways pre-merge: a cache hit provably makes no second vendor call, and
the quota-dead endpoint degrades exactly as predicted with no stale seed
yet. Adapter tests pinned to null-Redis for determinism — good hygiene.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Sentry 24h/14d cache independently — a page view costs two Sentry calls
  per 2min window; well inside Sentry's limits, noted only.
- staleAt renders via timeAgo on the client with suppressHydrationWarning
  precedent — consistent.
- The 7d stale window means a vendor outage older than a week degrades to
  Unavailable — correct decay, documented.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 1916 tests (+8 cache; 4 adapter tests hardened) |
| Build | Pass (both ops routes emit) |
| Live | Cache hit verified (no 2nd vendor call); 429 path degrades as designed |
| Migration | None |

## Files Reviewed
- src/lib/ops/cache.ts(+test) — TTL + stale-on-error core
- src/lib/ops/{langfuse,sentry,healthchecks,vercel}.ts(+tests) — wrapped fetchers
- src/lib/ops/types.ts — additive staleAt
- src/components/ops/panel.tsx + 3 panels — as-of rendering
