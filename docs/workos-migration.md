# Clerk → WorkOS AuthKit: cutover runbook

The code is migrated and green (unit tests + typecheck). Nothing below can be
verified until a WorkOS account exists, so this is the ordered list of what a
human has to do, and what each step unblocks.

## The identity decision

**Clerk ids are rewritten to WorkOS ids.** They are not kept and mapped through
WorkOS's `external_id`.

The alternative preserves every existing row untouched, but leaves two id
vocabularies alive forever — in ~19 tables, in the consent ledger that is legal
evidence, and in PostHog's `distinct_id`. Every future reader would have to know
which id they were holding. With a single real user to move, one `UPDATE` per
table is the smaller lasting cost, and afterwards the app knows exactly one kind
of user id.

`scripts/migrate-user-id.ts` performs it, in one transaction, dry-run by default.

## What I need from you

### 1. Create the WorkOS account and application

Then set these in `.env.local` (and in Vercel, for production):

| Variable | Where it comes from | Notes |
|---|---|---|
| `WORKOS_API_KEY` | Dashboard → API keys | `sk_test_…` / `sk_live_…` |
| `WORKOS_CLIENT_ID` | Dashboard → API keys | `client_…` |
| `WORKOS_COOKIE_PASSWORD` | You generate it | `openssl rand -base64 32`; 32+ chars |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | You choose | `http://localhost:3000/callback` locally |
| `WORKOS_AUTHKIT_DOMAIN` | Dashboard → AuthKit | e.g. `https://your-project-12345.authkit.app`; no trailing slash |
| `MCP_RESOURCE_URL` | Your deployed URL | `https://<app>/api/mcp`; optional locally, required in production |

### 2. Dashboard configuration that has no code equivalent

- **Applications → Redirects**: register the callback URI (must match
  `NEXT_PUBLIC_WORKOS_REDIRECT_URI` exactly), plus a logout URI.
- **Connect → Configuration**: enable **Client ID Metadata Document**. That is
  what current MCP clients use, and it is what replaces the static-client DCR
  bypass the Clerk setup needed. Enable DCR too if older clients must keep
  working.
- **Connect → Resource Indicators**: register the MCP server URL
  (`https://<app>/api/mcp`) and set it as the default. Tokens carry it as `aud`;
  if it does not byte-match `MCP_RESOURCE_URL`, every MCP token is rejected.

### 3. Sign in once, then migrate the data

```bash
# 1. Sign in through the app so WorkOS creates the user, then copy its id
#    from Dashboard -> Users. It looks like user_01J...

# 2. Dry run: prints the per-table row counts it WOULD move, changes nothing
npm run db:migrate-user -- --from user_2yourClerkId --to user_01JyourWorkOSId

# 3. Commit it
npm run db:migrate-user -- --from user_2yourClerkId --to user_01JyourWorkOSId --commit
```

The script refuses to run when the target id already owns rows while the source
still has some — that means a half-finished run, and it wants a human.

### 4. Verify, then delete the Clerk side

Only after the app works signed in as the migrated user:

1. Delete the Clerk user from the Clerk dashboard.
2. Remove the Clerk env vars from Vercel (`CLERK_SECRET_KEY`,
   `NEXT_PUBLIC_CLERK_*`).
3. Close the Clerk application/account itself.

The `@clerk/*` packages are already uninstalled on this branch — reverting the
branch is the rollback, not reinstalling them.

## Passwords and social sign-in

Not applicable to a single-user cutover: you sign in to AuthKit once, and the
script moves the data to whatever id that produced. If this ever has to cover
real users, WorkOS imports Clerk's bcrypt digests via `password_hash` plus
`password_hash_type: 'bcrypt'` at user creation, and matches social users by
verified email.

## Still unverified

Everything below compiles and unit-tests, but nothing has touched a live WorkOS
instance:

- The **hosted AuthKit sign-in page's DOM** — the e2e suite drives it by role and
  label, and those locators are the one place to correct if the real page
  differs.
- **MCP token verification end to end** — the JWKS fetch, the issuer, and the
  `aud`/Resource Indicator match are asserted against mocks.
- **The migration script against real rows** — run the dry run and read the
  counts before committing.
- **The visual-regression baselines** — the home header changed (the vendor
  avatar button became a first-party sign-out control), so
  `e2e/visual.spec.ts-snapshots/` will fail until regenerated. Look at the first
  diff deliberately before running `--update-snapshots`; that suite exists to
  catch exactly this kind of change, so a blind regen wastes it.
- **Password sign-in must be enabled** in the WorkOS environment, or the e2e
  suite can provision users it can never sign in as.
