# PR Review: #106 — fix: coach chat scroll + payload + tool status

**Reviewed**: 2026-07-20
**Author**: ddelvalfraire
**Branch**: fix/coach-chat-scroll-tools → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Both root causes verified before the fix was written (per-chunk forced
scroll; full-thread POSTs vs 120KB/60-message caps). The listener-over-
IntersectionObserver choice is correctly reasoned (growth moves the sentinel
without scroll events → an observer would unpin mid-stream). The
reconciliation contract is tight: append user tail, replace matching
assistant tail (approval continuation), 400 on anything else; model window
clamps by slicing; store load is shape-only so it tolerates what save wrote;
legacy body shape still accepted for pre-deploy tabs; reconciliation ordered
before rate-limit preserving the rejects-never-consume-quota invariant. Tool
detail lines whitelist string fields only — no raw JSON reaches the UI.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- New-shape requests add one Redis read before the quota check — deliberate
  ordering, marginal cost.
- An out-of-sync tab (assistant tail not matching stored) gets a reload
  message rather than self-healing — acceptable; the store is authoritative.
- MAX_BODY_BYTES kept at 120KB purely for the legacy path; can shrink once
  pre-deploy tabs age out.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 97 files, 1501 tests (21 new) |
| Build | Pass |

## Files Reviewed
- src/app/coach/coach-chat.tsx — pinned scroll, transport tail-send, chips
- src/app/api/chat/route.ts — dual-shape body, reconcile, window clamp
- src/lib/coach/chat-request.ts(+test) — split validation, 32KB tail cap
- src/lib/coach/chat-thread.ts(+test) — pure reconcile
- src/lib/coach/chat-store.ts(+test) — tolerant load
- src/lib/coach/chat-ui.ts(+test) — phase labels, input detail, pinned math
