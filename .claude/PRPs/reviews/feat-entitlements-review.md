# Review: feat/entitlements (4 commits) → main

**Reviewed**: 2026-08-20
**Branch**: feat/entitlements → main
**Scope**: 37 hand-written files, 3,129 lines (generated Drizzle snapshot and message catalog excluded)
**Decision**: REQUEST CHANGES → **fixes applied, see Resolution**

## Summary

The core model holds up: the ledger/projection split, the fail-to-Free read, and
the clock-checked expiry are each doing what the doc claims. The defects are at
the edges — one in the ops form where React state outlives the member it was
about, one in the grantor where a lookup is not scoped to a user, and a cluster
of smaller gaps around observability and assistive tech.

## Findings

### CRITICAL
None.

### HIGH

**H1 — An armed confirm survives switching to a different member**
`src/app/ops/billing/page.tsx:90`

`GrantForm` carries `armed`, `tier`, `duration` and `reason` in `useState`, and
is rendered at a fixed position in the tree. Searching a different member is a
same-route `?q=` navigation, so React reconciles the same component instance
and the state is preserved.

*Failure*: operator arms "Confirm: grant max, No expiry" for member A, does not
press, searches member B, presses once — member B is granted Max forever, with
member A's reason recorded. This defeats the exact property the two-step
confirm exists to provide.

*Fix*: `key={snapshot.data.user.id}` on `GrantForm`, forcing a remount per
member so no armed state can cross a change of subject.

**H2 — The idempotency lookup is not scoped to the user it locks**
`src/db/entitlements.ts:100–137`

`applyGrant` finds a live grant by `(source, sourceRef, status)` alone. The
advisory lock is taken on `input.userId`, and only `input.userId` is
reprojected.

*Failure*: if a `sourceRef` ever resolves to a different local user — an account
re-map, a support id mix-up, a subscription moved between accounts — the other
user's grant is revoked, their projection is never rewritten, and it keeps
granting a tier whose grant is dead. That is precisely the ledger/projection
divergence the advisory lock is there to prevent, and it happens outside the
lock entirely.

*Fix*: scope the lookup to `input.userId`. A genuine cross-user collision then
hits the partial unique index and fails loudly instead of corrupting quietly.

### MEDIUM

**M1 — `getEntitlement` degrades to Free with no telemetry**
`src/db/entitlements.ts:311`

The bare `catch` is deliberate and correct as a policy, but it is silent. A
paying member dropped to Free by a transient database fault produces no signal
anywhere — the one failure mode most worth alerting on is the one that cannot
be seen.

*Fix*: report the error before returning Free.

**M2 — Arming the confirm is not announced to assistive technology**
`src/components/ops/grant-form.tsx`

The button's accessible name changes on arming, but nothing announces it. A
screen-reader user presses "Grant", hears nothing, presses again — and commits.
The safety control is inverted for exactly the users least able to see it.

*Fix*: an `aria-live="polite"` status region describing the armed state.

**M3 — Email resolution silently stops at 100 users**
`src/lib/ops/entitlements.ts:145`

`listUsers({ limit: 100 })` is WorkOS's page maximum. Paying members outside the
first page get a null email and render as a raw id. It degrades rather than
breaks, but it degrades *more* as the business grows.

*Fix*: page until every wanted id is found, bounded.

**M4 — The minimum-reason length is a magic number in three places**
`grant-form.tsx:58`, `grant-ledger.tsx:69`, `actions.ts:32`

Client and server validate independently against a literal `3`. Project rules
ban magic numbers; here the cost is silent drift between what the form refuses
and what the action refuses.

*Fix*: one exported constant, imported by all three.

### LOW

- **L1** `plan-surface.tsx` still builds `capability.${feature}` as a template
  literal, after the same pattern was deliberately replaced with explicit key
  maps for tiers and durations. It passes the catalog's orphan check only
  because those leaf names happen to be quoted elsewhere.
- **L2** `src/db/entitlements.ts:1–2` — two import statements from `drizzle-orm`.
- **L3** `ApplyGrantResult.deduplicated` is documented as "nothing was written";
  the projection *is* rewritten on that path (intentionally, to heal drift).
- **L4** `grant-form.tsx:73` maps every non-`denied` failure to `errorInvalid`,
  including `notFound`.
- **L5** No upper bound on `reason` length before it reaches a `text` column.

## Validation

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`npm run lint`) | Pass — zero findings in changed files (pre-existing errors elsewhere untouched) |
| Tests (`vitest --project=unit`) | Pass — 4,501 / 336 files |
| Build (`npm run build`) | Pass |
| Migration drift (`db:generate`) | Pass — no drift; `0050` matches schema |
| Storybook tests | **Not runnable in a worktree** — all 59 story files fail on a `node_modules` path resolution error, pre-existing ones included |

## Notes

- Secrets: none introduced. No hardcoded credentials, and no user input reaches
  raw SQL — every `sql` template interpolates column references or bound
  parameters.
- Authorization: both server actions re-assert `isOpsUser` independently of the
  page gate, and neither accepts an actor id from the caller. Covered by tests.
- Test coverage on new code is behavioural rather than incidental: precedence,
  expiry boundaries, dedupe, supersession, and the ops gate each have cases.

## Resolution

All HIGH and MEDIUM findings fixed, plus every LOW, in commit `fix: review
findings`. Re-validated: typecheck, lint, 4,504 tests / 336 files, build, and
migration-drift all pass.

| ID | Fix |
|---|---|
| H1 | `key={user.id}` on `GrantForm` — the form remounts per member, so an armed confirm cannot cross a change of subject |
| H2 | `applyGrant`'s idempotency lookup scoped to `input.userId`; a cross-user `source_ref` now hits the unique index and fails loudly |
| M1 | `getEntitlement` logs before degrading to Free, matching the `console.error` convention in `src/db/reactive-deload.ts` and `volume-progression.ts` |
| M2 | `aria-live="polite"` status announcing the armed step |
| M3 | Directory paging bounded at 10 pages (1,000 users) instead of stopping silently at 100 |
| M4 | `MIN_GRANT_REASON_LENGTH` exported once, imported by form, ledger and action; boundary covered by a test |
| L1 | `CAPABILITY_KEY` map replaces the last template-literal message key |
| L2 | Merged duplicate `drizzle-orm` imports |
| L3 | `deduplicated` doc corrected — the projection *is* rewritten on that path |
| L4 | `notFound` gets its own copy instead of borrowing the invalid-input message |
| L5 | `MAX_GRANT_REASON_LENGTH` (500) bounds the write; covered by a test |

**Decision after fixes: APPROVE.**

Two things remain open and are not defects in this branch:

- Migration `0050` has not been run. `npm run db:migrate` is the operator's call
  — the standing rule is migrate before deploy.
- Storybook tests cannot execute from a git worktree (a `node_modules` path
  resolution failure affecting all 59 story files, pre-existing ones included).
  They should be run from the primary checkout after merge.
