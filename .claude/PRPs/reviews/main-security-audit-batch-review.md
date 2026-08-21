# Review: main 635c903..62b291d — the security-review/audit batch

**Reviewed**: 2026-08-21
**Range**: 635c903 (post-i18n) → 62b291d, ~170 commits, 320 files, +29,951/−4,985
**Decision**: APPROVE (fixes applied for the two actionable findings)

## Summary

Four parallel review passes (security, database, TypeScript lib, React UI) over
the full range. No CRITICAL and no HIGH findings anywhere — the batch's own
security hardening (MCP OAuth pinning, fail-closed gates, purge roster,
tenant scoping, CSP origin sanitization, offline-page injection guard) is
verified present and tested. The two open items from feat-entitlements-review
are closed: Storybook tests ran green from the primary checkout, and the
migrate-before-deploy step is part of this pipeline.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

- **set-row-menu.tsx** — `role="menu"` without arrow-key roving navigation;
  the role promises the ARIA menu keyboard model. **Fixed**: ArrowUp/ArrowDown
  now rove (wrapping) across `menuitem`/`menuitemradio` children.
- **workout-logger.tsx** (weight field) — comments invoke the spinbutton model
  but the input carries no spinbutton ARIA. **Resolved by documentation**: the
  field accepts free text (partial decimals, ghost adoption), which
  `aria-valuenow` cannot represent honestly; the deviation is now documented
  at the `aria-keyshortcuts` site.

### LOW

- **api/cron/reminders/route.ts** — `CRON_SECRET` compared with plain `!==`
  on a public endpoint. **Fixed**: constant-time `timingSafeEqual` with a
  length pre-check.
- `npm audit`: 3 high + 6 moderate, all confined to dev tooling
  (drizzle-kit/esbuild-kit, Storybook's image-size, stryker's qs). Nothing in
  the production bundle. Left for routine dependency bumps.
- drizzle 0050–0052 lack trailing newlines (cosmetic).
- `JBSWY3DPEHPK3PXP` in mfa fixtures is the RFC 6238 example TOTP secret —
  false positive, not a credential.

## Verified clean (highlights)

- Tenant isolation: every new/changed db query userId-scoped; entitlements
  writers serialized per-user via advisory lock; purge roster covers the new
  entitlement tables and is pinned by test.
- MCP OAuth: asymmetric-only algorithms, issuer+audience checked, fails
  closed, token never logged; resolve-user impersonation vector closed.
- Ops/coach/billing gates all fail closed; server actions re-assert access
  independently of page gating.
- Migrations 0050–0052 purely additive; `drizzle-kit check` clean.
- Pen-test harness hard-refuses non-local targets and is not wired into any
  build or deploy path.
- e2e changes introduce no timeout-based waits; the `typeInto` helper closes
  the Base-UI `fill()` silent-no-op bug class suite-wide.

## Validation Results

| Check | Result |
|---|---|
| Type check (tsc --noEmit) | Pass |
| Lint (eslint) | Pass |
| Unit tests (vitest) | Pass — 412 files, 4,974 tests |
| Storybook tests | Pass — 62 files, 280 tests |
| Build (next build) | Pass |
| tokens:check | Pass |
| drizzle-kit check | Pass |
