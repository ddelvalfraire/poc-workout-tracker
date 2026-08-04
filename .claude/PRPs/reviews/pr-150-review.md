# PR Review: #150 — feat: alive rows (UI audit Arc D)

**Reviewed**: 2026-08-03
**Author**: ddelvalfraire
**Branch**: feat/alive-rows → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The three truth-or-nothing calls all landed on truth. Template linkage
is a documented name-match heuristic (workouts carry no template id;
templateToDraft seeds the name) that breaks honestly on rename rather
than faking provenance. wger adopted-state is real provenance —
programs.source_url written at import, exact-URL matched — not a
lookalike heuristic. And the exercise-stats extension preserves the
single scoring truth: SQL ships raw set fields while e1RM derivation
stays in bestScoredSet/effectiveLoadKg, honoring the logging-type
weight-semantics memory (bodyweight types included); the raw-SQL rule
was followed with a live-DB smoke (34 entries, 630ms, honest
trendDelta nulls when the account's history sits inside one window).
Zoning semantics are defensible — dormancy unconditionally beats an
old PR, so MOVING can't be faked by stale achievements — and volt is
spent only on the up-delta. Facet is genuinely free (the in-memory
catalog resolver), URL-stated, and degrades silently on junk params.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Template name-match is case-sensitive exact — the strictest honest
  reading; loosen only if real usage shows friction.
- /templates gained one cached preference read (getWeightUnit) for
  unit-aware volume lines — bounded, noted.
- SQL-shape test lives in a separate file because the sibling test
  mocks ./index — pragmatic, documented.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 175 files, 2418 tests (35 new) |
| Build | Pass |
| Migration | None (query extension only; live-DB smoked) |

## Files Reviewed
- src/db/exercise-stats.ts(+tests incl. query-shape) — Modified
- src/lib/exercise-library.ts(+test), template-usage.ts(+test),
  wger-template-shelf.ts(+test) — Added
- src/app/exercises/page.tsx, library-filter.tsx — Modified
- src/app/templates/page.tsx, [id]/page.tsx, template-edit-sheet.tsx
- src/app/programs/templates/page.tsx, [id]/page.tsx — Modified
