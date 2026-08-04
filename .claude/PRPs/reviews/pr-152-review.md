# PR Review: #152 — feat: coach polish (UI audit Arc G)

**Reviewed**: 2026-08-03
**Author**: ddelvalfraire
**Branch**: feat/coach-polish → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The approval card was the app's biggest trust gap and the fix is built
to stay correct: the test suite registers the actual patch tools
against a stub server, captures their live zod schemas, and parses
every example input before asserting the sentence — so a tool-schema
change breaks the describe map's tests instead of silently producing
wrong summaries, with a completeness assertion against
COACH_APPROVAL_TOOLS closing the new-tool gap. The honesty rules are
the right ones for a summary derived from input alone: no invented
before-values, cleared-vs-unpinned distinguished, unit echoed only
when the input names it, unknown tools degrade to a named generic
rather than throwing. Timestamps for day separators follow the honest
path — persisted messages had none, so new ones are stamped (client
for user, server via messageMetadata for assistant) and old ones
simply render no separators rather than faking dates. Chips render
only in the safe window (ready, no pending approval, no error). The
starter read is name-only and UUID-validated. The chat's settled
mechanics (follow-scroll, approval gating, offline) were polished
around, not rebuilt.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- First-message "Today" separator suppressed on fresh threads —
  sensible interpretation, documented in the fn.
- Separator month names fixed-English for determinism — matches the
  repo's one-locale rule.
- CoachChat now owns its AppHeader (needs client state for New chat)
  — structural but contained; page passes the drawer as leading.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 179 files, 2499 tests (41 new) |
| Build | Pass |
| Migration | None |

## Files Reviewed
- src/lib/coach/describe-tool-call.ts(+test) — Added
- src/lib/coach/chat-ui.ts(+test) — chips, separators, starters
- src/app/coach/coach-chat.tsx, page.tsx — Modified
- src/app/api/chat/route.ts — messageMetadata stamping
- src/db/programs.ts — getProgramName (documented read)
