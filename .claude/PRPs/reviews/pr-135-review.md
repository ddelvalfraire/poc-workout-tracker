# PR Review: #135 — feat: shared programs tier 1

**Reviewed**: 2026-08-02
**Author**: ddelvalfraire
**Branch**: feat/shared-programs → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
This opens the app's first genuinely public content surface, and the
boundaries hold: authorization is one exhaustively truth-tabled pure module
(45 cells asserted) with SQL ownership as defense-in-depth rather than the
decision; the public read is content-only by construction (result keys
asserted, refusals provably never reach the detail read) with one
constant-shape 404; adopt re-validates at clone time — render-time state
can't be replayed; tokens are 24-byte base64url and rotation is explicit.
The forced-confirm invariant extends across accounts unchanged (adopts land
as proposals attributed to the sharer), clone-resets-private is a documented
deliberate divergence from metadata carry, and copyProgramTree's extraction
kept clone fidelity tests green untouched. Proposals can neither be shared
nor share-managed.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- No rate limit on /p/[token] beyond platform defaults — content is
  program-only and the token space is unguessable; add limits with the
  public directory if it comes.
- "Shared program" attribution (no sharer name) is the resolved v1 —
  revisit with Clerk name plumbing at crews.
- Flipping visibility private→link resumes the same token (documented) —
  correct per "rotate only on explicit revoke," worth knowing.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 147 files, 2063 tests (+48) |
| Build | Pass (/p/[token] emits) |
| Migration | Generated only (0031); apply at deploy |

## Files Reviewed
- src/lib/authz.ts(+test) — the seam
- src/db/program-shares.ts(+test), programs.ts, schema.ts, drizzle/0031_*
- src/app/p/[token]/{page,actions} — public surface
- src/app/programs/[id]/{page,sharing-section}, programs/actions.ts
- src/lib/program-input.ts, mcp/program-tools.ts — threading
- src/proxy.ts(+test) — public matcher
