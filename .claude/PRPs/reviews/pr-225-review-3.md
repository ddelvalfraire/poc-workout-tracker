# PR Review #3: #225 — Storybook + token pipeline (post-fix)

**Reviewed**: 2026-08-18
**Decision**: APPROVE

## Summary

Review #2's findings are closed. The round's most useful outcome was not a
finding at all: opening the nav drawer for the first time crashed, and the
reason it had never been noticed is that six stories rendered the component in
a state that mounts none of its content.

## The crash, and the coverage hole under it

`NavDrawer` renders Clerk's `<UserButton />`, which throws outside a
`ClerkProvider`. Vaul renders the drawer's content in a portal that mounts on
first open, and every story rendered it CLOSED — so the render sweep, the a11y
pass and the 222/222 green all held while the component's entire body was
untested. A story can be green and prove nothing.

Fixed both halves: `@clerk/nextjs` is aliased to a stub (a catalog should not
need a publishable key and a network round-trip), and an `Opened` story clicks
the trigger and asserts on the content behind it. `.storybook/mocks.test.ts`
now fails if a new Clerk import appears without a stub.

The play function caught its own first draft: `findByText("Push A")` wanted an
exact text-node match while the hero renders "Push A · Week 3 · tomorrow".

## Review #2 findings

| # | Finding | Outcome |
|---|---|---|
| N1 | a11y sweep not in the repo | Fixed — `npm run a11y` + committed baseline; both failure directions and exit codes verified |
| N2 | `ownsList` stringly-typed | Fixed — and the augmentation I tried first was decorative (Storybook's `Parameters` has an index signature), so the flag is gone entirely in favour of a typed decorator reference |
| N3 | `__typeCheck` runtime object | Fixed — type-only, re-verified it still fails on drift |
| N4 | `story-time.ts` in the component tree | Left. There is no knip/ts-prune config to flag it, and moving it under `.storybook/` buys ugly relative imports for no current gain |
| N5 | `Radius.xl2` naming | Kept, and the mapping is now stated in both generated files. Rotation is mechanical and reversible; renaming after a native target consumes it is not |

## What the ratchet caught immediately

Simplifying StatTile's `Grid` to lay tiles out in a `<div>` inside the meta
decorator's `<dl>` broke `dlitem`: HTML permits at most ONE `<div>` between
`<dl>` and its `dt`/`dd`, and the tile's shell already spends it. The baseline
flagged it within a minute of existing. Grid owns its list again.

## Self-review of the new code — three defects, fixed

The audit script's throwaway static server bound to `0.0.0.0`, briefly exposing
the build to the LAN; it only ever serves a local browser, so it is loopback
now. Its static-dir guard compared without a trailing separator, so a sibling
path such as `storybook-static-x` would have passed. And `ROOT` came from
`URL.pathname`, which mangles spaces and Windows drive letters.

## Remaining findings

### LOW

**R1 — The baseline records rule IDs, not occurrence counts.** A story that
goes from one contrast failure to five still matches its baseline entry. Rule
-level is the right default (node counts churn on unrelated edits), but the
weakening is worth knowing.

**R2 — The audit sees each story's initial render.** Play-driven states — the
opened drawer, most of all — are not in the ledger. Storybook's a11y panel
checks them interactively. Closing this means waiting on the story's
play-completed phase; worth doing if more play-driven stories land. Documented
in the script.

**R3 — Nothing runs `npm run a11y` automatically.** The repo has no CI at all
(`.github/workflows/` does not exist), so the ratchet is a command someone has
to run. Creating a CI pipeline is a bigger decision than this PR should make;
`npm run a11y` and `npm run tokens:check` are both ready for one.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass — including `.storybook/**` |
| Lint | Pass for this branch — back to the 7 errors + 1 warning that predate it, all in untouched files |
| Tests | Pass — 3811 tests |
| `next build` | Pass — 39 static pages |
| `build-storybook` | Pass |
| Story render sweep | Pass — 223/223, zero console errors, zero blank renders |
| Interactions | Pass — NavDrawer `Opened`, 6 steps |
| a11y ratchet | Pass — 14 known, 0 new; regression and stale detection both verified |
| Token drift | Pass — all four outputs |

## Outstanding, deliberately not in this PR

The 13 pre-existing component a11y violations now recorded in the baseline.
Four are ours and small (contrast on `ConfirmDialog`, `ActivityLog`, `ui/card`;
`aria-label` on plain `<span>` in `BlockMap` and `ErrorsPanel`); the `.tiptap`
ones are third-party. They belong in their own PR, where the baseline shrinking
is the diff.
