# Plan: Persona Foundry — Phase 2: Screens Rig

## Summary

Build a Playwright-driven "screens rig": sign in once per seeded persona
(reusing `e2e/auth.ts`'s existing emulator flow via `storageState`), walk a
checked-in route manifest covering every capturable page in the app, and
attach each screenshot to the Playwright HTML report so `npx playwright
show-report` becomes a browsable gallery. Adds a dedicated Playwright config
(`playwright.screens.config.ts`) and an orchestration script (`npm run
screens`) so the existing `npm run test:e2e` suite is untouched.

## User Story

As the solo developer/owner, I want one command to sign in as any seeded
persona (or an arbitrary existing user by email) and see every screen they'd
see, so I can review a surface's real states without manually logging in and
clicking through the app.

## Problem → Solution

Today: every page is a DB-backed server component behind auth; the only way
to see a given user's screens is to actually be that user in a browser.
Phase 1 can materialize a user's data, but nothing walks their screens. →
After this phase: `npm run screens -- --persona veteran` (or `-- --user
someone@example.com`) produces a full, browsable screenshot gallery with zero
manual logins.

## Metadata

- **Complexity**: Large
- **Source PRD**: `.claude/PRPs/prds/persona-foundry.prd.md`
- **PRD Phase**: Phase 2 — Screens rig
- **Estimated Files**: 9 create, 3 update

---

## UX Design

### Before

```
┌────────────────────────────────────────────┐
│ Developer wants to see "veteran" persona's  │
│ /programs/[id]/stats page:                  │
│  1. Start dev server                        │
│  2. Start workos emulate                    │
│  3. Manually sign in as persona_veteran@... │
│  4. Click through consent (if not done)     │
│  5. Navigate to /programs                   │
│  6. Find the right program id               │
│  7. Click into it, click Stats              │
│  8. Repeat steps 3-7 for every other route  │
│     and every other persona                 │
└────────────────────────────────────────────┘
```

### After

```
┌────────────────────────────────────────────┐
│ npm run screens -- --persona veteran        │
│  → seeds veteran if no manifest exists      │
│  → signs in once, saves storageState        │
│  → walks every route in the manifest        │
│  → npx playwright show-report               │
│     shows a grid of every screen, phone +   │
│     desktop where it matters — zero logins  │
└────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Reviewing a persona's screens | Manual sign-in + click-through per route | One command, one report | |
| Adding a new persona | N/A (Phase 1) | Automatically picked up by the rig once `npm run persona -- --persona <slug>` has run | Rig discovers personas via `e2e/.state/*.json`, never hardcodes the roster |
| Reviewing an arbitrary real-ish user | Not possible | `npm run screens -- --user <email>` | Best-effort: param routes it can't resolve are skipped and logged, not failed |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `playwright.config.ts` | 1-78 | The exact host-guard shape and `webServer` pattern to mirror in the new config |
| P0 | `e2e/auth.ts` | 1-159 | `signIn()` is reused as-is (minus one signature narrowing, see Task 1); `TestUser`, emulator origin conventions |
| P0 | `scripts/persona/manifest.ts` | 1-42 | `PersonaManifest` shape and `readManifest()` — how the rig resolves param routes |
| P0 | `scripts/persona/guard.ts` | 1-33 | `assertLocalDatabase()` — copy the same fail-closed shape into the new config |
| P0 | `docs/specs/personas-and-screens.md` | §06 (G-1..G-7) | The full normative requirements this phase implements |
| P1 | `e2e/visual.spec.ts` | 1-72 | The project's existing ready-signal idiom (`getByText(...).toBeVisible({timeout: 15_000})`, never `networkidle`) and viewport constants (`PHONE`/`DESKTOP`) |
| P1 | `e2e/app-origin.ts` | 1-16 | `APP_ORIGIN`/`APP_PORT` — reuse, do not re-derive |
| P1 | `scripts/persona/actions.ts` | 15-32, 57-81 | Emulator API conventions (`EMULATOR_ORIGIN`, `LOCAL_ORIGIN_PATTERN`, `readUserId`) — mirrored by the new `--user` email lookup |
| P1 | `scripts/seed-persona.ts` | 1-128 | The `dotenv` → guard → dynamic-import ordering convention the new orchestration script must also follow |
| P2 | `src/app/exercises/exercise-ref.ts` | 1-35 | `parseExerciseRef`/`exerciseHref` — the ONLY correct way to build/parse an exercise route param; confirms `exerciseRef` is `<'wger'|'custom'>:<positive integer>`, never a UUID |
| P2 | `src/db/exercise-stats.ts` | 437-449, 456-470 (`LoggedExercise`), 607-612 (`listLoggedExercises`) | Runtime `exerciseRef` derivation for `--user` mode |
| P2 | `src/db/programs.ts` | 55-61 (`listPrograms`) | Runtime `programId` derivation for `--user` mode |
| P2 | `src/db/workouts.ts` | 109-111 (`listWorkoutSummaries`) | Runtime `workoutId` derivation for `--user` mode |
| P2 | `src/db/program-shares.ts` | 134-151 (`getActiveShare`) | Runtime `programShareToken` derivation (null-safe: most users have no active share) |
| P2 | `src/db/workout-shares.ts` | 85-102 (`getActiveWorkoutShare`) | Runtime `workoutShareToken` derivation (null-safe) |
| P2 | `.gitignore` | full | Confirm `/e2e/.state/` already ignored; `playwright/.auth/` and `/screens/` are NOT yet — must add |
| P2 | `messages/en.json` | as needed per route | Source of truth for ready-signal literal strings — DO NOT invent copy |

## External Documentation

No external research needed — this phase uses only Playwright APIs already
in use elsewhere in the repo (`storageState`, `testInfo.attach`, `projects`,
`dependencies`, `use` options). No new dependency is added.

---

## Patterns to Mirror

### GUARD_SHAPE
// SOURCE: playwright.config.ts:9-25
```ts
const directUrl = process.env.DATABASE_URL_DIRECT ?? ''
const isLocalDb = /@(localhost|127\.0\.0\.1|host\.docker\.internal|db):/.test(directUrl)
if (directUrl && !isLocalDb && process.env.E2E_ALLOW_REMOTE_DB !== '1') {
  const host = directUrl.replace(/^.*@/, '').replace(/[/?].*$/, '')
  throw new Error(
    `Refusing to run e2e against a non-local database (${host}).\n` + '...',
  )
}
```
Copy this verbatim (same env vars, same escape hatch — `screens` is part of
the same e2e surface, not a separate safety domain) into
`playwright.screens.config.ts`, before `defineConfig(...)`. Do not extract a
shared helper — `playwright.config.ts` is out of scope for this phase and the
project already tolerates this duplication (it's also duplicated, in a
different shape, in `scripts/persona/guard.ts`).

### READY_SIGNAL
// SOURCE: e2e/visual.spec.ts:41-43, 51-55
```ts
await page.goto('/')
await expect(page.getByText('Day one.')).toBeVisible({ timeout: 15_000 })
await expect(page).toHaveScreenshot('home-phone.png', { fullPage: true })
```
Never use `networkidle` — PostHog polls, drawers refetch on focus. Every
route manifest entry's `readySignal` must be a content assertion like this,
not a network-idle wait.

### EMULATOR_SIGN_IN
// SOURCE: e2e/auth.ts:101-118
```ts
export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/sign-in')
  const emailField = page.getByLabel(/email/i).or(page.locator('input[type="email"], input[name="email"]')).first()
  await emailField.waitFor({ state: 'visible', timeout: 30_000 })
  await emailField.fill(user.email)
  await page.getByRole('button', { name: /continue|sign in|log in/i }).first().click()
  await page.waitForURL((url) => url.origin === APP_ORIGIN, { timeout: 30_000 })
  await acceptRequiredConsents(page)
}
```
The function body only ever reads `user.email` — `id`/`password` are dead
weight for this call site. Task 1 narrows the parameter type so the screens
rig can sign in with only an email (no fabricated placeholder strings).

### MANIFEST_READ
// SOURCE: scripts/persona/manifest.ts:30-37
```ts
export async function readManifest(slug: string): Promise<PersonaManifest | null> {
  try {
    return JSON.parse(await readFile(join(STATE_DIR, `${slug}.json`), 'utf8')) as PersonaManifest
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
```
Pure `node:fs` — no `@/db` import, safe to call from `playwright.screens.config.ts`
at config-eval time (BEFORE the webServer/guard even matters) to discover
which personas exist.

### DOTENV_GUARD_DYNAMIC_IMPORT_ORDER
// SOURCE: scripts/seed-persona.ts:15-28
```ts
import { config } from 'dotenv'
config({ path: '.env.local' })
config()
import { assertLocalDatabase } from './persona/guard'
assertLocalDatabase(process.env.DATABASE_URL ?? '', 'PERSONA_ALLOW_REMOTE_DB')
```
The new `scripts/run-screens.ts` orchestrator follows this exact order:
dotenv, then guard, then (only after both pass) anything that could reach
`@/db`.

### EMULATOR_API_CALL
// SOURCE: scripts/persona/actions.ts:16-24, 57-81
```ts
const EMULATOR_ORIGIN = process.env.WORKOS_E2E_API_BASE ?? 'http://localhost:4100'
const EMULATOR_API_KEY = 'sk_test_default'
const WORKOS_API = `${EMULATOR_ORIGIN}/user_management`
const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal|db)(:\d+)?\/?$/
```
Reused verbatim (same constants, same local-origin guard) by the `--user`
email-lookup helper (Task 8) — never point this at a real WorkOS origin.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `e2e/auth.ts` | UPDATE | Narrow `signIn()`'s parameter to `Pick<TestUser, 'email'>` — the body never reads `id`/`password`; the screens rig has neither for arbitrary `--user` targets |
| `playwright.screens.config.ts` | CREATE | Dedicated Playwright config: host guard, webServer, dynamically generated `setup:<slug>`/`capture:<slug>` projects |
| `e2e/screens/fixtures.ts` | CREATE | `personaSlug` project-option fixture shared by setup and capture specs |
| `e2e/screens/setup.spec.ts` | CREATE | Signs in once per persona (or `--user` target), saves `playwright/.auth/<slug>.json` |
| `e2e/screens/route-manifest.ts` | CREATE | Checked-in `RouteSpec[]`: path template, param source, ready signal, lane, viewports — G-2/G-3/G-4 |
| `e2e/screens/resolve-manifest.ts` | CREATE | Resolves the per-run param values: `readManifest(slug)` for persona mode, best-effort live DB derivation for `--user` mode |
| `e2e/screens/capture.spec.ts` | CREATE | Loop-generates one test per (route × viewport); navigates, asserts the ready signal, attaches a full-page screenshot via `testInfo.attach()` |
| `scripts/run-screens.ts` | CREATE | `npm run screens` entrypoint: guard → seed-if-missing → spawn `playwright test --config=playwright.screens.config.ts` |
| `package.json` | UPDATE | Add `"screens": "tsx scripts/run-screens.ts"` |
| `.gitignore` | UPDATE | Add `/playwright/.auth/` and `/screens/` (captured PNGs are gallery artifacts, not committed baselines — G-7 defers baseline promotion) |

## NOT Building

- Diff-lane baselines / `toHaveScreenshot()` promotion (G-7) — every route is
  captured via `testInfo.attach()` only in this phase; the `lane` field on
  each `RouteSpec` records future eligibility but nothing acts on it yet.
- Clone-to-local (`--user` mode's identity source) — Phase 5. This phase's
  `--user <email>` support only needs an email that already resolves to a
  real emulator user and existing data; it does not create one.
- Full parity between `--user` mode and persona-manifest mode: `--user`
  resolves `workoutId`/`programId`/`exerciseRef`/share tokens live from the
  database on a best-effort basis. Any field it cannot resolve (e.g. no
  active share) causes that specific param route to be skipped for that run,
  logged to the console — not a failed run.
- CI wiring, nightly runs (Could-priority, waits on CI existing at all).
- A light-theme capture axis (the app is dark-only; not a product change this
  phase should make).
- New personas beyond `day-one`/`week-one` (Phase 3/4 territory) — the rig
  must work with whatever `e2e/.state/*.json` files exist, full stop.
- Editing `playwright.config.ts` or `e2e/global.setup.ts` — the new config is
  fully separate so `npm run test:e2e` is provably unchanged.

---

## Route Manifest (G-2 / G-3 / G-4)

Full survey of every `page.tsx` under `src/app/`. `needs verification` means:
confirm the exact literal string in `messages/en.json` (or via a manual
render) while implementing Task 5 — do not guess copy.

| Path | Param source | Ready signal | Auth | Lane | Viewports | Notes |
|---|---|---|---|---|---|---|
| `/` | none | `getByText(...)` — one of the 7 `HomeState` copy lines (`src/lib/home-status.ts:49-56`); varies per persona | yes | diffable | phone, desktop | The single most important row — every persona MUST render a distinct, correct state here |
| `/history` | none | `getByText('History')` | yes | diffable | phone | Empty vs populated differs |
| `/stats` | none | `getByText('This Week')` (needs verification) | yes | diffable | phone | `?window=`/`?tz=` — capture default only |
| `/goals` | none | `getByText('Goals')` | yes | diffable | phone | Empty vs populated differ |
| `/notes` | none | `getByText('Notes')` | yes | diffable | phone | |
| `/trophies` | none | `getByText('Trophies')` | yes | diffable | phone | Empty vs earned differ |
| `/exercises` | none | `getByText('Exercises')` | yes | diffable | phone | |
| `/exercises/new` | none | `getByText('New custom exercise')` | yes | diffable | phone | No query params |
| `/exercises/[source]/[id]` | `exerciseRef` (split on `:`) | `getByText(exerciseName)` — dynamic, resolved from the same read used to build the ref | yes | diffable | phone | Skip if `exerciseRef` unresolved (fresh persona with no logged exercises) |
| `/workout/new` | none | `getByText('New Workout')` | yes | diffable | phone | No query params |
| `/workout/[id]` | `workoutId` | `getByText(workout.name ?? untitledFallback)` (needs verification: `Workout.untitledWorkout` key) | yes | diffable | phone | Skip if unresolved |
| `/workout/[id]/edit` | `workoutId` | `getByRole('heading')` (needs verification) | yes | diffable | phone | Skip if unresolved |
| `/programs` | none | `getByRole('heading')` (needs verification — no-program vs populated) | yes | diffable | phone, desktop | |
| `/programs/new` | none | `getByText('New Program')` | yes | diffable | phone | |
| `/programs/[id]` | `programId` | `getByText(program.name)` — dynamic | yes | diffable | phone, desktop | Skip if unresolved |
| `/programs/[id]/about` | `programId` | `getByText('About')` (`ProgramAbout.eyebrow`) | yes | diffable | phone | Skip if unresolved |
| `/programs/[id]/edit` | `programId` | `getByText('Edit Program')` | yes | diffable | phone | Skip if unresolved |
| `/programs/[id]/editor` | `programId` | `getByRole('heading')` (needs verification) | yes | diffable | phone, desktop | Skip if unresolved |
| `/programs/[id]/editor/[day]` | `programId` + literal `1` for `day` | `getByRole('heading')` (needs verification) | yes | diffable | phone, desktop | Junk day falls back to structure view, not a 404 — safe default |
| `/programs/[id]/stats` | `programId` | `getByText('Sessions')` (`ProgramStats.facts.sessions`, needs verification) | yes | diffable | phone | Skip if unresolved |
| `/programs/templates` | none | `getByText('Program templates')` | yes | **gallery-only** | phone | Live third-party wger data |
| `/programs/templates/[id]` | `templateId` | `getByRole('heading')` (needs verification) | yes | **gallery-only** | phone | Live wger data unless a curated UUID template exists; keep gallery-only either way for consistency |
| `/templates` | none | `getByText('Session templates')` | yes | diffable | phone | |
| `/templates/[id]` | `templateId` (session-template uuid — distinct id space from program templates above) | `getByRole('heading')` (needs verification) | yes | diffable | phone | Skip if unresolved |
| `/settings` | none | `getByText('Settings')` | yes | diffable | phone | |
| `/settings/account` | none | `getByText('Account')` | yes | diffable | phone | |
| `/settings/account/name` | none | `getByRole('heading')` (needs verification) | yes | diffable | phone | |
| `/settings/account/mfa` | none | `getByRole('heading')` (needs verification) | yes | diffable | phone | 404s if `!account.mfaAvailable` — env-gated; verify it renders in the dev environment before adding to the default manifest, otherwise mark `enabled: false` |
| `/settings/home` | none | `getByRole('heading')` (needs verification) | yes | diffable | phone | |
| `/settings/import` | none | `getByText('Import history')` | yes | diffable | phone | |
| `/settings/plan` | none | `getByText('Plan')` | yes | diffable | phone | Checkout panel only if `NEXT_PUBLIC_RC_WEB_BILLING_KEY` set — acceptable either way |
| `/settings/delete-account` | none | `getByText('Delete account')` | yes | diffable | phone | **Do not click anything on this page** — capture only |
| `/body` | none | `getByText('Body')` (needs verification) | yes | **gallery-only** | phone | Signed private-bucket photo URLs |
| `/coach` | none | `getByRole('heading')` (needs verification) | yes | **gallery-only** | phone | LLM-generated content |
| `/welcome` | none | `getByText('Your data, your call')` | yes | diffable | phone | Only meaningful for an unconsented persona; all current defs pre-consent, so this captures the post-redirect home for now — acceptable, revisit when an unconsented persona exists |
| `/p/[token]` | `programShareToken` | `getByText(program.name)` — dynamic | no | diffable | phone | Skip if no active share (most personas) |
| `/w/[token]` | `workoutShareToken` | `getByText('Open your workout')` (`SharedWorkout.openAction`, needs verification it's always present) | no | diffable | phone | Skip if no active share |
| `/privacy` | none | `getByRole('heading')` matching "Privacy Policy" | no | diffable | phone | |
| `/terms` | none | `getByRole('heading')` matching "Terms of Service" | no | diffable | phone | |
| `/health-privacy` | none | `getByRole('heading', { name: 'Consumer Health Data Privacy Policy' })` | no | diffable | phone | |

**Excluded entirely** (per spec §06 G-3 and §08): `/ops`, `/ops/billing`,
`/ops/product` (vendor allowlist keyed by a user id, out of scope). `/bodyweight`
is a hard `permanentRedirect('/body')` with no renderable content of its own —
omitted; `/body` already covers it.

### `RouteSpec` shape (Task 4)

```ts
export interface RouteSpec {
  /** Human-readable slug for the screenshot filename, e.g. 'programs-detail'. */
  slug: string
  /** Path template with `:param` placeholders, e.g. '/programs/:programId'. */
  pathTemplate: string
  /** Which resolved-manifest field(s) fill the template's params. Empty for static routes. */
  params: Array<{ name: string; source: keyof ResolvedManifest | 'literal'; literal?: string }>
  /** Playwright locator description executed against the live page — see Task 6. */
  readySignal: (page: Page, resolved: ResolvedManifest) => Locator
  lane: 'diffable' | 'gallery-only'
  viewports: Array<'phone' | 'desktop'>
}
```

`ResolvedManifest` (Task 5) is `PersonaManifest` fields minus `persona`/
`seed`/`anchor` (irrelevant to routing), i.e. `userId`, `email`, `workoutId`,
`programId`, `templateId`, `exerciseRef`, `programShareToken`,
`workoutShareToken` — all optional except `userId`/`email`.

---

## Step-by-Step Tasks

### Task 1: Narrow `signIn()`'s parameter type
- **ACTION**: In `e2e/auth.ts`, change `signIn(page: Page, user: TestUser)` to
  `signIn(page: Page, user: Pick<TestUser, 'email'>)`.
- **IMPLEMENT**: Update the signature only; the function body already reads
  only `user.email`. No other file needs a change — existing callers pass a
  full `TestUser`, which still satisfies the narrower type.
- **MIRROR**: EMULATOR_SIGN_IN pattern above.
- **IMPORTS**: none new.
- **GOTCHA**: Grep for other `signIn(` call sites before editing to confirm
  none destructure `user.id`/`user.password` inside a callback passed
  alongside — none currently do (`grep -rn "signIn(" e2e/*.spec.ts`), but
  re-verify after this task's own changes land elsewhere in this plan.
- **VALIDATE**: `npx tsc --noEmit` — zero new errors in any `e2e/*.spec.ts`.

### Task 2: `.gitignore` additions
- **ACTION**: Add `/playwright/.auth/` and `/screens/` to `.gitignore`.
- **IMPLEMENT**: Two new lines, grouped under the existing `# playwright`
  section (which already has `/playwright-report/`, `/playwright/.cache/`,
  `/e2e/.state/`).
- **MIRROR**: existing `.gitignore` playwright block.
- **VALIDATE**: `git status` after a dry run shows no `playwright/.auth/*` or
  `screens/*` files as untracked-but-visible noise.

### Task 3: `playwright.screens.config.ts`
- **ACTION**: Create the dedicated config. Structure:
  1. `process.loadEnvFile('.env.local')` (mirrors `playwright.config.ts:7`).
  2. GUARD_SHAPE pattern, copied verbatim.
  3. `readdirSync('e2e/.state')` (wrapped in try/catch — the directory may
     not exist on a fresh checkout; treat `ENOENT` as `[]`), `.filter(f =>
     f.endsWith('.json'))`, strip the extension → `personaSlugs: string[]`.
  4. If `process.env.SCREENS_TARGET_USER` is set, push `'user'` onto
     `personaSlugs` (a synthetic slug — Task 5/6 branch on `slug === 'user'`
     to read the env var instead of a manifest file).
  5. Build `projects` by mapping `personaSlugs` to TWO entries each:
     `{ name: \`setup:${slug}\`, testDir: './e2e/screens', testMatch: /setup\.spec\.ts/, use: { personaSlug: slug } }`
     and
     `{ name: \`capture:${slug}\`, testDir: './e2e/screens', testMatch: /capture\.spec\.ts/, dependencies: [\`setup:${slug}\`], use: { ...devices['Desktop Chrome'], storageState: \`playwright/.auth/${slug}.json\`, personaSlug: slug, reducedMotion: 'reduce' } }`.
  6. Same `webServer` array as `playwright.config.ts` (the emulator + dev
     server pair) — copy verbatim; do not import or re-export it from the
     main config (keeps the two configs independently readable, matching
     the project's existing tolerance for this kind of duplication).
  7. `fullyParallel: false`, `workers: 1` (same as main config — one shared
     dev server, avoid port/DB races), `reporter: [['html', { open: 'never' }]]`
     (the gallery viewer — NOT `'list'`, since the report itself is the
     deliverable here).
- **MIRROR**: `playwright.config.ts` in full (GUARD_SHAPE + webServer block).
- **IMPORTS**: `import { defineConfig, devices } from '@playwright/test'`,
  `import { readdirSync } from 'node:fs'`, `import { APP_ORIGIN, APP_PORT } from './e2e/app-origin'`.
- **GOTCHA**: Do NOT import `scripts/persona/registry.ts` or
  `scripts/persona/actions.ts` here — both transitively import `@/db/*`,
  which connects to `DATABASE_URL` at module load
  (`src/db/index.ts:7`). Config files execute before any per-test guard
  would run, so this would silently reintroduce the exact prod-write risk
  Phase 1's guard exists to prevent. Persona discovery MUST stay
  filesystem-only (`e2e/.state/*.json`), which has no such import chain.
- **VALIDATE**: `npx tsc --noEmit`; `npx playwright test --config=playwright.screens.config.ts --list` prints the expected `setup:*`/`capture:*` project names with zero errors (run against a scratch DB per the plan's Manual Validation section — do not run this against `.env.local` if it points at prod).

### Task 4: `e2e/screens/route-manifest.ts`
- **ACTION**: Encode the full Route Manifest table above as a checked-in
  `RouteSpec[]` (shape defined in that section).
- **IMPLEMENT**: One entry per table row. Ready signals resolved from
  `messages/en.json` — replace every "needs verification" cell with the
  confirmed literal string found there (or the confirmed dynamic-value
  strategy, e.g. `page.getByText(resolved.programName ?? '')` for `/programs/[id]`
  — `resolved` is threaded in from Task 6's per-test resolution, so
  `readySignal` should be typed to accept the resolved manifest, not just the
  page: `readySignal: (page: Page, resolved: ResolvedManifest) => Locator`.
- **MIRROR**: READY_SIGNAL pattern above; `e2e/visual.spec.ts`'s existing
  literal-text assertions are the calibration for "how specific is
  specific enough" (whole phrases, not single common words).
- **IMPORTS**: `import type { Page, Locator } from '@playwright/test'`.
- **GOTCHA**: For `/programs/[id]/editor/[day]`, the `day` param has no
  manifest source — use `{ name: 'day', source: 'literal', literal: '1' }`
  per the `RouteSpec.params` shape above.
- **VALIDATE**: `npx tsc --noEmit`; manually eyeball the table against
  `messages/en.json` — every non-"needs verification" string must appear
  verbatim in that file (`grep -F "<string>" messages/en.json`).

### Task 5: `e2e/screens/resolve-manifest.ts`
- **ACTION**: Resolve a `ResolvedManifest` for either mode.
- **IMPLEMENT**:
  ```ts
  export interface ResolvedManifest {
    userId: string
    email: string
    workoutId?: string
    programId?: string
    templateId?: string
    exerciseRef?: string
    programShareToken?: string | null
    workoutShareToken?: string | null
  }

  export async function resolveManifest(slug: string): Promise<ResolvedManifest> {
    if (slug === 'user') return resolveRuntimeManifest(process.env.SCREENS_TARGET_USER!)
    const m = await readManifest(slug)
    if (!m) throw new Error(`no manifest for persona "${slug}" — run \`npm run persona -- --persona ${slug}\` first`)
    return m
  }
  ```
  `resolveRuntimeManifest(email)`:
  1. Look up the emulator user id via `GET {EMULATOR_ORIGIN}/user_management/users?email=<email>`
     (mirrors EMULATOR_API_CALL pattern; verify the emulator honors an
     `email` query filter by hitting it manually first — if it 400s or
     ignores the param, fall back to `GET /users` unfiltered and find the
     matching `email` client-side).
  2. In parallel: `listWorkoutSummaries(userId)` (take the newest → `workoutId`),
     `listPrograms(userId)` (take the newest → `programId`, run
     `getActiveShare(userId, programId)` → `programShareToken`),
     `listLoggedExercises(userId)` (take the first → `exerciseRef =
     \`${source}:${wgerExerciseId}\``, using `parseExerciseRef`/`exerciseHref`'s
     format, never inventing a different one).
  3. `getActiveWorkoutShare(userId, workoutId)` → `workoutShareToken` (only if
     `workoutId` resolved).
  4. `templateId` has no generic "most recent" read — leave `undefined` for
     `--user` mode (log once: `console.log('[screens] --user mode cannot
     resolve templateId; /templates/[id] and /programs/templates/[id] will be
     skipped')`).
  5. Any field that can't be resolved (empty list, no active share) stays
     `undefined`/`null` — never throw for a missing optional field.
- **MIRROR**: MANIFEST_READ pattern (persona branch); EMULATOR_API_CALL
  pattern (the `--user` branch's fetch call).
- **IMPORTS**: `import { readManifest } from '../../scripts/persona/manifest'`,
  `import { listWorkoutSummaries } from '@/db/workouts'`,
  `import { listPrograms } from '@/db/programs'`,
  `import { getActiveShare } from '@/db/program-shares'`,
  `import { getActiveWorkoutShare } from '@/db/workout-shares'`,
  `import { listLoggedExercises } from '@/db/exercise-stats'`.
- **GOTCHA**: This file DOES import `@/db/*`, which connects at import time.
  That's safe HERE (unlike Task 3's config file) because by the time any
  `*.spec.ts` file runs, `playwright.screens.config.ts` has already
  synchronously executed its own GUARD_SHAPE check — the process would have
  already thrown before Playwright even got to running a test. Do not
  duplicate the guard check inside this file; it would be redundant, and a
  second guard reading a possibly-different env snapshot is a footgun, not a
  safety improvement.
- **VALIDATE**: `npx tsc --noEmit`. Manual: with a scratch DB and a seeded
  `day-one` persona, `resolveManifest('day-one')` returns `{userId, email}`
  with all optional fields `undefined` (day-one has no workouts/programs).

### Task 6: `e2e/screens/fixtures.ts`
- **ACTION**: Declare the `personaSlug` project-option fixture.
- **IMPLEMENT**:
  ```ts
  import { test as base } from '@playwright/test'

  export interface ScreensFixtures {
    personaSlug: string
  }

  export const test = base.extend<ScreensFixtures>({
    personaSlug: ['', { option: true }],
  })
  export { expect } from '@playwright/test'
  ```
- **MIRROR**: Playwright's documented `test.extend` + `{ option: true }`
  pattern for project-level config (no existing in-repo precedent — this is
  the one genuinely new Playwright idiom this phase introduces).
- **IMPORTS**: `@playwright/test`.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 7: `e2e/screens/setup.spec.ts`
- **ACTION**: One test that signs in and saves `storageState`.
- **IMPLEMENT**:
  ```ts
  import { test } from './fixtures'
  import { signIn } from '../auth'
  import { resolveManifest } from './resolve-manifest'

  test('sign in and save storage state', async ({ page, personaSlug }) => {
    const resolved = await resolveManifest(personaSlug)
    await signIn(page, { email: resolved.email })
    await page.context().storageState({ path: `playwright/.auth/${personaSlug}.json` })
  })
  ```
- **MIRROR**: EMULATOR_SIGN_IN pattern; G-1's "signs in once per persona
  through the existing emulator `signIn()` flow ... saves
  `playwright/.auth/<persona>.json`".
- **IMPORTS**: as shown.
- **GOTCHA**: `resolveManifest` is called AGAIN in `capture.spec.ts` (Task 8)
  — this duplicates one `readManifest`/DB-read round-trip per persona per
  run. Acceptable: `readManifest` is a single small file read, and the
  `--user` DB reads are cheap relative to sign-in's own network round-trips.
  Do not add cross-project caching for this — it's not worth the complexity
  in a dev-only tool.
- **VALIDATE**: Against a scratch DB with `day-one` seeded:
  `npx playwright test --config=playwright.screens.config.ts --project="setup:day-one"`
  passes and creates `playwright/.auth/day-one.json`.

### Task 8: `e2e/screens/capture.spec.ts`
- **ACTION**: Loop-generate one test per `(route, viewport)` pair; navigate,
  assert, screenshot, attach.
- **IMPLEMENT**:
  ```ts
  import { test } from './fixtures'
  import { expect } from '@playwright/test'
  import { ROUTE_MANIFEST } from './route-manifest'
  import { resolveManifest } from './resolve-manifest'
  import { buildPath } from './build-path'

  const VIEWPORT_SIZES = {
    phone: { width: 390, height: 844 },
    desktop: { width: 1280, height: 900 },
  } as const

  for (const route of ROUTE_MANIFEST) {
    for (const viewport of route.viewports) {
      test(`${route.slug} @ ${viewport}`, async ({ page, personaSlug }, testInfo) => {
        const resolved = await resolveManifest(personaSlug)
        const { path, missing } = buildPath(route.pathTemplate, route.params, resolved)
        test.skip(missing.length > 0, `unresolved params: ${missing.join(', ')}`)

        await page.setViewportSize(VIEWPORT_SIZES[viewport])
        await page.goto(path)
        await expect(route.readySignal(page, resolved)).toBeVisible({ timeout: 15_000 })

        const png = await page.screenshot({ fullPage: true })
        await testInfo.attach(`${route.slug}@${viewport}`, { body: png, contentType: 'image/png' })
      })
    }
  }
  ```
- **MIRROR**: READY_SIGNAL pattern; G-5 ("full-page, ... attached via
  `testInfo.attach()`").
- **IMPORTS**: as shown. `buildPath` is the pure function extracted in
  Task 8b for unit testing (see Testing Strategy).
- **GOTCHA #1**: `reducedMotion: 'reduce'` is set at the PROJECT level
  (Task 3's `capture:<slug>` project `use` block), not per-test — do not
  duplicate it here.
- **GOTCHA #2**: `page.screenshot()` returns a `Buffer`, not a file path —
  do NOT also write to `screens/<persona>/<route>@<width>.png` via `fs`
  unless a human explicitly wants on-disk files in addition to the HTML
  report; G-5's stated path convention describes what the report's attached
  file is NAMED, not a requirement to duplicate it on disk. Passing a
  `path:` option to `page.screenshot()` in addition to attaching is fine and
  matches G-5 literally if you want both — just gitignore the directory
  either way (Task 2).
- **VALIDATE**: See Testing Strategy and Validation Commands below.

### Task 8b: `e2e/screens/build-path.ts`
- **ACTION**: Extract the path-template substitution + missing-param
  detection from Task 8 into a small pure, unit-testable function.
- **IMPLEMENT**:
  ```ts
  import type { ResolvedManifest } from './resolve-manifest'

  export interface RouteParam {
    name: string
    source: keyof ResolvedManifest | 'literal'
    literal?: string
  }

  export function buildPath(
    template: string,
    params: RouteParam[],
    resolved: ResolvedManifest,
  ): { path: string; missing: string[] } {
    const missing: string[] = []
    let path = template
    for (const p of params) {
      const value = p.source === 'literal' ? p.literal : resolved[p.source]
      if (value === undefined || value === null) {
        missing.push(p.name)
        continue
      }
      path = path.replace(`:${p.name}`, String(value))
    }
    return { path, missing }
  }
  ```
- **MIRROR**: N/A — new pure logic, no existing precedent; kept deliberately
  tiny and dependency-free so it can be unit tested without Playwright.
- **IMPORTS**: type-only import of `ResolvedManifest` from Task 5.
- **VALIDATE**: See Testing Strategy's unit test table.

### Task 9: `scripts/run-screens.ts`
- **ACTION**: The `npm run screens` entrypoint — guard, seed-if-missing,
  spawn Playwright.
- **IMPLEMENT**:
  ```ts
  import { config } from 'dotenv'
  config({ path: '.env.local' })
  config()

  import { assertLocalDatabase } from './persona/guard'
  assertLocalDatabase(process.env.DATABASE_URL ?? '', 'PERSONA_ALLOW_REMOTE_DB')

  import { execFileSync } from 'node:child_process'
  import { readManifest } from './persona/manifest'

  function arg(flag: string): string | undefined {
    const i = process.argv.indexOf(flag)
    return i === -1 ? undefined : process.argv[i + 1]
  }

  async function main(): Promise<void> {
    const personaArg = arg('--persona')
    const userArg = arg('--user')
    if (!personaArg && !userArg) {
      throw new Error('usage: screens --persona <slug|all> | --user <email>')
    }

    const env = { ...process.env }
    if (userArg) {
      env.SCREENS_TARGET_USER = userArg
    } else {
      const { PERSONA_REGISTRY } = await import('./persona/registry')
      const slugs = personaArg === 'all' ? Object.keys(PERSONA_REGISTRY) : [personaArg!]
      for (const slug of slugs) {
        if (!PERSONA_REGISTRY[slug]) throw new Error(`unknown persona "${slug}"`)
        if (await readManifest(slug)) continue
        console.log(`[screens] seeding missing persona "${slug}"...`)
        execFileSync('npx', ['tsx', 'scripts/seed-persona.ts', '--persona', slug], { stdio: 'inherit' })
      }
    }

    const projectArgs = userArg
      ? ['--project=setup:user', '--project=capture:user']
      : personaArg === 'all'
        ? []
        : [`--project=setup:${personaArg}`, `--project=capture:${personaArg}`]

    execFileSync(
      'npx',
      ['playwright', 'test', '--config=playwright.screens.config.ts', ...projectArgs],
      { stdio: 'inherit', env },
    )
    console.log('[screens] done — run `npx playwright show-report` to view the gallery.')
  }

  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
  ```
- **MIRROR**: DOTENV_GUARD_DYNAMIC_IMPORT_ORDER pattern exactly.
- **IMPORTS**: as shown.
- **GOTCHA**: `execFileSync` with `stdio: 'inherit'` throws on a non-zero
  exit code — that's the desired behavior (a failed capture run should fail
  the command, not silently succeed). Do not wrap in a try/catch that
  swallows this.
- **VALIDATE**: `npx tsc --noEmit`; see Manual Validation below for the full
  live run.

### Task 10: `package.json` script
- **ACTION**: Add `"screens": "tsx scripts/run-screens.ts"` next to the
  existing `"persona": "tsx scripts/seed-persona.ts"` line.
- **VALIDATE**: `npm run screens -- --persona day-one` at least reaches the
  guard/parse stage without a `npm ERR!` about the script itself (full
  live-DB validation is the Manual Validation section).

---

## Testing Strategy

This phase is mostly Playwright config/glue code. Per the project's own
established convention (Phase 1's report: "actions.ts and defs/*.ts have no
unit tests — they're either thin wrappers ... or integration-shaped writes
that need a live database"), the same applies here: `route-manifest.ts` is
static data (no logic to unit test), `capture.spec.ts`/`setup.spec.ts` ARE
the tests (Playwright specs, not unit-tested separately), and
`resolve-manifest.ts`'s DB-touching branch needs a live database. Task 8b's
`buildPath` is deliberately extracted as pure logic specifically so it has
real unit test coverage.

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `buildPath` — all params resolved | template `/programs/:programId`, params `[{name:'programId', source:'programId'}]`, resolved `{userId:'u', email:'e', programId:'abc'}` | `{ path: '/programs/abc', missing: [] }` | No |
| `buildPath` — missing param | template `/programs/:programId`, same params, resolved `{userId:'u', email:'e'}` | `{ path: '/programs/:programId', missing: ['programId'] }` | Yes |
| `buildPath` — literal param | template `/programs/:programId/editor/:day`, params include `{name:'day', source:'literal', literal:'1'}` plus a resolved `programId` | `path` has both segments substituted, `missing: []` | No |
| `buildPath` — no params (static route) | template `/settings`, params `[]` | `{ path: '/settings', missing: [] }` | No |
| `resolveManifest('unknown-slug')` (no live DB needed — fails before any DB read) | slug with no `e2e/.state/unknown-slug.json` | throws with an actionable message naming the missing manifest | Yes |

### Edge Cases Checklist

- [ ] Persona with zero workouts/programs (`day-one`) — every param route is
      skipped, not failed; the run still succeeds and produces a report with
      the static/no-param routes captured.
- [ ] `--persona all` with a mix of personas that do and don't have active
      shares — share-token routes skip per-persona independently.
- [ ] `--user <email>` for an email with no matching emulator user — the
      lookup step throws a clear error before Playwright even starts (fail in
      `run-screens.ts`'s orchestration, not deep inside a Playwright worker).
- [ ] Re-running `npm run screens -- --persona day-one` twice in a row — no
      re-seed (manifest already exists), no re-auth needed within the same
      Playwright run (that's inherent to `dependencies: [...]`, but confirm
      it across two SEPARATE `npm run screens` invocations too — each run
      re-authenticates once, which is correct, not a bug).
- [ ] A route whose ready-signal text has drifted from `messages/en.json`
      (i.e., a Task 4 mistake) — the test times out at 15s with a clear
      Playwright error naming the missing locator, not a silent false pass.

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
npm run lint
```
EXPECT: Zero type errors, zero lint errors.

### Unit Tests
```bash
npx vitest run e2e/screens
```
EXPECT: `build-path.test.ts`'s cases (Testing Strategy table above) pass.
Confirm `vitest.config.ts` already includes `e2e/**` in its test glob before
relying on this command; if it doesn't, note the adjustment needed rather
than silently widening `vitest.config.ts`'s scope as a drive-by change.

### Full Test Suite
```bash
npm test
```
EXPECT: No regressions (6060+ tests still pass, per Phase 1's baseline).

### Build Check
```bash
npm run build
```
EXPECT: Succeeds — this phase adds no app-code changes (`e2e/auth.ts`'s
signature narrowing is the only edit inside anything the app build touches,
and it's type-compatible).

### Database + Browser Validation (requires local Postgres + `workos emulate`)
```bash
# One-time setup, per docs/specs/personas-and-screens.md:
npm run db:seed-consent-docs
npm run db:seed-templates
npx workos@latest emulate --port 4100 --interactive &

npm run persona -- --persona day-one
npm run persona -- --persona week-one

npm run screens -- --persona day-one
npm run screens -- --persona week-one
npx playwright show-report
```
EXPECT:
- Both `screens` invocations complete with zero manual logins.
- The HTML report shows every non-skipped route for each persona, phone
  (and desktop where specified) width, full page.
- `day-one`'s param routes (workout/program/exercise/share detail pages) are
  SKIPPED (visible in the report as skipped, not failed) — day-one has none
  of that data.
- `week-one`'s `/workout/[id]`, `/programs/[id]*`, and
  `/exercises/[source]/[id]` ARE captured (week-one has a workout and an
  adopted program from Phase 1).
- Re-running either command a second time does not re-create `playwright/.auth/*.json`
  from scratch redundantly in a way that breaks anything (it's fine if it
  re-authenticates — G-1 says "never see a login screen" WITHIN one run, not
  across separate invocations).

```bash
npm run screens -- --user persona_week-one@example.com
```
EXPECT: Same result as `--persona week-one` for the routes it can resolve
(it re-derives the same ids live from the DB rather than reading the
manifest file) — a useful cross-check that Task 5's live-derivation logic
agrees with Task 1's manifest-based path.

### Manual Validation
- [ ] Confirm every "needs verification" ready-signal string in the Route
      Manifest table against `messages/en.json` before merging Task 4.
- [ ] Confirm `/settings/account/mfa` actually renders (not a 404) in the
      local dev environment before including it in the default manifest —
      if it 404s locally, mark it `enabled: false` in `RouteSpec` (add that
      field if needed) rather than deleting the row, so the gap is visible.
- [ ] Visually spot-check `/` for both personas — this is the row the whole
      PRD's "State coverage" success metric depends on.
- [ ] Confirm `npm run test:e2e` (the ORIGINAL suite) still passes unchanged
      and unaffected by anything in this phase.

---

## Acceptance Criteria
- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] Tests written and passing (`build-path.test.ts` at minimum)
- [ ] No type errors
- [ ] No lint errors
- [ ] `npm run screens -- --persona <slug>` produces a browsable report with
      zero manual logins for both existing Phase 1 personas (day-one,
      week-one)
- [ ] `npm run screens -- --user <email>` works for at least one existing
      persona's email as a cross-check
- [ ] `npm run test:e2e` is provably unaffected (same pass count, same
      config file, no shared state)

## Completion Checklist
- [ ] Code follows discovered patterns (GUARD_SHAPE, READY_SIGNAL,
      EMULATOR_SIGN_IN, MANIFEST_READ, DOTENV_GUARD_DYNAMIC_IMPORT_ORDER,
      EMULATOR_API_CALL)
- [ ] Error handling matches codebase style (fail closed, name the host/id
      in the error, never silently no-op)
- [ ] No hardcoded values beyond the documented literal `day` param and
      viewport pixel sizes (both already constants elsewhere — DO reuse
      `PHONE`/`DESKTOP` shape from `e2e/visual.spec.ts` if convenient, or
      keep the new `VIEWPORT_SIZES` map as the one canonical copy for this
      rig)
- [ ] No unnecessary scope additions (no diff-baseline promotion, no CI
      wiring, no new personas)
- [ ] Self-contained — no questions needed during implementation beyond the
      explicitly flagged "needs verification" literal strings

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Some "needs verification" ready-signal strings turn out wrong | M | Low (per-route test timeout, not silent) | 15s timeout + Playwright's own clear locator-not-found error; fix the string, re-run |
| WorkOS emulator doesn't support `?email=` filtering for `--user` mode | L | Medium (blocks `--user` mode only) | Documented fallback: unfiltered list + client-side filter |
| `/settings/account/mfa` 404s locally (env-gated) | M | Low | `enabled: false` escape hatch keeps it visible but non-blocking |
| Dynamic project generation reading `e2e/.state/` at config-load time races a concurrent `npm run persona` write | L | Low (dev-tool, single operator) | Not mitigated — acceptable for v1; document as a known limitation if it ever bites |
| `page.screenshot()` full-page capture is flaky on a route with client-side animation despite `reducedMotion: 'reduce'` | L | Low | `reducedMotion` covers CSS/View Transitions; if a specific route still flakes, add a short explicit wait in that route's manifest entry — not a global fix |

## Notes

- The spec's C-8 example manifest shows `"exerciseRef": "wger:345"`. Verified
  against `src/app/exercises/exercise-ref.ts`: BOTH `wger` and `custom`
  sources use a positive-integer id in this URL scheme (never a UUID) — so
  `custom:12` is the correct shape for a custom exercise's ref, not
  `custom:<uuid>`. No code change needed; this is purely a documentation
  clarification for whoever writes `--user` mode's `exerciseRef` derivation.
- G-6 says the screens rig "maps to a dedicated Playwright project so `npm
  run test:e2e` stays unchanged." This plan interprets that as a dedicated
  Playwright *config file* (cleanest way to guarantee zero interaction with
  the existing config) containing multiple dynamically-generated *projects*
  (one setup/capture pair per persona) — both readings of "project" in the
  spec are satisfied.
