# PR Review #2: #225 — Storybook + cross-platform token pipeline (post-merge)

**Reviewed**: 2026-08-18
**Branch**: claude/storybook-ui-components-n88dvm -> main (MERGEABLE)
**Decision**: APPROVE with comments

## Summary

Review #1's five MEDIUM findings are closed, and chasing M1 turned up a real
defect: the generated Swift and Kotlin never compiled. Coverage now extends to
the two components main added. Four new findings below, all LOW/MEDIUM, plus
the standing report of pre-existing component a11y violations that the catalog
now makes visible.

## What review #1 found, and what happened

| # | Finding | Outcome |
|---|---|---|
| M1 | Emitters untested | Fixed — and it was hiding a real bug (below) |
| M2 | Kotlin durations unitless | Fixed — `StateMs`, guarded by test |
| M3 | ghost.stories duplicated StatTile's shell | Fixed — shell exported and shared; keep-list exception removed |
| M4 | 9 stories non-deterministic | 7 frozen; 2 documented exceptions (below) |
| M5 | Alias list hand-maintained | Fixed — enforced by test, plus compile-time signature checks |
| L1 | Non-null assertion in generator | Fixed — named error |
| L2 | console.info in mocks | Kept, intentional |

### The defect M1 was hiding

`radius-2xl` loses its prefix and becomes `2xl`. Neither Swift nor Kotlin
permits an identifier starting with a digit, so `public static let 2xl` and
`val 2xl` were syntax errors in both generated files from the day the pipeline
landed. The PR's central claim — that the tokens port to native — was false for
any consumer that tried to compile them. Nothing caught it because no native
toolchain runs in this repo and no test exercised the emitters.

Leading digits now rotate (`2xl` -> `xl2`), and `scripts/build-tokens.test.ts`
stands in for `swiftc`/`kotlinc`: identifier validity and uniqueness per
platform, brace balance, determinism, unused-token withholding, and the Kotlin
duration unit convention. **The web CSS is byte-identical** — this only ever
reached native.

### Two determinism exceptions, deliberate

`StreakChip` and `NavDrawer` read the real clock internally by design (local
calendar semantics). Freezing their fixtures does not just look stale — it
makes `StreakChip` compute a zero streak, and it renders `null` for zero, so
the story would show nothing at all. Both keep real time with the reason
recorded in the file.

## New findings

### MEDIUM

**N1 — The a11y sweep that found these issues is not in the repo.**
The axe pass over all 222 stories was an ad-hoc script. `@storybook/addon-a11y`
gives the interactive panel, but nothing fails CI, so the three harness fixes
here can silently regress and the 13 pre-existing violations have no ratchet.
*Suggested*: wire the Storybook test-runner's a11y check into CI with the
current violations as a baseline, so the count can only go down.

**N2 — `ownsList` is a stringly-typed story parameter.**
`stat-tile.stories.tsx` and `note-row.stories.tsx` opt out of their meta
decorator via `context.parameters.ownsList`. A typo silently does nothing and
the invalid-nesting violation comes back. Storybook supports module
augmentation of the parameter type; worth doing if this pattern spreads.

### LOW

**N3 — `__typeCheck` is a runtime object serving a compile-time purpose.**
`.storybook/mocks/app-actions.ts` exports a const purely to host the `satisfies`
clauses. It works and it is confined to a Storybook-only module, but it is a
value that exists to be erased.

**N4 — `src/components/story-time.ts` is story-only code in the component tree.**
Nothing in the app imports it. Correct behaviourally; a future `knip`/`ts-prune`
sweep will flag it as dead.

**N5 — `Radius.xl2` reads awkwardly** for the `radius-2xl` token. It is valid
and consistent, but the native devs may prefer `radius2xl`. Cheap to change
before anyone consumes it; expensive after.

## Pre-existing component issues the catalog now exposes

Not introduced by this PR and not fixed in it — surfacing them is the point of
the catalog. 13 violations across three rules:

- **color-contrast** (7): `ui/card` footer on `bg-destructive/10`;
  `ConfirmDialog` destructive/error/long-body variants; `ActivityLog`'s
  `violet-500/10` chips.
- **aria-prohibited-attr** (6): `aria-label` on plain `<span>` in `BlockMap`
  (`"Week 1, 4 of 4 days done"`) and on the `ErrorsPanel` level dot; the
  TipTap-rendered `.tiptap` surface in both editors.

The `.tiptap` ones are third-party; the other four are ours and are small fixes.
Worth their own PR.

## Also found while reviewing

**`.storybook/` was never typechecked.** TypeScript's `**` glob does not match
dot-directories, so the entire Storybook tree sat outside `tsc --noEmit`. Adding
it immediately surfaced `background:` in `theme.ts` — not a key the theme API
accepts, silently inert. It also meant the new mock-fidelity guard was
decorative; with the directory in the program the guard bites (verified by
breaking it deliberately), and it caught a live drift where
`startProgramDayAction` had gained a `week` parameter and return field that the
stub did not have.

**The manager theme restated the palette by hand** (nine values, acknowledged in
its own comment). `build-tokens` now emits `src/design/tokens.generated.ts` with
the palette resolved to sRGB, and the theme reads it — so the catalog's own
chrome cannot drift from the palette it exists to demonstrate.

**UTC fixtures were formatted in local time** in three chart stories, so west of
Greenwich every axis label sat a day off its own data (Mar 2 rendering as
Mar 1). Now formatted in UTC.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass — now including `.storybook/**` |
| Lint | Pass for this branch — 7 errors + 1 warning all in untouched files |
| Tests | Pass — 3810 tests, 258 files |
| `next build` | Pass — re-run after the tsconfig change |
| `build-storybook` | Pass |
| Story render sweep | Pass — 222/222, zero console errors, zero blank renders |
| Token drift | Pass — all four outputs |
| Bundle safety | Pass — no drizzle/postgres/@clerk/backend in `storybook-static` |
