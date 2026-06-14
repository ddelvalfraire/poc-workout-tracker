# Plan: wger Exercise Proxy (`/api/exercises`)

## Summary
A Next.js App Router route handler (`GET /api/exercises`) that returns a searchable, typed list of exercises sourced live from the wger public API — mapped to `{ id, name, category, equipment? }`. Because wger exposes no server-side text-search endpoint anymore, the proxy fetches the full English exercise catalog once (2 upstream requests), caches it in memory, and filters by `search`/`category` in our own code. This dodges CORS, keeps the wger base URL server-side, and gives instant typeahead for the Phase 3 exercise picker.

## User Story
As a signed-in lifter building a workout,
I want to search a real exercise database by name,
So that I can add the exercise I'm doing without maintaining my own exercise list.

## Problem → Solution
The app needs exercise reference data but hosts none, and wger's API has CORS + no stable client-side search. → A server-side proxy route fetches wger's catalog once, caches it, and serves a small typed, filterable list to our own UI.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/workout-tracker-pwa.prd.md`
- **PRD Phase**: Phase 2 — wger exercise proxy
- **Estimated Files**: 6 (4 create, 2 update)

---

## UX Design

### Before
N/A — internal/backend phase. No user-facing UI is built here; this route is consumed by the Phase 3 exercise picker.

### After
```
GET /api/exercises?search=bench&limit=20
  → 200 [ { "id": 73, "name": "Bench Press", "category": "Chest",
            "equipment": ["Barbell"] }, ... ]
```

### Interaction Changes
Internal change — no user-facing UX transformation in this phase.

---

## ⚠️ Critical Research Findings (READ FIRST)

The PRD's Open Question #1 ("`/api/v2/exercise/search/` vs `/exerciseinfo/`") is now **resolved by live testing against wger.de on 2026-06-13**:

1. **`/api/v2/exercise/search/` WAS REMOVED IN wger 2.5.** It existed through wger 2.4 (`path('api/v2/exercise/search/', exercises_api_views.search, name='exercise-search')` is present in tags 2.0–2.4) and is still described in older docs/tutorials, but it was deleted in 2.5. The public `wger.de` instance runs `2.6.0a2` (per `GET /api/v2/version/`), so the endpoint returns `404 {"detail":"Not found."}` for every language/param combination (`?term=…&language=english`, `language=en`, `language=2`). There is no `search` view or `exercise/search/` route in current source. **Do not use it** — and disregard any blog/tutorial/doc that still shows it; those predate 2.5.
2. **`/api/v2/exerciseinfo/` is the live, documented-as-recommended endpoint.** It returns one object per exercise *base*, with nested `category`, `equipment`, and `translations`.
3. **There is NO server-side free-text search.** `?term=`, `?search=`, and `?name__icontains=` are ignored; `?name=` is exact-match only. Therefore **search must happen in our proxy** over a cached catalog.
4. **English `language` id = `2`.** Passing `?language=2` filters each result's `translations` array to English only and excludes exercises with no English translation.
5. **Max page size is 999.** The full English catalog is `count: 1275`, so the entire catalog is **2 paginated requests** (`limit=999`, follow `next` once). Cheap enough to cache wholesale.
6. **The endpoint is open (no auth/key needed)** and works with a plain `Accept: application/json` GET.

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 (critical) | `src/db/workouts.ts` | 1-36 | The project's "service/data-access module" shape, doc-comment style, named exports — mirror this for `src/lib/wger.ts` |
| P0 (critical) | `src/db/index.ts` | 1-14 | The exact in-memory caching idiom used in this repo (module-level singleton via `globalThis`, guarded by `NODE_ENV`) — mirror for the exercise cache |
| P0 (critical) | `src/lib/env.ts` | 1-8 | `requireEnv` helper; the wger base URL is *optional with a default*, so it does NOT use `requireEnv` — but read this to match env conventions |
| P1 (important) | `src/db/workouts.test.ts` | 1-25 | Vitest structure: `describe`/`it`/`expect`, AAA, named constants at top — mirror for both new test files |
| P1 (important) | `src/db/schema.test.ts` | 1-16 | Second example of the test idiom in this repo |
| P1 (important) | `src/proxy.ts` | 1-17 | Clerk middleware — confirms `/api/(.*)` is already auth-protected (see GOTCHA in Task 2) |
| P2 (reference) | `vitest.config.ts` / `vitest.setup.ts` | all | Test env is `node`; `@/*` alias is wired; setup only stubs DB env vars |
| P2 (reference) | `.env.example` | 1-14 | Env-var documentation style to extend |
| P2 (reference) | `tsconfig.json` | paths | `@/*` → `./src/*` import alias |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| wger exerciseinfo endpoint | `https://wger.de/api/v2/exerciseinfo/?language=2&format=json` | Returns `{ count, next, previous, results[] }`; each result has `id`, `category:{id,name}`, `equipment:[{id,name}]`, `translations:[{name, language, ...}]` |
| wger languages | `https://wger.de/api/v2/language/` | English = id `2`, German = id `1` |
| wger API root | `https://wger.de/api/v2/` | Lists live endpoints; note absence of any `search` route |
| Next.js Route Handlers | App Router `app/api/*/route.ts` | Export named `GET(request: Request)`; GET handlers are dynamic by default — fine, we cache internally |

---

## Patterns to Mirror

Code patterns discovered in the codebase. Follow these exactly.

### MODULE_DOC_COMMENT + NAMED_EXPORTS (service module shape)
```ts
// SOURCE: src/db/workouts.ts:1-36
import { and, desc, eq } from 'drizzle-orm'
import { db } from './index'
import { workouts } from './schema'

/**
 * Data access for workouts, always scoped to a Clerk userId.
 * ...explains the module's responsibility and the invariant it guarantees...
 */

/** Lists a user's workouts, most recent first. */
export function listWorkouts(userId: string) {
  return db.select().from(workouts).where(eq(workouts.userId, userId)).orderBy(desc(workouts.startedAt))
}
```
→ `src/lib/wger.ts` gets the same treatment: a module doc-comment explaining "live proxy + cache, no exercise mirror", then small, individually doc-commented named exports.

### IN_MEMORY_SINGLETON_CACHE (mirror the DB client caching idiom)
```ts
// SOURCE: src/db/index.ts:9-12
// Reuse the connection across dev HMR reloads so we don't exhaust the pool.
const globalForDb = globalThis as unknown as { dbClient?: ReturnType<typeof createClient> }
const client = globalForDb.dbClient ?? createClient()
if (process.env.NODE_ENV !== 'production') globalForDb.dbClient = client
```
→ The exercise catalog cache uses the same `globalThis` singleton pattern (so it survives dev HMR), plus a TTL timestamp.

### ENV_ACCESS (optional-with-default, NOT requireEnv)
```ts
// SOURCE: src/lib/env.ts:2-8  (requireEnv is for REQUIRED vars)
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}
```
→ The wger base URL is OPTIONAL (defaults to `https://wger.de/api/v2`), so do **not** call `requireEnv`. Use `process.env.WGER_API_BASE_URL ?? DEFAULT_BASE`. Document the override in `.env.example`.

### TEST_STRUCTURE (vitest, AAA, top-level constants)
```ts
// SOURCE: src/db/workouts.test.ts:1-25
import { describe, it, expect } from 'vitest'
import { listWorkouts, getWorkout, createWorkout } from './workouts'

const USER = 'user_123'

describe('workouts repository (authorization boundary)', () => {
  it('scopes list queries to the user', () => {
    const { sql, params } = listWorkouts(USER).toSQL()
    expect(sql).toContain('"user_id"')
    expect(params).toContain(USER)
  })
})
```
→ Both new test files use `describe`/`it`/`expect`, descriptive behavior-named `it()` strings, and constants at the top.

### TYPESCRIPT_TYPES (explicit on public API, `interface` for object shapes, string-literal unions, no `any`)
```ts
// SOURCE: rules/typescript/coding-style.md — explicit return/param types on exported fns; interface for shapes
export interface Exercise {
  id: number
  name: string
  category: string
  equipment?: string[]
}
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/wger.ts` | CREATE | wger service: types, base-URL/constants, paginated catalog fetch + map, in-memory cache, `searchExercises()` |
| `src/lib/wger.test.ts` | CREATE | Unit tests for mapping, English-name selection, empty-equipment omission, case-insensitive search, category filter, cache reuse, upstream-error propagation |
| `src/app/api/exercises/route.ts` | CREATE | `GET` route handler: parse query params, call service, return JSON, map errors to HTTP status |
| `src/app/api/exercises/route.test.ts` | CREATE | Unit tests for the handler: param parsing, success array JSON, error → 502 (wger module mocked) |
| `.env.example` | UPDATE | Document optional `WGER_API_BASE_URL` override |
| `.claude/PRPs/prds/workout-tracker-pwa.prd.md` | UPDATE | Mark Phase 2 status `pending` → `in-progress`; link this plan |

## NOT Building

- **No exercise mirror / DB table** — exercises are fetched live and only their wger id + name are persisted later (Phase 3), never the catalog.
- **No exercise images/thumbnails** — PRD leans "name + category only"; `equipment` is the only extra we surface.
- **No detail/`exerciseinfo/{id}` passthrough** — list/search only; Phase 3 stores the denormalized name at add-time.
- **No client-side fetching/hook** — the picker UI that consumes this route is Phase 3.
- **No pagination of OUR response** — we return a capped list (`limit`, default 50); the consumer narrows via `search`.
- **No Zod dependency** — not currently installed; query-param parsing is hand-validated (YAGNI; don't add a dep for two params).
- **No German / multi-language support** — English (`language=2`) only for the POC.
- **No rate-limiting / retries / circuit-breaker** on the upstream — the wholesale cache already makes upstream calls rare.

---

## Step-by-Step Tasks

### Task 1: Create the wger service module (`src/lib/wger.ts`)
- **ACTION**: Create `src/lib/wger.ts` exporting the `Exercise` type, `searchExercises()`, and a test-only `clearExerciseCache()`.
- **IMPLEMENT**:
  - Constants:
    ```ts
    const WGER_BASE_URL = process.env.WGER_API_BASE_URL ?? 'https://wger.de/api/v2'
    const WGER_ENGLISH_LANGUAGE_ID = 2
    const WGER_PAGE_SIZE = 999            // wger's max page size (catalog ~1275 → 2 pages)
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000  // exercise list changes rarely
    const MAX_PAGES = 20                  // safety bound on the pagination loop
    const DEFAULT_LIMIT = 50
    const MAX_LIMIT = 100
    ```
  - Public types:
    ```ts
    export interface Exercise {
      id: number
      name: string
      category: string
      equipment?: string[]
    }
    export interface SearchOptions {
      search?: string
      category?: string
      limit?: number
    }
    ```
  - Upstream (private) types — only the fields we read:
    ```ts
    interface WgerTranslation { name: string; language: number }
    interface WgerExerciseInfo {
      id: number
      category: { id: number; name: string } | null
      equipment: { id: number; name: string }[]
      translations: WgerTranslation[]
    }
    interface WgerListResponse { next: string | null; results: WgerExerciseInfo[] }
    ```
  - `mapExercise(raw: WgerExerciseInfo): Exercise | null` — pick the English name via `raw.translations.find(t => t.language === WGER_ENGLISH_LANGUAGE_ID)?.name`; return `null` if no name or no category (caller filters nulls). Build `equipment` from `raw.equipment.map(e => e.name)`; **omit the key entirely when the array is empty** (so the type stays `equipment?`).
  - `fetchAllExercises(): Promise<Exercise[]>` — start at `${WGER_BASE_URL}/exerciseinfo/?language=${WGER_ENGLISH_LANGUAGE_ID}&limit=${WGER_PAGE_SIZE}&format=json`; loop following `data.next` (bounded by `MAX_PAGES`); for each page `fetch(url, { headers: { Accept: 'application/json' }, next: { revalidate: 86400 } })`; if `!res.ok` throw `new Error(\`wger request failed: ${res.status}\`)`; accumulate `results`, map, drop nulls. Return a new array.
  - Cache via the repo's `globalThis` singleton idiom:
    ```ts
    type Cache = { data: Exercise[]; expiresAt: number }
    const globalForWger = globalThis as unknown as { exerciseCache?: Cache }
    async function getCatalog(): Promise<Exercise[]> {
      const cached = globalForWger.exerciseCache
      if (cached && cached.expiresAt > Date.now()) return cached.data
      const data = await fetchAllExercises()
      globalForWger.exerciseCache = { data, expiresAt: Date.now() + CACHE_TTL_MS }
      return data
    }
    export function clearExerciseCache(): void { globalForWger.exerciseCache = undefined }  // for tests
    ```
  - `searchExercises(options: SearchOptions = {}): Promise<Exercise[]>`:
    - `const catalog = await getCatalog()`
    - immutable filtering: start from `catalog`, then if `search` is a non-empty trimmed string, `.filter(e => e.name.toLowerCase().includes(term))`; if `category` provided, `.filter(e => e.category.toLowerCase() === cat)`.
    - clamp limit: `const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)` then `.slice(0, limit)`.
    - return the new array (never mutate `catalog`).
- **MIRROR**: MODULE_DOC_COMMENT + NAMED_EXPORTS (from `src/db/workouts.ts`); IN_MEMORY_SINGLETON_CACHE (from `src/db/index.ts`); ENV_ACCESS optional-with-default.
- **IMPORTS**: none external (uses global `fetch`, Node 24 / Next runtime provides it). No `requireEnv` import (base URL is optional).
- **GOTCHA**:
  - Do **not** mutate `catalog` — `.filter`/`.slice` return new arrays (immutability rule).
  - `category` on a wger result can theoretically be `null`; guard in `mapExercise` and return `null` to skip rather than crash.
  - Keep `equipment` truly optional: when empty, build the object **without** the key (`const ex: Exercise = { id, name, category }; if (names.length) ex.equipment = names`), so `equipment?` is honored and JSON stays clean.
  - `next: { revalidate }` is a Next.js fetch extension; it's valid in route-handler/server context (this module is server-only — never import it into a client component).
- **VALIDATE**: `npx tsc --noEmit` passes; module has no `any`; all exported functions have explicit return types.

### Task 2: Create the route handler (`src/app/api/exercises/route.ts`)
- **ACTION**: Create `src/app/api/exercises/route.ts` exporting an async `GET`.
- **IMPLEMENT**:
  ```ts
  import { NextResponse } from 'next/server'
  import { searchExercises } from '@/lib/wger'

  /**
   * GET /api/exercises?search=&category=&limit=
   * Proxies wger's exercise catalog (cached) as a typed, filterable list.
   * Auth-gated by Clerk middleware (see src/proxy.ts); no user scoping needed —
   * exercise data is public reference data, not user data.
   */
  export async function GET(request: Request): Promise<NextResponse> {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') ?? undefined
    const category = searchParams.get('category') ?? undefined
    const limitParam = searchParams.get('limit')
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined

    try {
      const exercises = await searchExercises({
        search,
        category,
        limit: limit !== undefined && Number.isNaN(limit) ? undefined : limit,
      })
      return NextResponse.json(exercises)
    } catch (error: unknown) {
      console.error('GET /api/exercises failed', error)
      return NextResponse.json({ error: 'Failed to fetch exercises' }, { status: 502 })
    }
  }
  ```
- **MIRROR**: TYPESCRIPT_TYPES (explicit `Promise<NextResponse>` return; `error: unknown` then handled). Error-handling rule: user-friendly message out, detailed context logged server-side.
- **IMPORTS**: `NextResponse` from `next/server`; `searchExercises` from `@/lib/wger`.
- **GOTCHA**:
  - **This route is already authenticated.** `src/proxy.ts` matcher includes `'/(api|trpc)(.*)'` and `auth.protect()` runs for every non-public route; `/api/exercises` is not in `isPublicRoute`, so unauthenticated calls are rejected by middleware before `GET` runs. Do **not** add it to public routes, and do **not** add `requireUserId()` inside the handler (exercises aren't user-scoped).
  - `console.error` (not `console.log`) is acceptable here — the common coding-style rule explicitly calls for logging detailed error context server-side, and the project has no logger abstraction.
  - Return a bare `Exercise[]` array on success (simplest for the Phase 3 consumer: `const list = await res.json()`). On error return `{ error }` with status 502 (Bad Gateway — upstream failure). This array-on-success / object-on-error shape is intentional; see Risks.
- **VALIDATE**: `npm run dev`, then `curl -s 'http://localhost:3000/api/exercises?search=bench&limit=5'` returns a JSON array of `{id,name,category,equipment?}` — **but** note middleware will 307→`/sign-in` unless signed in; validate the handler logic via the unit test (Task 4) and/or temporarily hit it while authenticated in-browser. Type-check passes.

### Task 3: Unit-test the service (`src/lib/wger.test.ts`)
- **ACTION**: Create `src/lib/wger.test.ts` covering mapping, filtering, caching, and upstream errors with `fetch` mocked.
- **IMPLEMENT**:
  - `import { describe, it, expect, vi, beforeEach } from 'vitest'`; `import { searchExercises, clearExerciseCache } from './wger'`.
  - A `makeInfo(id, name, category, equipment)` helper returning a wger-shaped raw object (`translations: [{ name, language: 2 }]`).
  - A `mockFetchPages(pages: object[][])` helper that stubs `global.fetch` (`vi.stubGlobal('fetch', vi.fn())`) to return `{ ok: true, json: async () => ({ next, results }) }` per page, setting `next` to a sentinel URL for all but the last page.
  - `beforeEach(() => { clearExerciseCache(); vi.restoreAllMocks(); vi.unstubAllGlobals() })`.
  - Tests (AAA):
    1. `maps a wger exercise to {id,name,category,equipment}` — single result with equipment → asserts mapped fields.
    2. `omits equipment when the wger exercise has none` — empty `equipment` array → `expect(result[0]).not.toHaveProperty('equipment')`.
    3. `picks the English (language 2) translation name` — translations include a non-English entry first; asserts English name chosen.
    4. `filters by case-insensitive name substring` — catalog of 3; `searchExercises({ search: 'BENCH' })` returns only the bench row.
    5. `filters by category` — `searchExercises({ category: 'chest' })` returns only chest rows.
    6. `clamps limit to MAX_LIMIT and slices results` — large catalog (mock e.g. 120) with `limit: 1000` → length ≤ 100; and `limit: 5` → length 5.
    7. `follows pagination across pages` — two mock pages; assert combined length and that `fetch` was called twice.
    8. `caches the catalog (second call does not refetch)` — call `searchExercises` twice; assert `fetch` called once (pages) total, not twice the pages.
    9. `throws when wger responds non-ok` — `fetch` returns `{ ok: false, status: 500 }`; `await expect(searchExercises()).rejects.toThrow()`.
- **MIRROR**: TEST_STRUCTURE (`src/db/workouts.test.ts`) — top constants, behavior-named `it()`.
- **IMPORTS**: `vitest` (`describe, it, expect, vi, beforeEach`); the module under test.
- **GOTCHA**: Reset the module cache between tests via `clearExerciseCache()` or stale data leaks across cases. `vi.stubGlobal('fetch', ...)` + `vi.unstubAllGlobals()` in `beforeEach`. Because the cache is a `globalThis` singleton, ordering matters — always clear first.
- **VALIDATE**: `npm test` — all wger service tests green.

### Task 4: Unit-test the route handler (`src/app/api/exercises/route.test.ts`)
- **ACTION**: Create `src/app/api/exercises/route.test.ts`, mocking `@/lib/wger` so the handler is tested in isolation from `fetch`.
- **IMPLEMENT**:
  - `vi.mock('@/lib/wger', () => ({ searchExercises: vi.fn() }))`.
  - `import { GET } from './route'`; `import { searchExercises } from '@/lib/wger'`; cast the mock with `vi.mocked(searchExercises)`.
  - Tests:
    1. `returns the exercises as a JSON array` — mock resolves `[{id:1,name:'Bench Press',category:'Chest'}]`; `const res = await GET(new Request('http://localhost/api/exercises'))`; `expect(res.status).toBe(200)`; `await res.json()` equals the array.
    2. `forwards search, category, and limit query params to the service` — call with `?search=bench&category=Chest&limit=10`; assert `searchExercises` called with `{ search: 'bench', category: 'Chest', limit: 10 }`.
    3. `ignores a non-numeric limit` — `?limit=abc` → service called with `limit: undefined`.
    4. `returns 502 with an error message when the service throws` — mock rejects; `expect(res.status).toBe(502)`; `(await res.json()).error` is a string. (Silence the expected log with `vi.spyOn(console,'error').mockImplementation(()=>{})`.)
- **MIRROR**: TEST_STRUCTURE.
- **IMPORTS**: `vitest` (`describe, it, expect, vi, beforeEach`); `GET` from `./route`; `searchExercises` from `@/lib/wger`.
- **GOTCHA**: `vi.mock` is hoisted — keep the factory self-contained / no out-of-scope refs. Construct requests with the global `Request` (test env is `node`, which provides `Request`/`URL`).
- **VALIDATE**: `npm test` — route tests green.

### Task 5: Document the optional env var (`.env.example`)
- **ACTION**: Append a wger section to `.env.example`.
- **IMPLEMENT**:
  ```
  # wger exercise API (optional — defaults to the public instance)
  # Override only to point at a self-hosted wger. No API key required.
  WGER_API_BASE_URL=https://wger.de/api/v2
  ```
- **MIRROR**: comment-then-var style already in `.env.example`.
- **IMPORTS**: n/a.
- **GOTCHA**: Keep it commented as optional — the code must work with the var **unset** (default applies). Do not add it to any `requireEnv` call.
- **VALIDATE**: App runs with the var unset (default used).

### Task 6: Update the PRD phase status
- **ACTION**: In `.claude/PRPs/prds/workout-tracker-pwa.prd.md`, set the Phase 2 row status `pending` → `in-progress` and replace its `PRP Plan` cell `-` with a link to this plan.
- **IMPLEMENT**: Row becomes `| 2 | wger exercise proxy | ... | in-progress | with 3 | 1 | [plan](../plans/wger-exercise-proxy.plan.md) |`.
- **MIRROR**: the Phase 1 row's link format (`[plan](../plans/completed/scaffold-and-infra.plan.md)`).
- **IMPORTS**: n/a.
- **GOTCHA**: Only edit the Phase 2 row; don't touch others.
- **VALIDATE**: Table still renders; only Phase 2 changed.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| map exercise | one wger info w/ equipment | `{id,name,category,equipment:[...]}` | no |
| omit equipment | wger info, empty `equipment` | object has no `equipment` key | yes |
| English name | translations w/ non-English first | English (lang 2) name chosen | yes |
| name search | catalog + `search:'BENCH'` | only bench row (case-insensitive) | no |
| category filter | catalog + `category:'chest'` | only chest rows | no |
| limit clamp | `limit:1000` over 120 items | length ≤ 100 | yes |
| limit slice | `limit:5` | length 5 | no |
| pagination | 2 mock pages | combined results; `fetch` ×2 | yes |
| cache reuse | call twice | `fetch` not re-invoked 2nd call | yes |
| upstream error | `fetch` `ok:false` | `rejects.toThrow()` | yes |
| handler success | mocked service returns array | 200 + JSON array | no |
| handler params | `?search&category&limit` | service called with parsed opts | no |
| handler bad limit | `?limit=abc` | service called with `limit:undefined` | yes |
| handler error | service rejects | 502 + `{error}` | yes |

### Edge Cases Checklist
- [x] Empty input (no query params → returns first `DEFAULT_LIMIT` exercises)
- [x] Maximum size input (`limit` > 100 clamped to `MAX_LIMIT`)
- [x] Invalid types (`limit=abc` → ignored)
- [x] Missing English translation (exercise dropped via `mapExercise` returning null)
- [x] Empty equipment (key omitted)
- [x] Network failure (upstream non-ok → 502)
- [ ] Concurrent access — N/A for a read-only cache (a benign double-fetch on cold start is acceptable; not worth a lock for a POC)
- [x] Permission denied — handled by Clerk middleware (unauthenticated → redirect), not the handler

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
```
EXPECT: Zero type errors.

### Lint
```bash
npm run lint
```
EXPECT: No errors (no `console.log`; `console.error` is allowed).

### Unit Tests
```bash
npm test
```
EXPECT: All tests pass, including the new `src/lib/wger.test.ts` and `src/app/api/exercises/route.test.ts`.

### Build
```bash
npm run build
```
EXPECT: Production build succeeds; `/api/exercises` listed as a route (ƒ Dynamic).

### Browser / Live Validation (manual, signed in)
```bash
npm run dev
# In an authenticated browser session (Clerk), visit:
#   http://localhost:3000/api/exercises?search=bench&limit=5
# Unauthenticated curl will 307 → /sign-in (expected; middleware-gated).
```
EXPECT: A JSON array of real wger exercises whose names contain "bench", each `{id,name,category,equipment?}`.

### Manual Validation
- [ ] `npm test` green; coverage of new files via the listed cases.
- [ ] `npx tsc --noEmit` clean.
- [ ] Authenticated `/api/exercises?search=bench` returns filtered real exercises.
- [ ] `/api/exercises` (no params) returns up to 50 exercises.
- [ ] `/api/exercises?limit=1000` returns ≤ 100.
- [ ] App boots with `WGER_API_BASE_URL` unset (default applies).

---

## Acceptance Criteria
- [ ] `GET /api/exercises` returns typed `{ id, name, category, equipment? }[]` from live wger data.
- [ ] `?search=` filters by case-insensitive name substring (PRD success signal).
- [ ] Exercise catalog is cached in memory (no per-request full-catalog refetch).
- [ ] All validation commands pass (type-check, lint, tests, build).
- [ ] Route is auth-gated (inherits Clerk middleware) and exposes no secrets.

## Completion Checklist
- [ ] Code follows discovered patterns (service module shape, `globalThis` cache, optional-env-with-default).
- [ ] Error handling matches codebase style (user-friendly message out, `console.error` context server-side).
- [ ] Tests follow the repo's vitest idiom (AAA, top constants, behavior-named cases).
- [ ] No hardcoded secrets; wger base URL is configurable, defaulted, key-less.
- [ ] No mutation (filter/slice produce new arrays).
- [ ] No new runtime dependency added.
- [ ] PRD Phase 2 marked in-progress + linked.
- [ ] Self-contained — implementable from this plan without further codebase searching.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| wger changes `exerciseinfo` shape again | L | M | Mapping is centralized in `mapExercise`; only one function to update. Upstream types are minimal (only fields we read). |
| Cold-start latency from fetching full catalog (2 requests, ~1275 items) | M | L | In-memory cache + `next: { revalidate: 86400 }` on upstream fetch; subsequent requests are instant. Catalog "changes rarely" (PRD). |
| wger downtime during dogfooding | L | M | Handler returns 502 with a clear message; Phase 3 picker can surface a retry. Cached data continues serving until TTL expiry. |
| Array-on-success vs object-on-error response shape feels inconsistent | L | L | Intentional + idiomatic for list endpoints; documented here. If Phase 3 prefers an envelope (`{exercises}`), it's a one-line change — revisit then (YAGNI). |
| `category` can be null on a wger record | L | L | `mapExercise` guards and drops such records. |
| Concurrent cold requests double-fetch the catalog | L | L | Benign (idempotent GET); a mutex isn't worth it for a POC. |

## Notes
- **Why the catalog-cache approach over per-query upstream calls:** wger has no usable server-side text search anymore (researched & confirmed against the live API 2026-06-13), and `?name=` is exact-match. Fetching the small English catalog once (2 requests) and filtering in-memory is both simpler and faster than any per-keystroke upstream call, and directly realizes the PRD's "cache the exercise list; it changes rarely" guidance.
- **English language id is `2`** (verified via `/api/v2/language/`). Encoded as the `WGER_ENGLISH_LANGUAGE_ID` constant — no magic number.
- **Server-only module:** `src/lib/wger.ts` uses the Next `fetch` cache extension and must never be imported into a Client Component. The Phase 3 picker should call `/api/exercises` over HTTP, not import the service.
- **This plan resolves PRD Open Question #1** (wger endpoint/shape). Suggest updating that open question to "Resolved: use `/exerciseinfo/?language=2`; `/exercise/search/` removed" when convenient.
- **Parallelism:** Phase 2 (this) and Phase 3 share only the `Exercise` response *shape* `{id,name,category,equipment?}`; Phase 3 can mock that contract and join at the picker, per the PRD's parallelism note.
