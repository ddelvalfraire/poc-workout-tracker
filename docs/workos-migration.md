# Clerk → WorkOS AuthKit: cutover runbook

The code is migrated and green (unit tests + typecheck), and the login loop is
verified against a live staging environment — see "Verified against the live
environment" below. This is the ordered list of what a human still has to do,
and what each step unblocks.

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

## Setup steps

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

- **Applications → Redirects**: register one callback URI per environment, each
  matching that environment's `NEXT_PUBLIC_WORKOS_REDIRECT_URI` exactly, plus
  the matching logout URIs:

  | Environment | Callback URI |
  |---|---|
  | Local | `http://localhost:3000/callback` |
  | Production | `https://poc-workout-tracker.vercel.app/callback` |
  | Preview | `https://<project>-git-<branch>-<scope>.vercel.app/callback` |

  **Do not register a `*.vercel.app` wildcard.** `vercel.app` is a shared public
  suffix: a wildcard there lets anyone else's deployment on that domain receive
  this app's authorization codes. WorkOS's own guidance calls this out.
  Wildcards are only safe on a domain you control
  (`*.preview.yourdomain.com`).

  Per-commit preview URLs are therefore not usable for sign-in, but Vercel also
  gives each BRANCH a stable URL — that one is registerable. Note this pins the
  Preview environment to one branch at a time, because `NEXT_PUBLIC_*` values
  are inlined at build: a second branch needing sign-in wants its own URI
  registered and the Preview variable repointed.
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

### 3b. Update the env vars that store a user id

The script moves database rows. It cannot reach into environment variables, and
three of them hold the id directly:

| Variable | Effect if left on the Clerk id |
|---|---|
| `MCP_DEV_USER_ID` | local MCP calls resolve to a user with no data |
| `COACH_ALLOWED_USER_IDS` | the coach surfaces disappear |
| `OPS_ALLOWED_USER_IDS` | `/ops` 404s |

All three fail CLOSED — you lose access rather than someone else gaining it —
so the symptom is a feature quietly vanishing, not a breach. Update them in
`.env.local` and in Vercel wherever they are set.

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

## Verified against the live environment

Confirmed with the WorkOS CLI (`npx workos@latest`) against the staging
environment:

- `doctor` — integration healthy, 11 auth-pattern checks passed. Its only
  warning is `COOKIE_DOMAIN_NOT_SET`, which is correct to ignore here: the app
  is single-domain, and `WORKOS_COOKIE_DOMAIN` is for sharing a session across
  subdomains.
- `verify-login --client-id <id>` — the whole loop, with a throwaway user
  created and deleted: user creation, **password grant**, and access + refresh
  tokens all pass.
- The signed-out redirect from `/` to the hosted AuthKit page, driven in a real
  browser.
- OAuth metadata advertises `client_id_metadata_document_supported: true` and a
  `registration_endpoint`, so the MCP handshake has what it needs.
- The AuthKit page's sign-in form matches what the e2e helper targets: an
  "Email" label and a "Continue with email" submit button.

`verify-login` is also the answer to provisioning e2e test users — API-created
users authenticate via the password grant, which is what the suite assumes.

## Still unverified

- **The e2e suite has never been executed** against a live WorkOS environment.
  Its sign-in helper is now known to target the right form controls, but the
  full run is still unproven.
- **MCP token verification end to end** — issuer and JWKS are confirmed live and
  RS256-signed, but no real bearer token has been round-tripped through
  `/api/mcp`. The `aud`/Resource Indicator match is the piece to watch.
- **The migration script against real rows** — run the dry run and read the
  counts before committing.
