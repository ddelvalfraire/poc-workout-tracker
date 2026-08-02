# PR Review: #126 — feat: internal /ops dashboard + spike

**Reviewed**: 2026-08-01
**Author**: ddelvalfraire
**Branch**: feat/ops-dashboard → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Access is the sensitive surface and it's right: fail-closed allowlist →
notFound (the route never admits it exists), middleware keeps signed-out
users at the door, and the settings link renders allowlist-only. The
anti-lock-in claim is structural, not aspirational — the page imports card
shapes, never vendor JSON, and the spike documents verified exit paths per
vendor. Resilience verified in tests: unconfigured adapters provably touch
no network, timeouts abort at 5s, malformed shapes degrade one card only.
Langfuse endpoint confirmed against its docs and works with existing keys.
No secrets rendered; deep links only. No new dependencies.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- /ops renders vendor tokens' DATA to any allowlisted user — fine solo;
  revisit surface review before allowlisting anyone else.
- force-dynamic + 5 upstream calls per view — acceptable for an internal
  page with a manual refresh button; add per-card caching only if it ever
  feels slow.
- Vercel card dormant until VERCEL_API_TOKEN exists — named on the card.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 131 files, 1873 tests (31 new) |
| Build | Pass with all ops env absent |
| Migration | None |

## Files Reviewed
- src/lib/ops/* (+6 test files) — adapters, gate, fetch helper, types
- src/app/ops/page.tsx, components/ops/* — page + cards
- src/app/settings/page.tsx — gated link
- .env.example, .claude/PRPs/prds/ops-dashboard.spike.md
