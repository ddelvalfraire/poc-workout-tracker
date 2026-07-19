# PR Review: #102 — feat: conversational program creation

**Reviewed**: 2026-07-19
**Author**: ddelvalfraire
**Branch**: feat/coach-program-drafting → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The security posture is right: enforcement lives in the db layer keyed on the
bridge-stamped actor (clientId → resolveActor — the model cannot fabricate
it), coach creates are forced to proposed/coach regardless of arguments
(verified: a model-supplied status 'active' is overridden and the event
records the effective status), coach updates gate on own-still-proposed rows
in the WHERE and can never write another status, adopt/decline don't exist as
tools, and the chat card UUID-validates the programId so tool output can't
smuggle an arbitrary href. The no-double-confirm decision (draft tier
auto-runs; the owner banner is the confirm) honors the forced-confirm intent.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- The coach can accumulate multiple undecided proposals across chats; no cap.
  Acceptable v1 — proposals are inert and visibly listed; revisit if clutter
  shows up in practice.
- Granular patch tools remain approval-gated but CAN touch active programs
  (pre-existing flow, unchanged) — the drafting tier does not widen it.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 91 files, 1393 tests (15 new) |
| Build | Pass |

## Files Reviewed
- src/db/programs.ts, program-errors.ts(+save-program tests) — actor-keyed policy
- src/lib/coach/tool-policy.ts(+test) — draft tier, partition intact
- src/lib/mcp/program-tools.ts(+test) — guard surfacing, status echo
- src/lib/coach/chat-ui.ts(+test), src/app/coach/coach-chat.tsx — proposal card
- src/app/api/chat/route.ts — prompt drafting guidance
- src/lib/coach/mcp-bridge(+test) — filter smoke
