# Local Review: wger Exercise Proxy (Phase 2)

**Reviewed**: 2026-06-13
**Scope**: Uncommitted changes on `feat/scaffold-and-infra`
**Decision**: APPROVE with comments
**Status**: ✅ All findings (M1, L1–L3) resolved on 2026-06-14 — see "Resolution" at the end.

## Summary
Clean, well-scoped implementation that matches the plan and the repo's conventions (service-module shape, `globalThis` cache idiom, vitest AAA tests). No security vulnerabilities, no data-loss risk, no blocking issues. A few defensible POC trade-offs are worth recording for the post-POC hardening pass.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

**M1 — External (wger) response cast without runtime validation**
`src/lib/wger.ts:91` — `const data = (await res.json()) as WgerListResponse`.
The upstream payload is trusted via a TypeScript cast, which contradicts the project rule "never trust external data … use schema-based validation" (CLAUDE.md / common/coding-style.md).
- *Mitigation already present*: `mapExercise` defensively guards `category === null` and missing English translation, and any structural surprise (e.g. `results`/`translations` absent) throws and is caught by the route → `502`, not a crash. So malformed upstream degrades safely.
- *Deliberate trade-off*: the plan explicitly chose no Zod (YAGNI, no new dep). Reasonable for a POC.
- *Suggested follow-up (not blocking)*: when Zod or valibot enters the project, add a thin schema parse at the fetch boundary for `WgerListResponse`.

### LOW

**L1 — Pagination follows upstream-provided `next` URLs unconditionally**
`src/lib/wger.ts:97` — `url = data.next`. We follow whatever absolute URL wger returns. The base URL is operator-controlled (env) and wger.de is trusted, and `MAX_PAGES` bounds the loop, so the SSRF surface is negligible. Noted for awareness only. If ever pointed at an untrusted wger instance, this would warrant host-allowlisting.

**L2 — API auth relies solely on Clerk middleware (no in-handler check)**
`src/app/api/exercises/route.ts` — the handler has no `auth()` call; protection comes from `src/proxy.ts`'s matcher. Verified active (build shows middleware on `/api/*`). Acceptable because the response is public reference data with no secrets and no user scoping — even an accidental exposure only relays wger's public catalog. Defense-in-depth (an in-handler `auth()`) is optional and could be added if the matcher ever changes.

**L3 — `parseInt` leniency on `limit`**
`src/app/api/exercises/route.ts:15` — `Number.parseInt('10abc', 10)` yields `10`, so `?limit=10abc` is accepted as `10` rather than rejected. Harmless (value is then clamped to `[1,100]`), purely cosmetic.

## Positives
- Immutability respected: `searchExercises` only uses `.filter`/`.slice` (new arrays); the cached `catalog` is never mutated or returned by reference.
- Error handling is explicit end-to-end: upstream non-ok throws → route returns `502` with a generic message; detailed context goes to `console.error` server-side (no `console.log`, no leak).
- Magic numbers are named constants (`WGER_ENGLISH_LANGUAGE_ID`, `WGER_PAGE_SIZE`, `CACHE_TTL_MS`, `MAX_PAGES`, `DEFAULT_LIMIT`, `MAX_LIMIT`).
- `equipment` correctly kept optional (key omitted when empty), honoring the `equipment?` type.
- Strong test coverage (15 new tests) including the edge cases the plan listed: empty equipment, missing English translation, limit clamp, pagination, cache reuse, upstream error.
- All functions < 50 lines; `wger.ts` is 132 lines (< 800). No `any`. Public APIs have JSDoc.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint .`) | Pass |
| Tests (`vitest run`) | Pass (20/20) |
| Build (`next build`) | Pass (confirmed during implement; `/api/exercises` → ƒ Dynamic) |

## Files Reviewed
- `src/lib/wger.ts` — Added (service + cache)
- `src/lib/wger.test.ts` — Added (10 tests)
- `src/app/api/exercises/route.ts` — Added (GET handler)
- `src/app/api/exercises/route.test.ts` — Added (5 tests)
- `.env.example` — Modified (+`WGER_API_BASE_URL`, optional)

## Recommendation
APPROVE. No changes required before commit. M1/L1–L3 are non-blocking; M1 is the one worth tracking for the post-POC hardening pass (schema-validate the wger payload once a validation lib is in the project).

## Resolution (2026-06-14)
All four findings were fixed in the same change set (no new dependencies). Re-validated: `tsc` clean, `eslint .` clean, **24/24 tests** (4 new), `next build` green.

| Finding | Fix | Where |
|---|---|---|
| **M1** — unchecked external cast | Added `parseListResponse(data: unknown)` to validate the top-level shape (throws on non-object / missing `results` / bad `next`), and reworked `mapExercise(raw: unknown)` to validate every field it reads, dropping malformed records instead of throwing. The blind `as WgerListResponse` cast is gone. | `src/lib/wger.ts` |
| **L1** — followed any `next` URL | Pagination now computes `baseOrigin` from `WGER_API_BASE_URL` and throws `"wger pagination pointed to an unexpected host"` if a page URL's origin differs — only the configured wger host is ever fetched. | `src/lib/wger.ts` |
| **L2** — auth via middleware only | Added a defense-in-depth `auth()` check in the handler returning `401 {error:'Unauthorized'}` before any work, in addition to the existing Clerk middleware. | `src/app/api/exercises/route.ts` |
| **L3** — `parseInt` leniency | `limit` is now parsed only when it matches `^\d+$`; `"abc"` and `"10abc"` resolve to `undefined`. | `src/app/api/exercises/route.ts` |

New tests added: malformed-record drop, invalid-list-object throw, foreign-host pagination refusal (`wger.test.ts`); unauthenticated → 401 and partial-numeric limit ignored (`route.test.ts`).
