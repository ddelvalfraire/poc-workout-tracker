# PR Review: #140 — feat: workout share links

**Reviewed**: 2026-08-02
**Author**: ddelvalfraire
**Branch**: feat/workout-shares → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The second public content surface, held to the first one's standard. The
authz seam absorbed a whole new subject with Program cells untouched and a
second exhaustive matrix — the CASL graduation continuing to pay. The
strongest property is structural notes-privacy: the public projection's
TYPES carry no slot for notes/provenance/import internals, backed by
serialized-output absent-string assertions — leak-by-refactor is a compile
error, not a code-review catch. completedAt-non-null gating both view and
manage makes live sessions unshareable by rule, not by UI. Body data
discipline extends into scoring: the owner's bodyweight is never read on
the public path (the BW-set badge divergence is commented at both sites).
Token/revoke semantics identical to program shares; constant-shape 404s;
proxy addition tested.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Public BW-set PR badges score by reps (no bodyweight) and can differ
  from the owner's view — correct trade, documented at both sites.
- programWeek excluded from the public projection (tighter than the PRD's
  list implies) — right call, noted.
- Revoke has no auto-mint (off-switch semantics; fresh token = press Share
  again) — consistent with program shares, documented.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 155 files, 2165 tests (+22) |
| Build | Pass (/w/[token] emits) |
| Migration | Generated only (0033); apply at deploy |

## Files Reviewed
- src/lib/authz.ts(+test) — Workout subject, second matrix
- src/db/workout-shares.ts(+test), workout-errors.ts, schema.ts, drizzle/0033_*
- src/app/w/[token]/page.tsx — public surface
- src/app/workout/[id]/workout-sharing.tsx, workout/actions.ts — owner controls
- src/proxy.ts(+test)
