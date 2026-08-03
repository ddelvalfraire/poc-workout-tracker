# PR Review: #139 — feat: share cards

**Reviewed**: 2026-08-02
**Author**: ddelvalfraire
**Branch**: feat/share-cards → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The privacy shape is the review's core concern and it's right: image routes
authed with 401-before-db (tested), private/no-store headers, one
constant-shape 404 across every not-found reason, and the share flow hands
the OS sheet a FILE — no public URL exists to leak, crawl, or replay. The
sparkline approach was runtime-verified against the installed next/og
before being committed to (the kind of check that prevented the #130 class
of mock-blind bug). Data mappers are pure and structurally body-data-free;
units and coarse dates disciplined. Satori's built-in font over bundling
Oswald is an acceptable documented trade.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Cards use system-sans at 800 rather than the app's display font —
  branding trade documented; bundle Oswald bytes later if cards become a
  growth surface.
- Trend week-math has a 1-week floor and whole-series fallback for flat
  trends — honest, tested.
- No card for goals-achieved — natural later addition on the same chrome.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 154 files, 2140 tests (35 new) |
| Build | Pass (3 card routes emit) |
| Migration | None |

## Files Reviewed
- src/lib/cards/chrome.tsx, card-data.ts(+test) — chrome + pure mappers
- src/app/api/cards/{trophy,pr,trend}/**(+tests) — authed routes
- src/lib/share-card.ts(+test), components/share-card-button.tsx
- /trophies, exercise stats header, workout celebration — button wiring
