# PR Review: #265 — feat: migrate auth from Clerk to WorkOS AuthKit

**Reviewed**: 2026-08-20
**Author**: ddelvalfraire
**Branch**: feat/workos-authkit → main
**Decision**: REQUEST CHANGES — cannot merge as-is

## Summary

The migration itself is sound: the auth seam, proxy, MCP OAuth port, id-migration script
and UI swap are correct, well-tested and now verified against a live WorkOS environment
(the id migration has already run successfully in production — 68 rows, audited). What
blocks the merge is integration, not the migration: `main` has moved 3 commits ahead with
an i18n foundation that conflicts textually and semantically, and the ported e2e suite
cannot actually sign in.

## Findings

### CRITICAL
None.

### HIGH

**1. The branch does not merge. `main` is 3 commits ahead with real conflicts.**
`gh pr view` reports `mergeable: CONFLICTING`. A trial merge (`git merge --no-commit`)
produces conflicts in `src/app/layout.tsx`, `src/app/settings/page.tsx` and
`package-lock.json`. Note `git merge-tree` reported ZERO conflicts — it was wrong; only an
actual trial merge surfaced them. Both sides edited the same two files for different
reasons: main made the layout async for `next-intl`, this branch made it async for
`withAuth()`; main localized the settings identity row, this branch replaced its
sign-out control.
*Fix*: merge `origin/main` into the branch and resolve deliberately — the layout needs
BOTH `getLocale()`/`NextIntlClientProvider` and `initialAuth`; settings needs the new
`SignOutButton` WITH `t('signOutAction')`.

**2. The e2e suite cannot sign in — 7 of 9 specs will fail.**
The Clerk suite used `clerkSetup()` to fetch a Testing Token that "bypasses bot
protection". AuthKit has no equivalent, and its hosted page runs a `signals` bot-detection
worker that was VERIFIED this session to block an automated browser at the email step.
`e2e/auth.ts` carries its own "UNVERIFIED SELECTORS" warning. The specs are otherwise a
faithful port — assertions preserved verbatim — but they cannot reach them.
*Fix*: skip the hosted page. A dev/test-gated route that mints a session via
`authenticateWithPassword` + `saveSession` was prototyped this session and confirmed
working (signed in, `/settings` and `/welcome` both rendered). That is the mechanism to
productionize, behind a `NODE_ENV !== 'production'` guard.

**3. New i18n lint ratchet will fail on this branch's strings.**
`main` added `i18next/no-literal-string: ["error", { mode: "jsx-text-only" }]`.
`src/components/auth/sign-out-button.tsx:67` renders literal JSX text
(`{isPending ? 'Signing out…' : 'Sign out'}`), which will error once merged.
*Fix*: take the label via props or `useTranslations`, matching main's `t('signOutAction')`.

### MEDIUM

**4. e2e teardown can orphan WorkOS test users.** Every `afterAll` runs DB cleanup then
`deleteTestUser` with no `try/finally`; a throwing SQL statement leaks the user
permanently. Pre-existing pattern, but real. Wrap in `try/finally`.

**5. `scripts/migrate-user-id.ts` has no tests for its guard logic.** `parseArgs` and the
three-branch idempotency/partial-migration decision are pure and untested — the exact
logic whose failure silently corrupts an account across 19 tables. Extract and unit-test.
(The SQL itself is correctly parameterized; no injection risk.)

**6. The "never logs the token" claim isn't pinned.** `authkit-oauth.test.ts:143-156`
asserts `warn` was called but never inspects its arguments, so a regression that appends
the raw token to the log would still pass. Assert the payload shape.

**7. e2e boilerplate duplicated across 6 specs** — identical provisioning/teardown and
"start workout → search bench → Add". A Playwright fixture would make future AuthKit DOM
fixes a one-file edit.

### LOW

**8.** Dead branch in `e2e/auth.ts:109-123` for a single-screen password variant that the
verified DOM shows never occurs.
**9.** Password-step submit locator in `e2e/auth.ts:126-129` is an unexercised guess.
**10.** Redundant cast in `src/db/user-scoped-tables.ts:22-25` — `is(value, PgTable)`
already narrows.
**11.** `src/app/layout.test.ts` is a source-grep guard — a deliberate, documented
tradeoff, but an authenticated e2e assertion would be stronger long-term.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | **Pass** |
| Lint | **Pass for this PR** — 9 errors exist but all in files untouched by it (pre-existing on main) |
| Unit tests | **Pass** — 275 files, 3946 tests |
| Storybook tests | **Pass** — 49 files, 226 tests |
| Production build | **Pass** |
| E2E | **Not run** — cannot sign in (finding 2) |
| Mergeable | **FAIL** — conflicts with main (finding 1) |

## Live verification performed

- WorkOS CLI `doctor`: integration healthy, 11 auth checks passed
- WorkOS CLI `verify-login`: full loop — user creation, password grant, access + refresh tokens
- Signed-out redirect `/` → hosted AuthKit page, in a real browser
- Signed-in `/settings` and `/welcome` render correctly; no reload loop (JS marker survived 15s idle)
- Production id migration: 68 rows moved, 0 residue, 0 duplicates, consent ledger untouched, no timestamp drift

## Note on scope

Every route is now `ƒ Dynamic` because the root layout reads the session. Confirmed NOT to
break public routes (`withAuth()` returns `{user: null}` rather than throwing), but it does
mean legal/share pages are no longer statically prerendered. Acceptable for this app —
worth knowing.
