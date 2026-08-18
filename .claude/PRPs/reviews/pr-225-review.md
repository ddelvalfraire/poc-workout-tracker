# PR Review: #225 — Storybook for all 45 components + cross-platform token pipeline

**Reviewed**: 2026-08-18
**Branch**: claude/storybook-ui-components-n88dvm -> main
**Decision**: APPROVE with comments (blocked on merge conflict with main)

## Summary

The infrastructure is sound and the token pipeline is the genuinely valuable
part. No security issues, no correctness bugs in shipped app code, and the
"zero pixel change" claim holds up under inspection. The findings below are all
about the *durability* of the design system this introduces — five places where
it can silently start lying.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

**M1 — Nothing verifies the generated Swift or Kotlin is even valid.**
`scripts/build-tokens.ts` has no test of its own. `src/design/tokens.test.ts`
pins the *source* (gamut, duplicates, docs, the volt's hex) but never invokes
an emitter. No Swift or Kotlin compiler runs in this repo, so a malformed
identifier, a broken escape, or a `pascal()` collision would ship unnoticed and
stay unnoticed until the first native dev opens the file. This is the load-
bearing claim of the PR — "the tokens port" — and it is the one thing untested.
*Fix*: snapshot-test `css()`/`swift()`/`kotlin()` output and assert generated
identifiers are unique and syntactically valid per platform.

**M2 — Swift gets seconds, Kotlin gets bare integers.**
`DesignTokens.swift` emits `public static let state: TimeInterval = 0.150` —
self-documenting. `DesignTokens.kt` emits `const val State = 150` with no unit
in the name, the type, or the KDoc. An Android dev has to guess milliseconds,
and guessing wrong is a 1000x animation error.
*Fix*: name it `StateMs`, or emit a `Duration`/`.milliseconds` type.

**M3 — `ghost.stories.tsx` hand-copies StatTile's shell and takes a lint
exception to do it.** Line 62 rewrites `rounded-2xl border border-border
bg-card p-4` rather than rendering `<StatTile>`. The shell now lives in two
places, which is precisely the drift the card-shell ratchet exists to prevent —
and the fix was to widen the ratchet. It also sets a precedent that story files
may opt out of the design contract.
*Fix*: render the real `StatTile` in its pending state, or extract the shell so
both read one definition; then drop the keep-list entry.

**M4 — 9 of 45 story files render differently on every run.**
`streak-chip`, `errors-panel`, `delivery-panel`, `coach-panel`, `panel`,
`activity-log`, `nav-drawer`, `mini-bar-chart`, `coach-chart` all build
fixtures from `Date.now()`. A reference implementation that is not reproducible
cannot carry visual regression — which the project's own testing rules require
at 320/768/1024/1440.
*Fix*: freeze a fixed epoch constant and derive fixtures from it.

**M5 — The server-action alias list is maintained by hand.**
`.storybook/main.ts` hardcodes three module specifiers and instructs the reader
to keep them in sync via grep. A new `'use server'` module under
`src/components/**` is not aliased, so Drizzle, Postgres and Clerk auth land in
the browser bundle. Coverage is currently complete (verified against
`origin/main`), so this is latent, not live.
*Fix*: derive the list, or add a test that greps for action imports and asserts
each is aliased.

### LOW

**L1** — `scripts/build-tokens.ts:115` uses `RADII.find(...)!.value`. If the
token is renamed the script dies with `Cannot read properties of undefined`
instead of naming the missing token. A guarded lookup would fail usefully.

**L2** — `.storybook/mocks/app-actions.ts` uses `console.info` on every stub
call. Intentional for a catalog, and out of the app bundle, but it is the one
place the project's no-console rule is relaxed.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass (clean, after clearing a stale `.next/` built from main) |
| Lint | Pass for this branch — 7 errors + 1 warning all in files it never touches |
| Tests | Pass — 3076 tests, 214 files |
| Build | Pass — `next build` including page-data collection |
| Stories | Pass — 215/215 render with zero console errors |
| Token drift | Pass — CSS, Swift and Kotlin all in sync |

## Verified claims

- **"Zero pixel change"** holds. The palette moved from a hand-written block in
  `globals.css` to an `@import` at the top of the file. `shadcn/tailwind.css`
  defines none of the same custom properties (0 overlapping declarations, 0
  `:root` blocks), so the earlier position in the cascade changes no winner.
- **Alias coverage is complete** against current `main`: the only server-action
  imports under `src/components/**` are the three that are aliased.

## Blocking issue (process, not code)

The PR is `CONFLICTING`. `main` has advanced 30 commits and independently added
`src/components/ui/button.stories.tsx` and `button-group.stories.tsx` — story
files with no Storybook infrastructure to run them. This PR is what makes them
executable, so the conflict must be resolved by reconciling the two button
stories rather than taking either side wholesale.
