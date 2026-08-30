# Plan: Persona Foundry — Phase 1: Engine Core

## Summary

Build the foundation of the persona-seeding CLI: a host-locked, deterministic
engine (`scripts/seed-persona.ts` + `scripts/persona/*`) that creates a
WorkOS-emulator user and writes real domain data for it — consent, weight-unit
preference, entitlement grants, and (for `week-one`) a minimal adopted-program
history — through the app's own `src/db/*` write functions, never raw SQL.
Ships with two persona definitions (`day-one`, `week-one`) and a JSON manifest
per persona that later phases (screens rig, clone-to-local) read to resolve a
user's identity and key entity ids.

## User Story

As the solo developer maintaining this app, I want a single command that
materializes a named user state in my local database, so that I can review,
test, and debug pages as that user without manually signing up and clicking
through the app.

## Problem → Solution

Today the only way to see a `HomeState` other than "whatever my own prod
account is in" is to manually create an account and click through the app for
days. → `npm run persona -- --persona day-one` (or `week-one`) creates that
user's data in one command, against the local scratch database only, and
prints the seed/anchor/email needed to name the state in a bug report or
re-derive it later.

## Metadata

- **Complexity**: Large (new subsystem: CLI, 8+ new files, one schema-adjacent
  type change, safety-critical guard)
- **Source PRD**: `.claude/PRPs/prds/persona-foundry.prd.md`
- **PRD Phase**: Phase 1 — Engine core
- **Estimated Files**: 15 (13 create, 2 update)

---

## UX Design

N/A — internal dev tooling, no UI. The "interaction" is a terminal command
and its printed output.

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Materializing a day-one/week-one user | Manually sign up, click through `/welcome`, log a couple of workouts by hand | `npm run persona -- --persona day-one` (or `week-one`) | Prints `seed`, `anchor`, `userId`, `email` on completion |
| Tearing a persona down | Manually find and delete rows, or leave stale data | `npm run persona -- --persona day-one --purge --commit` | Dry-run by default: prints what would be deleted, changes nothing without `--commit` |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `scripts/seed-templates.ts` | 1-79 (whole file) | THE pattern to mirror: header convention, dotenv load, deferred dynamic import, preflight-then-write, exit handling |
| P0 | `scripts/migrate-user-id.ts` | 1-141 (whole file) | Dry-run/`--commit` idiom (lines 105-108), manual `process.argv` parsing (lines 36-56), idempotency-by-count-check (lines 91-103) |
| P0 | `playwright.config.ts` | 1-29 | The only existing host-guard precedent — regex shape to mirror, adapted to a different env var and flag name |
| P0 | `src/db/index.ts` | 1-14 (whole file) | Confirms `DATABASE_URL` connects **synchronously at import** — this is *why* the guard must run before any `@/db/*` import, and why `globalForDb.dbClient` caching means one bad import poisons the whole process |
| P0 | `e2e/auth.ts` | 1-90 | Stance on no session-minting (5-23); `createTestUser`/`TestUser` shape (32-75) is the closest precedent for minting a WorkOS-emulator identity, though Phase 1 needs its own variant (see GOTCHA in Task 3) |
| P0 | `src/db/consent.ts` | 151-220, 248-254 | `recordConsent` signature, append-only ledger, required `documentId` |
| P0 | `src/app/welcome/actions.ts` | 1-98 | The EXACT three-consent sequence (tos, health_collect, health_share) a real signup performs — Phase 1's `consentAll` action must reproduce this, including the "documents not seeded" failure mode |
| P0 | `src/db/entitlements.ts` | 45-95, 104-175 | `applyGrant`/`ApplyGrantInput`: required `reason`, `endsAt: null` = perpetual, past `endsAt` = lapsed |
| P0 | `src/db/purge-user-data.ts` | 66-116 | `purgeUserData(userId)` — exact table list, single transaction, does NOT touch `consent_events` |
| P0 | `src/db/preferences.ts` | 22-44 | `setWeightUnit` upsert pattern |
| P1 | `src/db/programs.ts` | 236-250, 738-768, 81 | `saveProgram` status logic; `setProgramStatus` (draft→active, sibling-archive sweep); `getProgramDetail` signature |
| P1 | `src/db/templates.ts` | 84-130ish | `adoptTemplate(userId, templateId)` — copies a system-owned template into the user's account as `status:'draft'` |
| P1 | `src/db/prescriptions.ts` | 556-563, 586-607 | `instantiateProgramDay` signature and the one-instantiation-per-(day,week) guard |
| P1 | `src/db/workouts.ts` | 362, 670-698, 957-996, 1158-1171 | `getWorkoutDetail` signature; `saveWorkout` (create path, backdatable); `updateWorkout` (also backdatable); `stampWorkoutCompleted` (hardcodes `now()` — confirm it is NEVER used here) |
| P1 | `src/lib/workout-input.ts` | 104-146, 149-166 | `SetInput`/`ExerciseInput`/`WorkoutInput` shapes |
| P1 | `src/db/workout-events.ts` | 19-24, 28-40 | `WorkoutEventActor` union (Task 2 adds `'seed'` here) and `WorkoutChangeContext` shape |
| P1 | `src/db/program-events.ts` | 14-18 | `ProgramEventActor` — already has `'seed'`; the precedent Task 2 extends to workouts |
| P1 | `src/lib/home-status.ts` | 19-21, 49-56 | `HomeState` union and `DRIFT_THRESHOLD_DAYS` — confirms what "correct HomeState" means for the Phase 1 success signal |
| P2 | `scripts/seed-consent-docs.ts` | 1-60 (whole file) | Why `getActiveConsentDocument` can return null — this is the documented prerequisite script |
| P2 | `scripts/build-tokens.test.ts` | 1-50 | TEST_STRUCTURE to mirror for `scripts/persona/*.test.ts` |
| P2 | `.env.example` | (grep `DATABASE_URL`) | Confirms no host-name env convention exists — the guard must do the string-matching itself |

## External Documentation

No external research needed — feature uses established internal patterns
(dotenv, drizzle transactions, WorkOS emulator REST API already wired into
`e2e/auth.ts`) plus one small, dependency-free utility (seeded PRNG) that has
no version-sensitive API to look up.

---

## Patterns to Mirror

### SCRIPT_HEADER_AND_DOTENV
```ts
// SOURCE: scripts/seed-templates.ts:1-24
/**
 * ...one-paragraph purpose...
 *
 * MANUAL INVOCATION ONLY. This script is deliberately NOT wired into CI, the
 * build, or any app code path — ...
 *
 *   npm run db:seed-templates        # reads DATABASE_URL from .env.local
 *   DATABASE_URL=postgres://… npx tsx scripts/seed-templates.ts
 */
import { config } from 'dotenv'

config({ path: '.env.local' }) // plain node does not read .env.local
config() // …then .env, for environments that use it
```

### DEFERRED_DYNAMIC_IMPORT
```ts
// SOURCE: scripts/seed-templates.ts:26-37
async function main(): Promise<void> {
  // Imports live inside main, AFTER dotenv ran: src/db/index.ts requires
  // DATABASE_URL at module init.
  const [{ parseProgramInput }, { TEMPLATE_CANON }, { TEMPLATE_OWNER_USER_ID }] = await Promise.all([
    import('../src/lib/program-input'),
    import('../src/lib/template-canon'),
    import('../src/lib/template-owner'),
  ])
  const { listPrograms, saveProgram, updateProgram } = await import('../src/db/programs')
  const { getAllExercises } = await import('../src/lib/wger')
```
Rule this implies for Persona Foundry: `scripts/seed-persona.ts` may statically
import `./persona/guard`, `./persona/rng`, `./persona/clock`, `./persona/manifest`
(none of these touch `@/db/*`), but must reach every persona definition —
and therefore every `@/db/*` write function — via `await import(...)` called
**after** the guard has run. The definition/action files themselves
(`scripts/persona/actions.ts`, `scripts/persona/defs/*.ts`) are free to use
ordinary static `import` at their own top — they're never on the eagerly-
evaluated path since the only thing that reaches them is a dynamic import.

### PREFLIGHT_ALL_OR_NOTHING
```ts
// SOURCE: scripts/seed-templates.ts:39-56
const catalog = new Set((await getAllExercises()).map((e) => e.id))
for (const template of templates) {
  for (const day of template.days) {
    for (const exercise of day.exercises) {
      if (!catalog.has(exercise.wgerExerciseId)) {
        throw new Error(`"${template.name}" references wger id ${exercise.wgerExerciseId} ... not present ... — aborting, nothing written`)
      }
    }
  }
}
```

### DRY_RUN_COMMIT_IDIOM
```ts
// SOURCE: scripts/migrate-user-id.ts:36-56, 105-108
function parseArgs(argv: string[]): Args {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }
  const from = value('--from')
  ...
  return { from, to, commit: argv.includes('--commit') }
}
// later:
if (!commit) {
  console.info(`[migrate-user-id] DRY RUN — would move ${fromRows} rows. Re-run with --commit.`)
  return
}
```
Persona Foundry's `--purge` is destructive per S-5 and must gate on an
explicit `--commit` the same way (dry-run prints what it *would* delete —
per-table counts, mirroring migrate-user-id.ts:86-88 — then returns).

### EXIT_HANDLING
```ts
// SOURCE: scripts/seed-templates.ts:73-78
main()
  .then(() => process.exit(0)) // the pg connection would otherwise hold the loop open
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
```

### HOST_GUARD (adapt, don't copy verbatim — see Task 1 GOTCHA)
```ts
// SOURCE: playwright.config.ts:16-25
const directUrl = process.env.DATABASE_URL_DIRECT ?? ''
const isLocalDb = /@(localhost|127\.0\.0\.1|host\.docker\.internal|db):/.test(directUrl)
if (directUrl && !isLocalDb && process.env.E2E_ALLOW_REMOTE_DB !== '1') {
  const host = directUrl.replace(/^.*@/, '').replace(/[/?].*$/, '')
  throw new Error(`Refusing to run e2e against a non-local database (${host}).\n...`)
}
```

### ACTOR_UNION_EXTENSION (precedent already exists on the program side)
```ts
// SOURCE: src/db/program-events.ts:14-18
/** WHO made a plan change. Derived at the boundary: server actions pass 'ui';
 *  the MCP layer distinguishes 'coach' (in-memory bridge) from 'mcp' (HTTP);
 *  'wger' marks a template imported from wger's public catalog; 'seed' marks
 *  the manual template-library seed script writing the system account's rows
 *  (scripts/seed-templates.ts — never reachable from a user request). */
export type ProgramEventActor = 'ui' | 'mcp' | 'coach' | 'wger' | 'seed'
```

### CONSENT_SEQUENCE (the exact three writes a real signup performs)
```ts
// SOURCE: src/app/welcome/actions.ts:42-89
const [tosDoc, healthDoc] = await Promise.all([
  getActiveConsentDocument('tos'),
  getActiveConsentDocument('health_notice'),
])
if (!tosDoc || !healthDoc) {
  throw new Error('consent documents not seeded')
}
await recordConsent({ userId, ip, userAgent, purpose: 'health_collect', action: 'granted', documentId: healthDoc.id, presentation: {...} })
await recordConsent({ userId, ip, userAgent, purpose: 'health_share', action: 'granted', documentId: healthDoc.id, presentation: {...} })
await recordConsent({ userId, ip, userAgent, purpose: 'tos', action: 'granted', documentId: tosDoc.id, presentation: {...} })
```

### TEST_STRUCTURE
```ts
// SOURCE: scripts/build-tokens.test.ts:1-24
import { describe, expect, it } from "vitest";
import { css, kotlin, swift, tsTokens } from "./build-tokens";

describe("token emitters", () => {
  it("emits every core colour to both native platforms", () => {
    const swiftOut = swift();
    expect(swiftOut, token.name).toContain(token.doc);
  });
});
```
Pure, exported functions from a `scripts/**` file, imported by a co-located
`*.test.ts`, run by the repo's default `npm test` (vitest picks up
`scripts/**/*.test.ts` with no extra config — confirmed via `vitest.config.ts`,
no `include` restricting to `src/`).

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `scripts/persona/guard.ts` | CREATE | Pure host-check, no `@/db/*` import — safe to import eagerly |
| `scripts/persona/guard.test.ts` | CREATE | Unit test for the regex + escape-hatch logic |
| `scripts/persona/rng.ts` | CREATE | Seeded mulberry32 PRNG (D-2 default) + small helpers |
| `scripts/persona/rng.test.ts` | CREATE | Same-seed-same-sequence determinism test |
| `scripts/persona/clock.ts` | CREATE | Anchor + day/hour-offset helpers, forward-only by construction |
| `scripts/persona/clock.test.ts` | CREATE | Anchor math test |
| `scripts/persona/manifest.ts` | CREATE | `PersonaManifest` type, `writeManifest`/`readManifest`/`deleteManifest` against `e2e/.state/<slug>.json` |
| `scripts/persona/manifest.test.ts` | CREATE | Round-trip + missing-slug test |
| `scripts/persona/actions.ts` | CREATE | Action API foundation: `createPersonaIdentity`, `deletePersonaIdentity`, `consentAll`, `setUnit`, `grantTier`, `purgePersona` |
| `scripts/persona/defs/types.ts` | CREATE | `PersonaDefinition`/`PersonaRunContext` shared shapes |
| `scripts/persona/defs/day-one.ts` | CREATE | Persona definition: identity + consent + kg unit, nothing else |
| `scripts/persona/defs/week-one.ts` | CREATE | Persona definition: day-one's steps + adopt-and-play-2-days |
| `scripts/persona/registry.ts` | CREATE | `slug -> PersonaDefinition` map; the ONLY file later phases touch to add a persona |
| `scripts/seed-persona.ts` | CREATE | CLI entrypoint: dotenv → guard → arg parse → dispatch → manifest emit |
| `src/db/workout-events.ts` | UPDATE | Add `'seed'` to `WorkoutEventActor` (see Decisions Log — deliberate deviation from the PRD's phase table) |
| `package.json` | UPDATE | Add `"persona": "tsx scripts/seed-persona.ts"` |
| `.gitignore` | UPDATE | Add `/e2e/.state/` |

## NOT Building

- The `freestyle-lifer`, `veteran`, `drifting`, `mid-session`,
  `edge-kitchen-sink` persona definitions (Phases 3 and 4).
- The day-loop scheduler, progression curves, or any autoregulation/deload/TM
  simulation (Phase 3/4 — H-1, H-2).
- The screens rig, `storageState`, route manifest, or anything Playwright
  (Phase 2).
- Clone-to-local / `pg_dump` orchestration (Phase 5).
- Invariant post-assertion (`src/lib/testing/invariants.ts` wiring) — Phase
  1's personas don't touch anything those predicates check yet.
- A `docker-compose.yml` for the scratch Postgres (D-3 default: no in v1).
- Any multi-user/relationship engine capability (P-4) — out of scope until a
  feature needing it exists.

---

## Step-by-Step Tasks

### Task 1: Host guard
- **ACTION**: Create `scripts/persona/guard.ts` exporting
  `assertLocalDatabase(databaseUrl: string, allowRemoteEnvVar: string): void`.
- **IMPLEMENT**: Regex-match `databaseUrl` against
  `/@(localhost|127\.0\.0\.1|host\.docker\.internal|db):/` (identical pattern
  to `playwright.config.ts:17`). If it doesn't match AND
  `process.env[allowRemoteEnvVar] !== '1'`, throw an `Error` naming the
  offending host (strip credentials the same way: `.replace(/^.*@/, '').replace(/[/?].*$/, '')`).
  Empty/undefined `databaseUrl` should also throw (fail closed — don't let a
  missing env var silently "pass" the guard).
- **MIRROR**: `HOST_GUARD` pattern above.
- **IMPORTS**: None from `@/*` or `../src/*` — this file must stay import-safe
  from the very top of `scripts/seed-persona.ts`.
- **GOTCHA**: The existing precedent (`playwright.config.ts`) checks
  `DATABASE_URL_DIRECT`, not `DATABASE_URL`. But `src/db/index.ts` (the module
  every domain write function transitively imports) connects using
  `DATABASE_URL` (the pooler URL), not the direct one. Guard **`DATABASE_URL`**
  — that's the value that actually determines what host gets written to when
  `@/db/*` is imported. Name the escape hatch `PERSONA_ALLOW_REMOTE_DB` (S-1:
  "the seeder's flag may be its own name but MUST NOT default on") — do not
  reuse `E2E_ALLOW_REMOTE_DB`, these are different tools with independently
  reviewable blast radii.
- **VALIDATE**: `npx vitest run scripts/persona/guard.test.ts` — cover: a
  `localhost`/`127.0.0.1`/`host.docker.internal`/`db` URL passes; a remote-
  looking URL throws; the same remote URL with the escape-hatch env var set
  to `'1'` passes; an empty string throws.

### Task 2: Extend `WorkoutEventActor` with `'seed'`
- **ACTION**: Add `'seed'` to the `WorkoutEventActor` union in
  `src/db/workout-events.ts:24`.
- **IMPLEMENT**:
  ```ts
  export type WorkoutEventActor = 'ui' | 'mcp' | 'coach' | 'system' | 'seed'
  ```
  Update the doc comment above it to name the new script, mirroring
  `ProgramEventActor`'s comment style exactly (see `ACTOR_UNION_EXTENSION`
  pattern): *"'seed' marks scripts/seed-persona.ts's writes — never reachable
  from a user request."*
- **MIRROR**: `ACTOR_UNION_EXTENSION` — `src/db/program-events.ts:14-18`.
- **IMPORTS**: N/A (editing an existing type).
- **GOTCHA — read before implementing**: the PRD's phase table assigns this
  exact change ("C-9: workout-events actor union gains 'seed'") to **Phase 3**,
  not Phase 1. This plan pulls it forward because Phase 1's `week-one`
  persona (below) already needs to call `updateWorkout`, which requires a
  `WorkoutChangeContext.actor: WorkoutEventActor`, and the only currently
  valid non-UI option is `'system'` — the doc comment defines `'system'` as
  "the app's own writes" (cron jobs, migrations), which is a worse-fitting,
  dishonest label for seeded test data than paying this one-line cost now.
  If the reviewer prefers to stay literal to the PRD's phase boundaries,
  the alternative is: use `'system'` in Phase 1 and let Phase 3 do a
  find/replace to `'seed'` across both Phase 1 and Phase 3 call sites. Flagged
  in the plan's Risks section — pick one before merging.
- **VALIDATE**: `npx tsc --noEmit` (no other call site should break — this is
  an additive union member); `npm run lint` on the touched file.

### Task 3: Persona identity actions (create/delete a WorkOS-emulator user)
- **ACTION**: Create `scripts/persona/actions.ts` exporting
  `createPersonaIdentity(slug: string): Promise<{ id: string; email: string }>`
  and `deletePersonaIdentity(id: string): Promise<void>`.
- **IMPLEMENT**: Same emulator REST call shape as `e2e/auth.ts`'s
  `createTestUser`/`deleteTestUser` (`POST`/`DELETE` on
  `${WORKOS_API}/users`, `Authorization: Bearer sk_test_default`), but with a
  **fixed, non-timestamped email** — `persona_${slug}@example.com` — per the
  PRD's own manifest example (`docs/specs/personas-and-screens.md:145`:
  `"email": "persona_veteran@example.com"`). A fixed email is what makes the
  persona nameable and re-findable across runs; `e2e/auth.ts`'s
  timestamp-suffixed emails exist specifically to avoid collisions across
  parallel/repeated *test* runs, which is the opposite of what a named
  persona needs.
  ```ts
  const EMULATOR_ORIGIN = process.env.WORKOS_E2E_API_BASE ?? 'http://localhost:4100'
  const EMULATOR_API_KEY = 'sk_test_default'
  const WORKOS_API = `${EMULATOR_ORIGIN}/user_management`

  export async function createPersonaIdentity(slug: string) {
    const email = `persona_${slug}@example.com`
    const password = `Pw-persona-${slug}-aZ9!`
    const res = await fetch(`${WORKOS_API}/users`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${EMULATOR_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_verified: true }),
    })
    const body: unknown = await res.json()
    if (!res.ok) throw new Error(`WorkOS create user failed (${res.status}): ${JSON.stringify(body)}`)
    return { id: readUserId(body), email }
  }
  ```
  (`readUserId` — copy the same small body-shape-reading helper from
  `e2e/auth.ts`; check its exact implementation before duplicating logic
  verbatim vs. extracting it to a shared module — see GOTCHA.)
- **MIRROR**: `e2e/auth.ts:32-75` (`createTestUser`/`deleteTestUser`).
- **IMPORTS**: None from `@/*` (this file is dynamically imported already, by
  virtue of being reached only through `scripts/seed-persona.ts`'s deferred
  import, but has no `@/db/*` dependency of its own for this part).
- **GOTCHA (extract `readUserId` or duplicate it?)**: `e2e/auth.ts`'s
  `readUserId` is a small private helper, not exported. Either duplicate the
  ~5-line body-parsing logic here (simplest, matches this codebase's general
  preference for duplication over premature sharing per YAGNI) or, if it's
  more than a few lines of real logic, extract it to a tiny shared module
  both `e2e/auth.ts` and `scripts/persona/actions.ts` import — read the
  actual implementation during this task and decide then, don't guess now.
- **GOTCHA (host guard for this call, too)**: `createPersonaIdentity` talks to
  `http://localhost:4100` by default — itself a "local-only" endpoint, but if
  someone sets `WORKOS_E2E_API_BASE` to a real WorkOS environment (copying the
  env var name from `e2e/auth.ts` without reading what it does), this call
  would create a REAL WorkOS user in a real environment. Guard this the same
  way as the DB: refuse unless `WORKOS_E2E_API_BASE` (or its default) resolves
  to a loopback host, using the same regex idea as Task 1 but matched against
  the origin string.
- **GOTCHA (emulator must be running)**: This call requires
  `npx workos@latest emulate --port 4100 --interactive` to already be running
  in another terminal — Playwright's `webServer` config starts this
  automatically for e2e runs, but `seed-persona.ts` runs standalone with no
  such lifecycle hook. Fail fast and loud: `fetch` to
  `${EMULATOR_ORIGIN}/health` before attempting user creation, and if it's
  unreachable, throw an error telling the developer to start the emulator
  (quote the exact command). Document this as a prerequisite in the script's
  header docblock, matching D-5's "documented prerequisite" pattern already
  used for `npm run db:seed-templates`/`db:seed-consent-docs`.
- **GOTCHA (idempotent re-run + emulator resets)**: `scripts/seed-persona.ts`
  (Task 8) should check `readManifest(slug)` FIRST and reuse the existing
  `userId`/`email` from a prior run instead of calling
  `createPersonaIdentity` again — this is what makes `--persona day-one`
  idempotent per C-7 without needing a "does this email already exist" lookup
  against the emulator. Document as a known limitation: if the WorkOS emulator
  process was restarted (its state may not persist across restarts — verify
  this empirically during implementation and note the actual behavior in the
  script's header), the manifest's `userId` may reference an identity the
  emulator no longer knows about; the documented recovery is `rm
  e2e/.state/<slug>.json` and re-run.
- **VALIDATE**: Manual — with the emulator running locally, call
  `createPersonaIdentity('smoke-test')` from a scratch script and confirm a
  200 with a `user_...`-shaped id; call `deletePersonaIdentity` on it and
  confirm a second delete returns cleanly (404 tolerated, per
  `e2e/auth.ts`'s `deleteTestUser`).

### Task 4: Seeded RNG and simulated clock
- **ACTION**: Create `scripts/persona/rng.ts` and `scripts/persona/clock.ts`.
- **IMPLEMENT** (`rng.ts`, D-2's ~20-line mulberry32, no dependency —
  confirmed via grep that nothing like this exists anywhere in the repo):
  ```ts
  export type Rng = () => number // returns [0, 1)

  export function createRng(seed: number): Rng {
    let a = seed >>> 0
    return () => {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  export function randInt(rng: Rng, min: number, max: number): number {
    return min + Math.floor(rng() * (max - min + 1))
  }

  export function pick<T>(rng: Rng, items: readonly T[]): T {
    return items[randInt(rng, 0, items.length - 1)]
  }

  export function chance(rng: Rng, probability: number): boolean {
    return rng() < probability
  }
  ```
- **IMPLEMENT** (`clock.ts` — minimal now; Phase 3's day-loop scheduler
  extends this, doesn't replace it):
  ```ts
  export interface PersonaClock {
    readonly anchor: Date
    daysAgo(n: number): Date
    hoursAgo(n: number): Date
  }

  export function createClock(anchor: Date = new Date()): PersonaClock {
    return {
      anchor,
      daysAgo: (n) => new Date(anchor.getTime() - n * 24 * 60 * 60 * 1000),
      hoursAgo: (n) => new Date(anchor.getTime() - n * 60 * 60 * 1000),
    }
  }
  ```
- **MIRROR**: N/A — net-new utility, no existing precedent (confirmed by
  exploration: zero hits for "mulberry32"/"seedrandom"/"PRNG" repo-wide). The
  codebase's only other seeded-randomness tool is fast-check
  (`src/lib/testing/arbitraries.ts`), used for property-based *tests*, not
  data generation — not a fit here (Persona Foundry needs one long-lived RNG
  stream across an entire run, not per-property sampling).
- **IMPORTS**: None.
- **GOTCHA**: `daysAgo`/`hoursAgo` must never be able to exceed `anchor`
  itself for a non-negative `n` — by construction this implementation can't
  (subtraction only), so H-3's "never passes the anchor" invariant holds
  trivially for Phase 1's usage. Phase 3's day-loop will need a stronger,
  explicit assertion when it starts *iterating* dates; not needed yet.
- **VALIDATE**: `npx vitest run scripts/persona/rng.test.ts
  scripts/persona/clock.test.ts` — RNG test: `createRng(42)` called 5 times
  twice produces two identical sequences; different seeds produce different
  first values (allow the vanishingly-unlikely collision, don't assert
  inequality strictly if that's a concern — assert the sequences differ, not
  every single draw). Clock test: `daysAgo(5)` is exactly 5×86400000 ms
  before `anchor`; `daysAgo(0)` equals `anchor`.

### Task 5: Manifest read/write
- **ACTION**: Create `scripts/persona/manifest.ts`.
- **IMPLEMENT**:
  ```ts
  import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
  import { join } from 'node:path'

  export interface PersonaManifest {
    persona: string
    userId: string
    email: string
    seed: number
    anchor: string // ISO-8601 UTC
    workoutId?: string
    programId?: string
    templateId?: string
    exerciseRef?: string
    programShareToken?: string | null
    workoutShareToken?: string | null
  }

  const STATE_DIR = join(process.cwd(), 'e2e', '.state')

  export async function writeManifest(slug: string, manifest: PersonaManifest): Promise<void> {
    await mkdir(STATE_DIR, { recursive: true })
    await writeFile(join(STATE_DIR, `${slug}.json`), JSON.stringify(manifest, null, 2) + '\n')
  }

  export async function readManifest(slug: string): Promise<PersonaManifest | null> {
    try {
      return JSON.parse(await readFile(join(STATE_DIR, `${slug}.json`), 'utf8'))
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  export async function deleteManifest(slug: string): Promise<void> {
    await rm(join(STATE_DIR, `${slug}.json`), { force: true })
  }
  ```
  Shape matches `docs/specs/personas-and-screens.md:141-155` (C-8) exactly —
  all fields beyond the first five are optional because Phase 1's `day-one`
  never populates them.
- **MIRROR**: No direct code precedent; the shape is dictated by the spec,
  not by an existing file.
- **IMPORTS**: `node:fs/promises`, `node:path` only.
- **GOTCHA**: This file has no `@/db/*` or `../src/*` import — safe for
  `scripts/seed-persona.ts` to import statically at the top, same reasoning
  as Task 1's guard.
- **VALIDATE**: `npx vitest run scripts/persona/manifest.test.ts` — write
  then read round-trips exactly; read of a nonexistent slug returns `null`
  (not a thrown error); an `ENOENT`-only catch — assert any *other* fs error
  still propagates (test with a mocked `readFile` rejecting a different code).

### Task 6: Domain actions (consent, unit, grant, purge)
- **ACTION**: Extend `scripts/persona/actions.ts` (from Task 3) with
  `consentAll`, `setUnit`, `grantTier`, `purgePersona`.
- **IMPLEMENT**:
  ```ts
  import { getActiveConsentDocument, recordConsent } from '@/db/consent'
  import { setWeightUnit } from '@/db/preferences'
  import { applyGrant, type ApplyGrantInput } from '@/db/entitlements'
  import { purgeUserData } from '@/db/purge-user-data'

  const PRESENTATION = (controlLabel: string) => ({
    route: '/welcome',
    surface: 'signup' as const,
    controlLabel,
  })

  export async function consentAll(userId: string): Promise<void> {
    const [tosDoc, healthDoc] = await Promise.all([
      getActiveConsentDocument('tos'),
      getActiveConsentDocument('health_notice'),
    ])
    if (!tosDoc || !healthDoc) {
      throw new Error(
        'consent documents not seeded — run `npm run db:seed-consent-docs` against this database first',
      )
    }
    const base = { userId, ip: null, userAgent: 'persona-foundry' }
    await recordConsent({ ...base, purpose: 'health_collect', action: 'granted', documentId: healthDoc.id, presentation: PRESENTATION('Health data collection') })
    await recordConsent({ ...base, purpose: 'health_share', action: 'granted', documentId: healthDoc.id, presentation: PRESENTATION('Health data sharing') })
    await recordConsent({ ...base, purpose: 'tos', action: 'granted', documentId: tosDoc.id, presentation: PRESENTATION('Terms of service') })
  }

  export async function setUnit(userId: string, unit: 'kg' | 'lb'): Promise<void> {
    await setWeightUnit(userId, unit)
  }

  export async function grantTier(userId: string, input: Omit<ApplyGrantInput, 'userId' | 'source'>): Promise<void> {
    await applyGrant({ ...input, userId, source: 'ops' /* verify exact GrantSource literal before use — see GOTCHA */ })
  }

  export async function purgePersona(userId: string): Promise<void> {
    await purgeUserData(userId)
  }
  ```
- **MIRROR**: `CONSENT_SEQUENCE` pattern (`src/app/welcome/actions.ts:42-89`)
  for `consentAll`; `src/db/preferences.ts:38-44` for `setUnit`;
  `src/db/entitlements.ts:45-95` for `grantTier`;
  `src/db/purge-user-data.ts:66` for `purgePersona`.
- **IMPORTS**: `@/db/consent`, `@/db/preferences`, `@/db/entitlements`,
  `@/db/purge-user-data` — all fine as static top-level imports in this file
  (see the DEFERRED_DYNAMIC_IMPORT rule: this file is never on the eager
  path, since it's only reachable via `seed-persona.ts`'s `await import(...)`).
- **GOTCHA**: Confirm the exact `GrantSource` union (referenced but not fully
  enumerated in the exploration dump — it's `entitlementGrants.source`'s
  type) before writing this; `'ops'` is a guess based on the `/ops` allowlist
  precedent, not a confirmed literal. Grep `type GrantSource` in
  `src/db/entitlements.ts` or `src/db/schema.ts` during implementation and use
  whatever fits "a human/tool granted this outside the payment flow" — do not
  invent a new source value without checking the existing enum first, and add
  one only if none fits (with the same review scrutiny as the `'seed'` actor
  addition in Task 2).
- **GOTCHA**: `analytics_identity` consent is deliberately NOT granted here —
  `src/app/welcome/actions.ts` only grants it when the (simulated) user
  opts in and no GPC signal is present; day-one/week-one personas don't need
  it and granting it silently would misrepresent what "day-one" means.
- **VALIDATE**: No unit test for these (they're thin wrappers over already-
  tested domain functions — testing them meaningfully requires a live DB,
  which is what Task 8's end-to-end validation covers). Do add
  `scripts/persona/actions.test.ts` ONLY if a pure helper (e.g.
  `PRESENTATION`) is extracted; otherwise skip per YAGNI.

### Task 7: Persona definitions (`day-one`, `week-one`) and registry
- **ACTION**: Create `scripts/persona/defs/types.ts`,
  `scripts/persona/defs/day-one.ts`, `scripts/persona/defs/week-one.ts`,
  `scripts/persona/registry.ts`.
- **IMPLEMENT** — `defs/types.ts`:
  ```ts
  import type { Rng } from '../rng'
  import type { PersonaClock } from '../clock'
  import type { PersonaManifest } from '../manifest'

  export interface PersonaRunContext {
    userId: string
    email: string
    seed: number
    rng: Rng
    clock: PersonaClock
  }

  export interface PersonaDefinition {
    slug: string
    /** Returns the manifest fields this persona populates beyond the base five. */
    run(ctx: PersonaRunContext): Promise<Partial<PersonaManifest>>
  }
  ```
  `defs/day-one.ts`:
  ```ts
  import { consentAll, setUnit } from '../actions'
  import type { PersonaDefinition } from './types'

  export const dayOne: PersonaDefinition = {
    slug: 'day-one',
    async run({ userId }) {
      await consentAll(userId)
      await setUnit(userId, 'kg')
      return {}
    },
  }
  ```
  `defs/week-one.ts` (adopts a system template, backdated 5 days, 2 workouts):
  ```ts
  import { adoptTemplate } from '@/db/templates'
  import { setProgramStatus, getProgramDetail, listPrograms } from '@/db/programs'
  import { instantiateProgramDay } from '@/db/prescriptions'
  import { getWorkoutDetail, updateWorkout } from '@/db/workouts'
  import { TEMPLATE_OWNER_USER_ID } from '@/lib/template-owner'
  import { consentAll, setUnit } from '../actions'
  import type { PersonaDefinition } from './types'

  const DEFAULT_TEMPLATE_NAME = /* see GOTCHA — a fixed, documented name */

  export const weekOne: PersonaDefinition = {
    slug: 'week-one',
    async run({ userId, clock }) {
      await consentAll(userId)
      await setUnit(userId, 'kg')

      const templates = await listPrograms(TEMPLATE_OWNER_USER_ID)
      const template = templates.find((t) => t.name === DEFAULT_TEMPLATE_NAME)
      if (!template) throw new Error(
        `template "${DEFAULT_TEMPLATE_NAME}" not found under the system account — ` +
        'run `npm run db:seed-templates` against this database first',
      )

      const adopted = await adoptTemplate(userId, template.id)
      if (!adopted) throw new Error('adoptTemplate refused — check adopt gating in src/db/templates.ts')
      await setProgramStatus(userId, adopted.id, 'active', 'seed')

      const detail = await getProgramDetail(userId, adopted.id)
      const daysToPlay = detail.days.slice(0, 2)
      let workoutId = ''
      for (const day of daysToPlay) {
        const instantiated = await instantiateProgramDay(userId, day.id, 1, 'seed')
        if (!instantiated) throw new Error(`instantiateProgramDay returned null for day ${day.id}`)
        const prescribed = await getWorkoutDetail(userId, instantiated.id)
        const backdated = clock.daysAgo(5)
        await updateWorkout(
          userId,
          instantiated.id,
          {
            exercises: prescribed.exercises.map((ex) => ({
              wgerExerciseId: ex.wgerExerciseId,
              name: ex.name,
              sets: ex.sets.map((s) => ({ reps: s.reps, weight: s.weight, completed: true })),
            })),
            startedAt: backdated,
            completedAt: backdated,
          },
          { actor: 'seed', kind: 'original' },
        )
        workoutId = instantiated.id
      }
      return { programId: adopted.id, templateId: template.id, workoutId }
    },
  }
  ```
  `registry.ts`:
  ```ts
  import { dayOne } from './defs/day-one'
  import { weekOne } from './defs/week-one'
  import type { PersonaDefinition } from './defs/types'

  export const PERSONA_REGISTRY: Record<string, PersonaDefinition> = {
    'day-one': dayOne,
    'week-one': weekOne,
  }
  ```
- **MIRROR**: Task 6's `CONSENT_SEQUENCE`; `PREFLIGHT_ALL_OR_NOTHING` (the
  template-not-found and adopt-refused checks abort before any further
  writes for that persona, though earlier consent/unit writes in the same
  run already landed — see GOTCHA on partial-failure below).
- **IMPORTS**: `@/db/templates`, `@/db/programs`, `@/db/prescriptions`,
  `@/db/workouts`, `@/lib/template-owner` (verify this export path against
  `scripts/seed-templates.ts`'s own import of `TEMPLATE_OWNER_USER_ID`).
- **GOTCHA (exact shape of `getProgramDetail`/`getWorkoutDetail` fields)**:
  The field names used above (`detail.days`, `prescribed.exercises`,
  `ex.wgerExerciseId`, `ex.sets`) are inferred from `ExerciseInput`/`SetInput`
  and the general shape of `getProgramDetail`/`getWorkoutDetail`, but were
  not read verbatim during planning (only their signatures were confirmed:
  `getProgramDetail(userId, id)` at `src/db/programs.ts:81`,
  `getWorkoutDetail(userId, id)` at `src/db/workouts.ts:362`). **Read both
  functions' full return-type shape before writing this task** — the
  property names for nested days/exercises/sets may differ from the
  write-side `ProgramInput`/`WorkoutInput` shapes assumed here.
- **GOTCHA (which template)**: D-1 in the PRD proposes the GZCLP-shaped
  fixture already used in `src/app/status-hero.test.tsx` as the `veteran`
  default; `week-one` has no assigned default. Pick ONE fixed, documented
  template name for `week-one` (reuse the same GZCLP fixture for consistency
  unless it's unsuitable for a 2-workout snapshot) and hardcode it as
  `DEFAULT_TEMPLATE_NAME` — do not make this configurable in Phase 1 (YAGNI;
  a `--template` override can be added later if a second phase needs it).
- **GOTCHA (partial-run failure)**: If `week-one`'s template lookup or
  `adoptTemplate` throws AFTER `consentAll`/`setUnit` already ran, the user
  is left half-seeded (consented, but no program). This is acceptable for v1
  given C-7's "purge-then-reseed" idempotency strategy (Task 8's `--purge`
  cleans it up) — do not add transactional rollback across `@/db/*` calls
  that don't share a transaction; that's exactly the raw-SQL-adjacent
  complexity the PRD rejected in "Seeding layer: Through domain functions"
  (Decisions Log).
- **GOTCHA ("2 workouts done" vs 5-days-ago single date)**: The spec's
  `week-one` description ("adopted a library template 5 days ago, 2 workouts
  done") reads as *one* adoption event 5 days ago, with 2 workouts logged
  since. This plan simplifies to: both workouts backdated to exactly
  `clock.daysAgo(5)` (same timestamp). If the reviewer wants the two
  workouts spread across the 5-day window (e.g. day −5 and day −2, more
  realistic for `program-due`/`rest-day` derivation per
  `src/lib/home-status.ts`), adjust to `clock.daysAgo(5)` and
  `clock.daysAgo(2)` respectively — flagged here rather than silently picked,
  since it changes what `HomeState` the persona actually lands on.
- **VALIDATE**: Covered by Task 8's live-DB validation (these are
  integration-shaped, not unit-testable without a database).

### Task 8: CLI entrypoint
- **ACTION**: Create `scripts/seed-persona.ts`.
- **IMPLEMENT**:
  ```ts
  /**
   * Persona Foundry — materializes a named user state in the local database.
   *
   * MANUAL INVOCATION ONLY, LOCAL DATABASE ONLY. See scripts/persona/guard.ts.
   *
   * PREREQUISITES (run once against this database, in order):
   *   npm run db:seed-consent-docs
   *   npm run db:seed-templates        # only needed for personas that adopt a program
   *   npx workos@latest emulate --port 4100 --interactive   # in a separate terminal
   *
   *   npm run persona -- --persona day-one
   *   npm run persona -- --persona week-one --seed 7
   *   npm run persona -- --persona day-one --purge --commit
   */
  import { config } from 'dotenv'
  config({ path: '.env.local' })
  config()

  import { assertLocalDatabase } from './persona/guard'
  import { createRng } from './persona/rng'
  import { createClock } from './persona/clock'
  import { readManifest, writeManifest, deleteManifest } from './persona/manifest'

  assertLocalDatabase(process.env.DATABASE_URL ?? '', 'PERSONA_ALLOW_REMOTE_DB')

  interface Args {
    personas: string[]
    seed: number
    userId?: string
    purge: boolean
    commit: boolean
  }

  function parseArgs(argv: string[], knownSlugs: string[]): Args {
    const value = (flag: string) => {
      const i = argv.indexOf(flag)
      return i === -1 ? undefined : argv[i + 1]
    }
    const personaArg = value('--persona')
    if (!personaArg) throw new Error('usage: seed-persona --persona <slug|all> [--seed <n>] [--user-id <id>] [--purge [--commit]]')
    const seed = Number(value('--seed') ?? 42)
    if (Number.isNaN(seed)) throw new Error('--seed must be a number')
    return {
      personas: personaArg === 'all' ? knownSlugs : [personaArg],
      seed,
      userId: value('--user-id'),
      purge: argv.includes('--purge'),
      commit: argv.includes('--commit'),
    }
  }

  async function main(): Promise<void> {
    // deferred: only after the guard above has run
    const { PERSONA_REGISTRY } = await import('./persona/registry')
    const { createPersonaIdentity, deletePersonaIdentity, purgePersona } = await import('./persona/actions')

    const args = parseArgs(process.argv.slice(2), Object.keys(PERSONA_REGISTRY))

    for (const slug of args.personas) {
      const def = PERSONA_REGISTRY[slug]
      if (!def) throw new Error(`unknown persona "${slug}" — known: ${Object.keys(PERSONA_REGISTRY).join(', ')}`)

      if (args.purge) {
        const existing = await readManifest(slug)
        const targetId = args.userId ?? existing?.userId
        if (!targetId) { console.log(`[persona] ${slug}: nothing to purge`); continue }
        if (!args.commit) {
          console.info(`[persona] DRY RUN — would purge ${slug} (${targetId}). Re-run with --commit.`)
          continue
        }
        await purgePersona(targetId)
        if (!args.userId && existing) await deletePersonaIdentity(existing.userId)
        await deleteManifest(slug)
        console.log(`[persona] ${slug}: purged`)
        continue
      }

      const existing = await readManifest(slug)
      const identity = args.userId
        ? { id: args.userId, email: existing?.email ?? '(unknown — --user-id supplied)' }
        : (existing ?? (await createPersonaIdentity(slug)))

      const rng = createRng(args.seed)
      const anchor = new Date()
      const clock = createClock(anchor)
      const extra = await def.run({ userId: identity.id, email: identity.email, seed: args.seed, rng, clock })

      const manifest = { persona: slug, userId: identity.id, email: identity.email, seed: args.seed, anchor: anchor.toISOString(), ...extra }
      await writeManifest(slug, manifest)
      console.log(`[persona] ${slug}: seed=${args.seed} anchor=${manifest.anchor} userId=${identity.id} email=${identity.email}`)
    }
  }

  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error)
      process.exit(1)
    })
  ```
- **MIRROR**: `SCRIPT_HEADER_AND_DOTENV`, `DEFERRED_DYNAMIC_IMPORT`,
  `DRY_RUN_COMMIT_IDIOM`, `EXIT_HANDLING` — all from `scripts/seed-templates.ts`
  and `scripts/migrate-user-id.ts`.
- **IMPORTS**: `dotenv`, `./persona/guard`, `./persona/rng`,
  `./persona/clock`, `./persona/manifest` (all statically, all DB-import-free)
  — `./persona/registry` and `./persona/actions` only via `await import(...)`
  inside `main()`.
- **GOTCHA**: The guard call (`assertLocalDatabase(...)`) must run at module
  top level, immediately after the two `config()` calls and BEFORE `main()`
  is even defined/called — i.e., it must not be deferred into `main()`.
  Placing it at the top ensures it throws synchronously before the process
  does anything else, matching `playwright.config.ts`'s own top-level (not
  function-wrapped) placement.
- **GOTCHA**: `--user-id` mode skips `createPersonaIdentity` entirely (per
  C-1: "target an existing id instead of creating one") — this is also the
  seam Phase 5's clone-to-local composition (Q-4) will use
  (`npm run screens -- --user <email>` implies a manifest keyed by an
  existing, externally-created id). Don't special-case it away; keep the
  branch even though only `--user-id` + no `--purge` is exercised by Phase 1.
- **VALIDATE**: End-to-end, against a real local scratch database (see
  Validation Commands below) — this is the task where the whole engine gets
  proven, not a unit test.

### Task 9: Wire up `package.json` and `.gitignore`
- **ACTION**: Add the npm script and gitignore entry.
- **IMPLEMENT**:
  ```json
  "persona": "tsx scripts/seed-persona.ts"
  ```
  placed near `"db:seed-templates"` in `package.json`'s `scripts` block.
  In `.gitignore`, under the existing `# playwright` section, add:
  ```
  /e2e/.state/
  ```
- **MIRROR**: `"db:seed-templates": "tsx scripts/seed-templates.ts"` — bare
  `tsx scripts/<name>.ts`, args passed at the call site via `--`.
- **VALIDATE**: `npm run persona -- --persona day-one` resolves to the right
  file and forwards args correctly (`console.log(process.argv)` sanity check
  is enough — no dedicated test).

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `guard.test.ts` | `postgres://u:p@localhost:6543/db` | passes (no throw) | — |
| `guard.test.ts` | `postgres://u:p@db.supabase.co:6543/db`, no override env | throws, message names the host | Yes — the whole safety story |
| `guard.test.ts` | same remote URL + `PERSONA_ALLOW_REMOTE_DB=1` | passes | Yes — explicit override |
| `guard.test.ts` | `''` | throws | Yes — fail closed on missing config |
| `rng.test.ts` | `createRng(42)` sampled twice | identical 10-value sequences | Determinism (C-2) |
| `rng.test.ts` | `createRng(1)` vs `createRng(2)` | sequences differ | — |
| `clock.test.ts` | `createClock(anchor).daysAgo(5)` | `anchor - 5*86400000ms` exactly | — |
| `clock.test.ts` | `daysAgo(0)` | equals `anchor` | Boundary |
| `manifest.test.ts` | write then read `day-one` | round-trips byte-for-byte (parsed) | — |
| `manifest.test.ts` | read a slug never written | returns `null` | Empty/missing input |

### Edge Cases Checklist
- [x] Empty input — guard rejects an empty `DATABASE_URL`
- [ ] Maximum size input — N/A, no size-bounded input in this phase
- [x] Invalid types — CLI's `--seed` value is checked for `NaN` and throws a
      clear error rather than silently seeding with `NaN`
- [x] Concurrent access — N/A, single-process CLI, no concurrent runs
      expected (documented as a known non-goal rather than built for)
- [ ] Network failure — WorkOS emulator unreachable: Task 3's health-check
      GOTCHA covers this
- [x] Permission denied — N/A, local filesystem/DB, developer's own machine

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
npm run lint
```
EXPECT: Zero type errors, zero new lint errors.

### Unit Tests
```bash
npx vitest run scripts/persona
```
EXPECT: All new tests pass (guard, rng, clock, manifest).

### Full Test Suite
```bash
npm test
```
EXPECT: No regressions — in particular, confirm no existing code depended on
`WorkoutEventActor` being an exhaustive/closed union in a way that a switch
statement without a `default` would now fail to type-check (grep for
`satisfies WorkoutEventActor` or exhaustive switches over it before merging
Task 2).

### Database Validation
```bash
# Point at a local/disposable Postgres per this repo's existing convention
# (a docker-run one-liner or createdb — D-3 defers a docker-compose file).
# Confirm .env.local's DATABASE_URL is genuinely local before running this.
npm run persona -- --persona day-one
```
EXPECT: Prints `seed=... anchor=... userId=... email=persona_day-one@example.com`;
`e2e/.state/day-one.json` exists and matches the printed values.

### Browser Validation (manual — no automated screens rig until Phase 2)
```bash
npx workos@latest emulate --port 4100 --interactive &
npm run dev
```
- [ ] Sign in at `/sign-in` as `persona_day-one@example.com` (WorkOS emulator
      login) and confirm the app lands on `/` WITHOUT hitting `/welcome`
      (consent already recorded).
- [ ] Confirm `/` renders the `fresh` `HomeState` (day-one copy) per
      `src/lib/home-status.ts`.
- [ ] Confirm Settings shows weight unit = kg.
- [ ] Repeat for `week-one`: sign in, confirm `/` shows `program-due` or
      `rest-day` (per the actual backdated date chosen in Task 7), and that
      the adopted program appears under `/programs`.

### Manual Validation
- [ ] `npm run persona -- --persona day-one` then run it again — confirm the
      second run reuses the same `userId`/`email` (idempotent per C-7) rather
      than creating a second WorkOS identity.
- [ ] `npm run persona -- --persona day-one --purge` (no `--commit`) — prints
      a dry-run message, changes nothing (`e2e/.state/day-one.json` still
      exists, DB rows untouched).
- [ ] `npm run persona -- --persona day-one --purge --commit` — DB rows gone
      (`purgeUserData` ran), WorkOS identity deleted, manifest file deleted.
- [ ] Point `.env.local`'s `DATABASE_URL` at a fake non-local host string and
      confirm `npm run persona -- --persona day-one` aborts immediately with
      the guard's error, before any network call is attempted (add a
      temporary `console.log` or breakpoint in `createPersonaIdentity` during
      this check to confirm it's never reached).

---

## Acceptance Criteria
- [ ] All 9 tasks completed
- [ ] All validation commands pass
- [ ] Tests written and passing (guard, rng, clock, manifest)
- [ ] No type errors
- [ ] No lint errors
- [ ] `day-one` and `week-one` both produce the PRD's success signal: "Seeded
      user signs into `/` past the consent gate showing the correct
      `HomeState`"
- [ ] `--purge` leaves zero rows (verify with a manual `SELECT count(*)`
      sweep across the tables `purgeUserData` touches, for the purged
      `userId`)
- [ ] Pointing at a non-local host aborts before any connection

## Completion Checklist
- [ ] Code follows discovered patterns (dotenv → guard → deferred import →
      idempotent, exactly as in `scripts/seed-templates.ts`)
- [ ] Error handling matches codebase style (throw `Error` with an actionable
      message; no swallowed errors)
- [ ] Logging follows codebase conventions (`console.log`/`console.info`/
      `console.error` at the script/CLI layer only — never inside `@/db/*`
      or the action wrappers, matching `scripts/migrate-user-id.ts`'s style)
- [ ] Tests follow `TEST_STRUCTURE` (vitest `describe`/`it`/`expect`,
      co-located `*.test.ts`)
- [ ] No hardcoded values beyond the two intentionally-fixed ones (email
      convention, default template name) — both documented inline as
      deliberate, not accidental
- [ ] No unnecessary scope additions — no freestyle/program-engine/screens/
      clone-to-local code written ahead of its phase
- [ ] Self-contained — the three GOTCHAs flagged as "verify before
      implementing" (GrantSource literal, getProgramDetail/getWorkoutDetail
      field shapes, WorkoutEventActor phase-timing decision) are the only
      remaining open items, and each has a clear resolution path documented
      above

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `WorkoutEventActor` gains `'seed'` in Phase 1 instead of Phase 3 as the PRD phase table specifies | Certain (this plan does it deliberately) | Low — additive type change, but a reviewer following the PRD literally may flag it as scope creep | Called out explicitly in Task 2's GOTCHA and here; easy to revert to `'system'` if the reviewer prefers strict phase adherence |
| `getProgramDetail`/`getWorkoutDetail` return shapes don't match the field names assumed in Task 7's `week-one` code sketch | Medium | Medium — `week-one` implementation needs adjustment, but the call sequence (adopt → activate → instantiate → updateWorkout) is confirmed correct | Task 7's GOTCHA calls this out; read both functions' full bodies before writing this file, not just their signatures |
| `GrantSource` literal used in `grantTier` is a guess (`'ops'`) | Low-Medium | Low — a type error at compile time, not a runtime bug | `tsc --noEmit` catches it immediately; Task 6's GOTCHA flags it |
| WorkOS emulator's user store doesn't persist across restarts, breaking manifest-based idempotency | Unknown (not verified this session) | Low — worst case is a clear, documented recovery step (`rm e2e/.state/<slug>.json`) | Task 3's GOTCHA documents the recovery path; verify actual behavior during implementation and update the header docblock with the real answer |
| A developer sets `WORKOS_E2E_API_BASE` to a non-local URL, pointing persona creation at a real WorkOS environment | Low | High if it happens (creates real accounts) | Task 3 adds a loopback-only guard on the emulator origin, mirroring the DB host guard |

## Notes

- This plan intentionally pulls one item forward from the PRD's Phase 3 scope
  (`'seed'` on `WorkoutEventActor`) because Phase 1's own `week-one` persona
  needs it. This is flagged three times in this document (Task 2, the Risks
  table, and here) so it can't be missed in review — accept it, or swap to
  `'system'` for Phase 1 and let Phase 3 migrate it, per the alternative
  documented in Task 2.
- Two design decisions were made without an explicit PRD answer and should be
  confirmed with the owner before/during implementation rather than assumed
  silently:
  1. Which fixed template `week-one` adopts (this plan defaults to the same
     GZCLP fixture proposed for `veteran` in D-1, for consistency — but
     `week-one` might want something shorter/simpler).
  2. Whether `week-one`'s two workouts land on the same backdated day or are
     spread across the 5-day window (this plan defaults to same-day for
     simplicity; spreading them changes which `HomeState` the persona lands
     on).
- Per D-5's default, `npm run db:seed-templates` is a **documented
  prerequisite**, not something `week-one`'s definition invokes itself —
  this plan follows that default. The script's header docblock lists it
  explicitly.
