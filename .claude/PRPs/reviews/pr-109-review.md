# PR Review: #109 — feat: plan sync from performance

**Reviewed**: 2026-07-29
**Author**: ddelvalfraire
**Branch**: feat/plan-sync → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The forced-confirm philosophy applied to performance→plan flow. Strongest
property: detection delegates to the engine's own sessionAnchorLoads export,
so the card and autoreg share one implementation of margin/epsilon/floor —
no drift possible. Server action never trusts client numbers (full
recompute), guards ordered auth → ownership → provenance → completedAt →
latest-completed-for-day (stale summaries can't regress the plan, and the
action re-checks at confirm time, not just render time). Writes go through
the existing narrow-patch + event machinery, one event per exercise with
before/after payload, idempotent at both seams, registered in the
completeness test. One-volt rule respected (outline button; Repeat keeps
the page's volt).

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- The rpe-only null-repMin anchor is deliberately broader than the engine's
  snapshot discriminator (a plan row can't be a "missing snapshot") —
  commented and tested; keep the comment if the helper ever unifies.
- Dismiss is client-state only — the card returns on revisit until synced.
  Acceptable: candidates mean the plan is genuinely stale.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 99 files, 1577 tests (30 new) |
| Build | Pass |
| Migration | None |

## Files Reviewed
- src/lib/plan-sync.ts(+test), src/lib/autoregulate.ts — detector + shared export
- src/db/program-patches.ts(+test), program-events-completeness.test.ts — narrow op + events
- src/app/workout/actions.ts(+test), src/db/workouts.ts(+test) — action + latest guard
- src/app/workout/[id]/plan-sync-card.tsx, page.tsx — the confirm card
