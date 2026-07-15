# Review: Custom Exercises — Phase 2: Source-Aware Drafts (PR #65)

**Reviewed**: 2026-07-15
**Branch**: feat/custom-exercises-source-drafts → main
**Decision**: APPROVE (after the HIGH fix)

## Summary
Composite `(source, id)` identity threaded through the logger pipeline (draft → codec → input → save → reads → UI keys). Reviewer verified wire compatibility both directions (old guard passes unknown fields; absent source defaults 'wger'), false-spread safety, action param ordering at every call site, TanStack prefix invalidation across the widened keys, Map-dedupe order stability, PR-badge semantics, and the non-exported-sync-helper rule in the 'use server' file. 1 HIGH (blocking) + 1 LOW; HIGH fixed pre-merge.

## Findings

### HIGH (FIXED — blocking)
1. **`deriveDayPrescription`'s e1RM anchor never got its composite filter** — the edit was gated mid-batch and its retry hit the wrong sibling, leaving a comment describing a pin that didn't exist. With custom ids being an independent serial (near-certain low-id collisions), a custom exercise's history would blend into a program lift's prescription anchor. Fixed: `r.source === 'wger'` added; the mock rows now carry source and the rpe-target test includes a deliberately colliding 500 kg custom row as a permanent regression tripwire (the suite failed until the fix landed — the filter is provably load-bearing).

### LOW (ACCEPTED)
2. **Mid-deploy resave can relabel a custom draft as wger** — an old client resaving a new-client draft drops the field and the column default applies. Inherent to any additive rollout; single-instance manual deploys make the window minutes wide, and no customs exist in drafts until Phase 3 ships the create UI (after which no old client remains). Documented, not mitigated.

## Validation
| Check | Result |
|---|---|
| tsc --noEmit | Pass |
| eslint (changed files) | Pass |
| Tests | Pass — 72 files / 1061 (6 new + collision tripwire) |
| Build | Pass |
