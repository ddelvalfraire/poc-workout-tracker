# PR Review: #36 — fix: centered confirm modal; trained-today = local calendar day

**Reviewed**: 2026-07-09 · **Branch**: fix/confirm-modal-and-day-semantics → main
**Decision**: REQUEST CHANGES → resolved (fixed in faa0fc1)

## Summary
ConfirmDialog verified end-to-end: m-auto centering (required under Tailwind preflight), closeRef effect timing safe for click-handler use, Esc/backdrop blocked while pending, focus restore, imperative close before every navigation (the #25 invariant), program-actions' statusError/deleteError split, no leftover inline-confirm state, 44px buttons. Local-day gate matches the Done-today hydration precedent; isSameLocalDay semantics identical to the old private helper; completedWithinLastHours fully removed.

## Findings
- **HIGH/MEDIUM [FIXED]**: the gate's feed filtered by `startedAt` (48h), so a weeks-old Unfinished session resumed and finished TODAY escaped trained-today — the hero showed right after training. Window now applies to `completedAt`.
- **LOW (accepted)**: redundant `autoFocus` alongside the explicit focus call (belt-and-suspenders); `aria-label` instead of `aria-labelledby` on the dialog.

## Validation
tsc / lint / build pass; 826 tests at review, 828 on merged main.
