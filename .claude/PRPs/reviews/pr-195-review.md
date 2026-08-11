# PR Review: #195 — feat: link trained-today hero to the day's session, de-chip the quiet CTAs

**Reviewed**: 2026-08-10
**Author**: ddelvalfraire
**Branch**: feat/trained-today-session-link → main
**Decision**: APPROVE

## Summary
Small, focused UI change: the trained-today hero state gains a quiet link to the day's completed workout, and the Log more / Quick log CTAs move from an outline chip to the hero's established muted-link vocabulary. Zero new queries (id rides the existing summaries read); the home-status brain is untouched.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
None

### LOW
- `src/app/status-hero.tsx:220` — the new links use `w-fit` while the older quiet links (Browse programs, See results) span full width. `w-fit` is the better behavior (no invisible full-width tap area); consider back-porting it to the older links in a future housekeeping pass rather than blocking here.
- No component test for StatusHero exists (pre-existing; the state brain is fully covered in `home-status.test.ts`). Visual states are the manual check in the PR test plan.

## Correctness notes
- When `trained-today` is selected, `lastCompleted` is guaranteed to be today's session: `recentCompletedAtTimes` and `byCompletion` derive from the same summaries, and the newest completion sorts first. The `props.lastCompleted &&` guard covers the theoretical null.
- `GuardedStartLink` renders link and button with identical caller classes, so the guarded (live-session) render keeps the same quiet-link look.
- Chevron icons are `aria-hidden`; link text carries the accessible name.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass (`tsc --noEmit`) |
| Lint | Pass (eslint on touched files) |
| Tests | Pass (3,020 / 207 files) |
| Build | Skipped locally (validated by Vercel production build at deploy) |

## Files Reviewed
- `src/app/page.tsx` — Modified (adds `id` to `lastCompleted`)
- `src/app/status-hero.tsx` — Modified (session link + quiet-link CTAs)
