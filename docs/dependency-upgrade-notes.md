# Dependency Upgrade — What Landed, What Didn't, and Why

> Sweep date 2026-08-20, from `origin/main` @ `ca7e263`. 45 packages were
> outdated (7 major, 38 minor/patch). This branch lands 40 of them; the rest are
> deferred with reasons. Every step was verified with `tsc --noEmit`, `lint`, the
> full test suite, and the three generator drift guards.

## Landed

| Commit | What |
|---|---|
| `506858c` | 38 minor/patch bumps within existing ranges (lockfile only) |
| `193d6d0` | Next 16.2.9 → **16.3.1**, React 19.2.4 → **19.2.8** |
| `ca36987` | Dependency misclassification fixes |

Final state: **0 tsc errors, lint clean, 4,862 tests across 401 files green.**

## New work created by these updates

### 1. `experimental.viewTransition` was removed in Next 16.3 — action taken

The key no longer exists on `ExperimentalConfig`, so `next.config.ts` stopped
type-checking. **The feature is not gone**: the App Router runs React's canary
channel, which ships `<ViewTransition>` natively, so
`src/components/page-transition.tsx` keeps working with no opt-in. 16.3 adds
`gestureTransition` and `transitionIndicator`, and neither is a rename of this
one.

Removed the flag and recorded the reasoning in place so nobody re-adds it.
**Worth a runtime smoke check** that route-change animation still plays, since
the app has documented behaviour riding on it (the "`<ViewTransition>` strand"
comments across the programs surfaces, and the reduced-motion disable in
`globals.css:108-113`).

### 2. Playwright browsers need reinstalling after the 1.60 → 1.62 bump

The Storybook browser tests fail with
`Executable doesn't exist … chrome-headless-shell` until
`npx playwright install chromium --only-shell` runs. Not a code change, but it
will bite anyone pulling this branch, and there is no CI to catch it.

### 3. Free wins that need no code change

Next 16.3 is unusually generous for an app that changes nothing:

- **up to 90% less dev-server memory** (disk cache + memory eviction, now default)
- **build-level disk caching**, reported up to 5.5× faster repeat builds
- **~22% more requests under load** — App Router rendering moved off web streams
  onto native Node streams

### 4. Opt-in features worth evaluating separately

Not adopted here; each is its own change:

- **Instant Navigations** (`cacheComponents: true`, `partialPrefetching: true`) —
  SPA-grade navigation, plus an `instant()` Playwright helper for regression
  tests. Directly relevant to the UI/UX review's navigation findings.
- **`catchError`** custom error boundaries that no longer interfere with
  `notFound`/`redirect`, and expose a `retry()` that can re-render failed Server
  Components.
- **Root params** (`import { lang } from 'next/root-params'`) — relevant because
  locale lives on the user here, not in the URL.
- **`experimental.useOffline`** — keeps navigations and actions pending across a
  connection drop instead of throwing, with a `useOffline` hook. This is a gym
  PWA that already ships an offline notice; worth a look.

## Deferred, with reasons

### TypeScript 7 — blocked, do not attempt yet

TS 7.0 (GA July 2026) is the Go rewrite, 8–12× faster. But **the TypeScript
compiler API does not exist in tsgo**; a replacement is slated for 7.1. Anything
doing `import * as ts from 'typescript'` is not guaranteed to work.

This repo has two such consumers:

- **`ts-morph`** — used by `scripts/i18n-extract.ts:33` (the `i18n:report` /
  `i18n:extract` tooling).
- **`@typescript-eslint`** — installed via `eslint-config-next`.

TS 7 also turns TS 6's deprecations into hard errors (`--strict` by default;
`--target es5`, `--baseUrl`, `--moduleResolution node10` removed), and the
recommended path is 5.x → 6 → 7 rather than a direct jump.

**Useful nuance:** Next 16.3 can use TypeScript 7 *for `next build` type checking
only*, via `useTypeScriptCli` — but that still requires `typescript@^7`
installed, which is exactly what ts-morph blocks. Revisit when 7.1 ships the new
API, or if `i18n-extract` is rewritten off ts-morph.

### Vite 8 — blocked by Storybook

Vite 8 (stable March 2026) swaps esbuild+Rollup for Rolldown+Oxc.
`build.rollupOptions` → `build.rolldownOptions` is a mechanical rename, but
Storybook's Vite 8 support is still open upstream and `@storybook/addon-vitest`
has known Rolldown dependency-scanner failures. This repo runs its stories as
real-Chromium Vitest browser tests, so breaking that harness costs more than the
build speed gains. `rolldown-vite` exists as an intermediate step if the speed is
wanted sooner.

### mcp-handler 2 — a real migration, and it touches the auth boundary

Not a version bump. 2.x requires `@modelcontextprotocol/server ^2.0.0`
(**replacing** the `@modelcontextprotocol/sdk` peer), removes the legacy HTTP+SSE
transport (`/sse` and `/message` return 410 Gone), makes `redisUrl` /
`maxDuration` / `sessionIdGenerator` no-ops, drops variadic `server.tool(...)` in
favour of SDK-v2 `registerTool` with Standard Schemas — and **moves
`extra.authInfo` to `ctx.http?.authInfo`**.

That last one is the tenant-isolation seam: `src/lib/coach/mcp-bridge.ts:32-40`
binds `authInfo.extra.userId` from the session, and `src/lib/mcp/resolve-user.ts`
reads the token subject from it. The security audit flagged this wrap as
load-bearing. Upstream guidance is explicit: stay on mcp-handler 1.x while on
SDK 1.x.

This is also why `@modelcontextprotocol/sdk` is held at 1.26.0 —
`mcp-handler@1.1.0` pins it **exactly** as a peer. Bumping the SDK alone triggers
an ERESOLVE peer override, and was reverted.

### @types/node 26 and Stryker 10 — safe but unbundled

Both are low-risk (Stryker 10 needs Node 22+; local is 25) and neither ships to
users. `@types/node` should be chosen to match the deployed runtime rather than
"latest" — `package.json` declares no `engines` field, so the target Node version
is currently implicit. Worth pinning `engines` in the same change.

## Two things this sweep surfaced that aren't dependencies

- **ESLint 9 is end-of-life.** npm now prints
  `eslint@9.39.5: This version is no longer supported`. v10 requires Node ≥20.19
  (fine), is flat-config-only (this repo already uses `eslint.config.mjs`), and
  the installed plugins are compatible: `eslint-plugin-better-tailwindcss`
  already declares `^10.0.0`, `eslint-config-next` peers `>=9.0.0`, and
  `eslint-plugin-i18next` sets no constraint. A `@eslint/v9-to-v10` codemod
  exists. **This is the next upgrade to do**, and it should be its own branch.
- **There is no CI.** No `.github/workflows` exists, so nothing enforces `tsc`,
  `lint`, `test`, or the four `*:check` drift guards on a PR — and nothing would
  have caught the Next 16.3 type error before a deploy. `npm run deploy` chains
  `db:check` only. Standing up CI is arguably higher value than any remaining
  upgrade.
