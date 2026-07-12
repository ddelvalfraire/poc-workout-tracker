# PR Review: #31 — fix: stand down Up-next hero after training; logger polish; jitter fix

**Reviewed**: 2026-07-08
**Author**: ddelvalfraire
**Branch**: fix/home-hero-and-logger-polish → main
**Decision**: REQUEST CHANGES → resolved (HIGH + MEDIUM fixed in-branch)

## Summary
Reviewer verified against the actual compiled CSS in an isolated worktree — which caught the one real defect. Everything else held: demoted/SessionStatus fully removed, hydration safety, aria-labels carry values, select keeps its focus ring after appearance-none, header rest readout causes no vertical shift, border swap is color-only, isSessionDone and the card predicate share one expression.

## Findings

### CRITICAL
None

### HIGH
- **[FIXED]** `animate-finish-nudge` was a raw class in `@layer utilities`, so Tailwind v4 generated **no** `motion-safe:animate-finish-nudge` rule — the finish nudge was silently dead for all users. Re-registered via `@utility`; compiled output now contains the rule gated behind `prefers-reduced-motion: no-preference` (verified in `.next` output).

### MEDIUM
- **[FIXED]** The 12h trained-window logic was inline in the Server Component, untested — against the repo's own `recent-window.ts` precedent. Extracted as `completedWithinLastHours` (injectable `now`) with 4 tests incl. the exact-boundary and clock-skew cases.

### LOW
None

## Validation

| Check | Result |
|---|---|
| Type check / Lint / Build | Pass |
| Tests | Pass (762; 4 new) |
| Compiled CSS variant rule | Verified present |

## Files Reviewed
app/page.tsx, next-workout-card.tsx, workout-logger.tsx, session-clock.tsx, globals.css, lib/recent-window.ts (+tests).
