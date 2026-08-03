# PR Review: #146 — feat: correct back navigation on iOS

**Reviewed**: 2026-08-03
**Author**: ddelvalfraire
**Branch**: feat/back-navigation → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The mechanics are right where it matters most: every failure mode of the
tracker degrades toward the safe branch (replace-to-fallback) rather
than toward a wrong pop — same-pathname under-counting, multi-step
jumps, denied sessionStorage all fail closed. The Navigation API is
used as veto-only, which is the correct polarity: its canGoBack counts
pre-app entries, so trusting a true value would pop users out of the
app on deep links. The synthetic-stack rejection is the review's
standout — investigated against Next 16's actual native-history
semantics (shallow-only integration; a rebuilt parent entry would
carry the child's router tree) and documented as a finding rather than
silently downgraded. Replace-hygiene is scoped honestly: logger
finish/discard become replace with reasons, while conflict-dialog and
guarded starts are audited and kept as pushes with comments (forward
travel, not redirects). The overlay hook pushes history state spreading
Next's existing state (same-URL shallow case — exactly what the
tracker is built to ignore, and the coordination contract is written
down). BackLink preserves exact chevron markup, verified by a
static-render parity test.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Drawer navigate-away leaves one inert same-URL entry (correctness of
  the forward nav prioritized over a ghost-free stack) — documented.
- ?page= pagination is invisible to the pathname tracker — depth
  under-counts, degrading safely to fallback; noted.
- Manual iOS device matrix (spike §4) still owed — WebKit edge-swipe
  can't be unit-tested.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 161 files, 2243 tests (41 new) |
| Build | Pass |
| Migration | None |

## Files Reviewed
- src/lib/back-navigation.ts(+test) — tracker + navigateBack
- src/components/navigation-tracker.tsx, back-link.tsx(+test)
- src/lib/use-history-dismissable.ts(+test) — overlay controller
- src/lib/back-fallbacks.test.ts — table-driven §3c contract
- 12 chevron call sites, workout-logger finish/discard, nav-drawer,
  photo-overlay, root layout — Modified
