# PR Review: #101 — feat: program proposals core

**Reviewed**: 2026-07-19
**Author**: ddelvalfraire
**Branch**: feat/program-proposals-core → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The forced-confirm invariant is enforced where it must be: status conditions
live in WHERE clauses (holds under concurrency, not just in checks-then-acts),
adopt/decline are the only exits from 'proposed', clone/restart laundering is
blocked, and nothing in this phase can input status 'proposed' (statusSchema
unchanged). Security-sensitive additions verified: URL metadata rejects
non-http(s) schemes (javascript:/data:), caps enforced, all writes ownership-
scoped. Article header degrades byte-identically when metadata is absent.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Decline's audit event cascades away with the hard delete — documented
  in-code and in the PR; becomes durable if decline ever goes soft-status.
- adoptProgram's sweep runs outside a transaction, mirroring
  setProgramStatus's existing "sweep failure self-heals on next activate"
  discipline — consistent, not new risk.
- Hero image is a plain <img> (remote hosts not allowlisted for next/image) —
  acceptable; URLs are scheme-validated.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 91 files, 1378 tests (~30 new) |
| Build | Pass |
| Migration | Generated only (0021, 5 additive columns); apply via db:migrate at deploy |

## Files Reviewed
- src/db/schema.ts, drizzle/0021_* — columns/migration
- src/db/programs.ts, program-errors.ts(+4 test files) — guards, adopt/decline
- src/lib/program-input.ts(+test) — metadata validation
- src/lib/mcp/program-tools.ts(+test) — guard surfacing, metadata pass-through
- src/app/programs/[id]/page.tsx, proposal-actions.tsx, programs/page.tsx,
  programs/actions.ts, programs/new/program-draft.ts(+test) — UI + actions
