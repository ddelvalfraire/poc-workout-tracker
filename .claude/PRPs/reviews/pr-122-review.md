# PR Review: #122 — feat: progress photos

**Reviewed**: 2026-07-31
**Author**: ddelvalfraire
**Branch**: feat/progress-photos → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Security surfaces verified: upload guards ordered auth → shape → cap →
size → magic-byte sniff (extension-spoofing rejected 415); row inserted only
after both blobs land with best-effort cleanup on partial failure; delete is
row-first (the authz proof) then best-effort blobs; signed URLs are short-
lived and minted server-side at RSC render, degrading to placeholder-only
cells on failure; the bucket stays private with the secret key server-only.
The E2EE-ready construction is real, not aspirational: derivatives and
ThumbHash are computed in the browser (canvas re-encode doubles as the EXIF
strip), so a future encrypt step is additive. The review CAUGHT one merge-
blocking defect: thumbhash was added via pnpm without syncing the tracked
npm lockfile — the prod install would have failed; fixed in b522107
(package-lock synced, stray pnpm-lock removed, per the #115 discipline).

## Findings

### HIGH (fixed in-branch)
- package-lock.json missing thumbhash / stray pnpm-lock.yaml — prod build
  breaker; FIXED b522107, tests re-run green.

### CRITICAL / MEDIUM
None

### LOW
- Plaintext ThumbHash is a disclosed 25-byte blur leak — deliberate,
  documented; encrypt it too if E2EE ever lands.
- Plain <img> over next/image for signed URLs — right call (optimizer
  would cache-bust expiring URLs), annotated inline.
- MCP/coach cannot see photos — correct for a privacy surface; revisit
  only with explicit consent design.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 117 files, 1744 tests (49 new), re-verified post-lockfile-fix |
| Build | Pass |
| Migration | Generated only (0027); apply at deploy |

## Files Reviewed
- src/db/schema.ts, drizzle/0027_*, src/db/progress-photos.ts(+test)
- src/lib/photo-input.ts, photo-pipeline.ts, supabase-storage.ts (+tests)
- src/app/api/photos/route.ts, [id]/route.ts (+tests)
- src/app/body/photos-section.tsx, photo-cell.tsx, photo-overlay.tsx, photo-compare.tsx, page.tsx
- package.json/package-lock.json — lockfile fix
