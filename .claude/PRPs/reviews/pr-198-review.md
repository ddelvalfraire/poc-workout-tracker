# PR Review: #198 — feat: diet phase joins the batch-patch union; still-cutting staleness card

**Reviewed**: 2026-08-10
**Author**: ddelvalfraire
**Branch**: feat/diet-phase-proposable → main
**Decision**: APPROVE

## Summary
Two-part change riding existing seams: `set_program_diet_phase` becomes a proposable batch op (union + confirm-time apply through the same event-logged setter, now transaction-injectable), and the program page gains the quiet "Still cutting?" ask once a cut's set_at anchor is ≥8 weeks old.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
None

### LOW
- `page.tsx` uses an inline IIFE to compute `weeks` inside JSX; a `const` above the return would read cleaner. Not blocking.
- The card copy always says "weeks" (plural) — safe because it renders only at ≥8 weeks.

## Correctness notes
- Forced-owner-confirm holds: a coach batch carrying the phase op stays an INERT pending proposal until the owner's combined confirm — `propose_program_patches` was already in COACH_DRAFT_TOOLS for exactly this reason.
- The program-level op forks before the `dayPosition` destructure in `applyProposalPatch` (the positionless args would not compile through the shared path).
- `patchForDisplay` passes the loadless op through untouched — no junk `unit` key in approval-card args.
- `setProgramDietPhase` gained optional `runIn` (backward compatible; single existing caller unaffected) so confirm-time application shares the proposal transaction.
- Staleness semantics: only cutting goes stale; no anchor → silence; re-affirming re-stamps set_at because every explicit write stamps — the affirmation IS the clock reset.
- Strict union validation rejects out-of-enum phases and junk keys at propose AND confirm time.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass |
| Tests | Pass (3,034 / 209 files; 8 new across union, apply, staleness) |

## Files Reviewed
- `src/lib/patch-proposal.ts` / `.test.ts` — union member, display passthrough
- `src/db/patch-proposals.ts` / `.test.ts` — confirm-time apply case
- `src/db/program-patches.ts` — injectable runner on setProgramDietPhase
- `src/lib/mcp/program-patch-tools.ts` — propose tool docs
- `src/lib/diet-phase-staleness.ts` / `.test.ts` — staleness brain
- `src/app/programs/[id]/diet-phase-card.tsx` — the ask
- `src/app/programs/[id]/page.tsx` — gate + render
- `src/app/programs/actions.ts` — setDietPhaseAction
