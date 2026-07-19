# PR Review: #103 — feat: wger public-template import

**Reviewed**: 2026-07-19
**Author**: ddelvalfraire
**Branch**: feat/wger-template-import → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Research-first implementation against verified live endpoints. External-data
boundary handled correctly: host pinning on the fetch layer, shape validation
on responses, and every import round-trips parseProgramInput (the trust
boundary) before persistence — malformed upstream data cannot reach the db.
Owner-initiated adds land as draft (no forced confirm — proposals govern
non-owner authorship, which this is not). Attribution (sourceUrl to the CC
routine) is written on every import. Actor unions widen without migration.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Browse fetches full structures at list time (N+1 upstream) — daily-cached
  and bounded (≤50); revisit only if the catalog grows.
- Mapper skip-notes not yet surfaced post-import — tracked follow-up.
- Untested against live payloads until a WGER_API_KEY exists — unconfigured
  state verified instead; manual dogfood pending the key.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 93 files, 1422 tests (27 new) |
| Build | Pass |
| Migration | None (text value-space widening only) |

## Files Reviewed
- src/lib/wger-templates.ts(+test) — authed fetch, pinning, caching
- src/lib/wger-template-map.ts(+test) — pure mapper + clamps + skip-notes
- src/app/programs/templates/* — browse + import action
- src/db/programs.ts, program-events.ts, schema.ts — 'wger' actor
- src/app/programs/page.tsx, [id]/page.tsx — links/labels
- .env.example — WGER_API_KEY doc
