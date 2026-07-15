# Review: Custom Exercises — Phase 3: Create/Edit UI (PR #66)

**Reviewed**: 2026-07-15
**Branch**: feat/custom-exercises-create-ui → main
**Decision**: APPROVE (after the HIGH fix)

## Summary
Picker-integrated creation (dedup-at-source escape hatch), merged source-labeled search, detail-page editor, action boundary. Reviewer verified the 401/abort degradation of the customs fetch, double-submit protection, generic rankAlternatives inference, route parity, and the editor's self-consistent local state. 1 HIGH (blocking) + 2 MEDIUM; all fixed pre-merge.

## Findings

### HIGH (FIXED — blocking)
1. **Plan-target ghosts/rest-targets leaked across colliding ids** — `planFor` was keyed by bare wger id, so a custom exercise whose serial id matched a program day's plan key would wear that plan's ghost loads and rest targets. Fixed: `planFor(source, id)` returns nothing for customs (plan targets are wger-keyed until Phase 4), both call sites updated — the same guard the swap path already had.

### MEDIUM (both FIXED)
2. **Raw ZodError JSON could reach the form as error text** — parse now goes through a translator producing "Invalid name: …" sentences.
3. **Not-found rode through the duplicate-name translator** — moved outside the try; ownership failures and name collisions no longer share a code path.

### Accepted
- Editor local state can go stale only under a concurrent out-of-band rename while mounted — noted, keyed-remount deferred until it's a real complaint.

## Validation
| Check | Result |
|---|---|
| tsc --noEmit | Pass |
| eslint (changed files) | Pass |
| Tests | Pass — 73 files / 1067 (6 new) |
| Build | Pass |
