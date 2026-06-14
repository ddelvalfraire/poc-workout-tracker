# Plan: PWA + Deploy (Phase 6)

## Summary
Make the workout tracker installable on a phone and ship it live on Vercel. Add a Web App Manifest (`app/manifest.ts`), dynamically-generated PNG icons (via `next/og` `ImageResponse` route handlers — no binary assets, no new dependency), a minimal hand-rolled service worker (`public/sw.js`) registered by a small client component, and the `next.config.ts`/layout metadata wiring that lets Chrome and Safari offer "Add to Home Screen." Then document and verify a Vercel deploy with the existing Clerk + Supabase + wger env vars. The app stays **online-only** — the service worker exists to satisfy installability, not to provide offline sync (explicitly out of scope per the PRD).

## User Story
As a lifter who trains on a schedule,
I want to install the tracker on my phone's home screen and open it at a live URL,
So that it feels like a native app I can launch instantly at the gym.

## Problem → Solution
The core loop, history, edit, and delete all work, but the app only runs on `localhost`, has no manifest/service worker, and cannot be installed. → Add a manifest + generated icons + a minimal service worker with registration, wire the metadata, and deploy to Vercel so a phone can install the app from a real URL.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/workout-tracker-pwa.prd.md`
- **PRD Phase**: Phase 6 — PWA + deploy
- **Depends on**: Phase 3 (Core logging loop) — complete. Phases 4 & 5 also complete.
- **Estimated Files**: 11 (8 create, 3 update)

---

## UX Design

### Before
```
Phone browser (Chrome / Safari) at http://localhost:3000
┌──────────────────────────┐
│ ▢ localhost:3000     ⋮    │   ← address bar, no install affordance
│ ──────────────────────── │
│ Workout Tracker     (●)  │
│  [ + Start Workout ]     │
│  History …               │
└──────────────────────────┘
  • No "Add to Home Screen" / install prompt
  • Only reachable on the dev machine's network
```

### After
```
Phone browser at https://<app>.vercel.app          Home screen after install
┌──────────────────────────┐                       ┌───────────────────────┐
│ ▢ ….vercel.app   ⊕  ⋮    │  tap install / A2HS   │  📱  📷  🎵  ⚙️        │
│ ──────────────────────── │ ───────────────────►  │                       │
│ Workout Tracker     (●)  │                       │  🏋  Workout          │
│  [ + Start Workout ]     │                       │      Tracker          │
│  History …               │                       │   (standalone, no     │
└──────────────────────────┘                       │    browser chrome)    │
  • Install prompt offered (manifest + SW + icons)  └───────────────────────┘
  • Live, shareable HTTPS URL
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Browser address bar | No install affordance | Install icon / "Add to Home Screen" available | Requires valid manifest + registered SW with a `fetch` handler + 192/512 icons over HTTPS |
| Launched app | Runs in a browser tab | Launches standalone (`display: standalone`), themed status bar | Driven by `manifest.display` + `theme_color` + `apple-mobile-web-app-*` meta |
| Home screen icon | None | Branded maskable icon | Generated PNGs at `/icons/*.png`; iOS uses `apple-touch-icon` |
| Hosting | `localhost` only | Live `*.vercel.app` URL | No UI change; pure infra |

This is mostly an **infra + browser-metadata change**. No change to any existing page's rendered markup beyond the `<head>` and one mounted (render-nothing) client component.

---

## ⚠️ Key Decisions (resolve ambiguity up front)

1. **Hand-rolled SW, not `next-pwa`.** The PRD explicitly allows "`next-pwa` or a hand-rolled SW," lists PWA as a *Should* (not a blocker), and scopes the app **online-only**. `next-pwa` / Serwist add build plumbing and are version-sensitive against Next 16. A ~30-line `public/sw.js` following the [official Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps) is dependency-free, reviewable, and sufficient for installability. **No new dependency is added in this phase.**

2. **Icons are generated at request time via `next/og` `ImageResponse` route handlers — no committed binaries.** Each icon is a route whose final path segment *ends in `.png`* (e.g. `app/icons/icon-192.png/route.tsx` → served at `/icons/icon-192.png`). This matters for two reasons:
   - **It keeps the icons public.** The Clerk middleware matcher (`src/proxy.ts`) excludes any path matching `...\.(?:...|png|...)`, so a `.png`-suffixed route is **not** auth-protected. The browser fetches the manifest and its icons *without* credentials, so they must be public or the install breaks. (Static files under `public/` would also be public, but would require committing binary PNGs.)
   - **`next/og` ships with Next** — zero new dependency, and the rendering logic is plain reviewable TSX. A shared `src/lib/pwa-icon.tsx` builds the icon element so the routes stay DRY.

3. **Manifest via `app/manifest.ts` (the App Router convention).** Next serves it at `/manifest.webmanifest` and auto-injects `<link rel="manifest">`. That path is already excluded by the middleware matcher (`webmanifest`), so it is public — no `src/proxy.ts` change needed. **Do not** also hand-write a `<link rel="manifest">` in layout; Next adds it.

4. **`theme_color` / viewport via the `viewport` export, icons.apple via `metadata`.** Next 16 wants `themeColor` in `export const viewport` (not `metadata`), and `apple-touch-icon` is declared through `metadata.icons.apple` pointing at the generated `/icons/apple-touch-icon.png` route. iOS Safari does not read the manifest's icon array, so the apple icon must be declared in the head.

5. **Service worker is online-only and minimal.** Chrome requires a registered SW *with a `fetch` handler* for installability. The handler does **network-first** for navigations with a tiny same-origin cache fallback, and otherwise passes through. No precaching of app routes, no offline page, no background sync — that is explicitly NOT in scope (PRD: "Offline-first sync / conflict resolution — online-only for the POC").

6. **Register the SW from a client component, production-only.** `src/components/pwa/service-worker-register.tsx` (`'use client'`) calls `navigator.serviceWorker.register('/sw.js')` in a `useEffect` and renders `null`. Gated on `process.env.NODE_ENV === 'production'` so it never interferes with dev/HMR. Mounted once in `layout.tsx`.

7. **`/sw.js` gets `Cache-Control: no-cache` via `next.config.ts headers()`.** Without this the browser can pin an old service worker; `no-cache` forces revalidation so SW updates ship. Also set `Service-Worker-Allowed: /` for root scope (it already serves from root, but this is explicit and harmless).

8. **Deploy keeps Clerk *test* keys for the POC.** A `*.vercel.app` URL works with `pk_test`/`sk_test` for dogfooding (PRD success metric is install + round-trip, not a production Clerk domain). Runtime DB uses the **transaction pooler** `DATABASE_URL` (port 6543, `prepare:false` already set in `src/db/index.ts`); `DATABASE_URL_DIRECT` (5432) is only for `drizzle-kit` migrations, run locally/CI, not at request time. Schema is already pushed to Supabase (Phase 1), so no migration runs during deploy.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 (critical) | `src/proxy.ts` | 1-17 | The middleware matcher decides which paths are public. Confirms `.png`, `.js`, `.webmanifest` are already excluded — the manifest, icons, and `sw.js` are public *without* editing this file. Do **not** change it. |
| P0 (critical) | `src/app/layout.tsx` | 1-36 | Where `metadata`/`viewport` live and where the SW-register component mounts. `<ClerkProvider>` wraps `<html>`; mount the register inside `<body>`. |
| P1 (important) | `src/lib/env.ts` | 1-8 | `requireEnv()` fail-fast pattern — reuse it if the manifest needs a runtime value (it does not here, but mirror the style if you add one). |
| P1 (important) | `.env.example` | all | Canonical list + comments for every env var that must be set in Vercel. Source of truth for the deploy checklist. No change needed. |
| P1 (important) | `src/db/index.ts` | all | Confirms runtime uses `DATABASE_URL` with `prepare:false` (transaction pooler). Explains why only `DATABASE_URL` (not `_DIRECT`) is needed at runtime on Vercel. |
| P2 (reference) | `e2e/workout.spec.ts` | 1-45 | Playwright + `@clerk/testing` + `postgres` house style for the new `e2e/pwa.spec.ts`. Note `process.loadEnvFile('.env.local')` happens in `playwright.config.ts`. |
| P2 (reference) | `src/lib/format.test.ts` | all | Vitest unit-test house style (plain functions, AAA) to mirror for `src/app/manifest.test.ts`. |
| P2 (reference) | `playwright.config.ts` | all | `webServer` runs `npm run dev`; baseURL `http://localhost:3000`; single chromium project after `setup`. |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Official PWA guide | https://nextjs.org/docs/app/guides/progressive-web-apps | Canonical manual recipe: `app/manifest.ts` + `public/sw.js` + a client component that calls `navigator.serviceWorker.register`. No library required. |
| Web App Manifest file convention | https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest | `app/manifest.ts` returns `MetadataRoute.Manifest`; served at `/manifest.webmanifest`; link auto-injected. |
| `ImageResponse` (`next/og`) | https://nextjs.org/docs/app/api-reference/functions/image-response | Render a React element to a PNG `Response` at request time. Ships with Next — no install. Use for the icon routes. |
| `viewport` / `themeColor` export | https://nextjs.org/docs/app/api-reference/functions/generate-viewport | `themeColor` must be in `export const viewport`, not `metadata`, in current Next. |
| Vercel + Next deploy | https://nextjs.org/docs/app/getting-started/deploying | Zero-config on Vercel; set env vars in the dashboard for Production + Preview. |

> KEY_INSIGHT: A route handler folder may be named with a trailing extension (`icons/icon-192.png/route.tsx`), producing the literal path `/icons/icon-192.png`.
> APPLIES_TO: All three icon routes — this is what makes them match the middleware's static-file exclusion and stay public.
> GOTCHA: If you instead name them without `.png` (e.g. `/icons/icon-192`), the Clerk middleware will protect them, the uncredentialed manifest icon fetch will 307 → `/sign-in`, and the install prompt will silently never appear.

---

## Patterns to Mirror

### NAMING_CONVENTION
```ts
// SOURCE: src/lib/auth.ts:4-9, src/lib/format.ts (pure helpers), src/components/ui/button.tsx
// - kebab-case filenames; camelCase functions; PascalCase components/types.
// - Pure logic lives in src/lib/*; client components carry 'use client'.
export async function requireUserId(): Promise<string> { /* ... */ }
```

### ENV_ACCESS
```ts
// SOURCE: src/lib/env.ts:1-8 — fail fast on missing config.
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}
```

### MIDDLEWARE_PUBLIC_PATHS
```ts
// SOURCE: src/proxy.ts:11-17 — static extensions (incl. png, js, webmanifest) are
// excluded from the matcher, so they bypass clerkMiddleware and are public.
export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
```

### LAYOUT_METADATA
```tsx
// SOURCE: src/app/layout.tsx:1-36 — metadata object + ClerkProvider > html > body.
export const metadata: Metadata = {
  title: "Workout Tracker",
  description: "Log your workouts and review your training history.",
};
// Body currently: <body className="min-h-full flex flex-col">{children}</body>
```

### UNIT_TEST_STRUCTURE
```ts
// SOURCE: src/lib/format.test.ts — Vitest, AAA, plain-function assertions.
import { describe, it, expect } from 'vitest'
describe('formatWorkoutDate', () => {
  it('formats an ISO date', () => {
    // Arrange / Act / Assert
  })
})
```

### E2E_TEST_STRUCTURE
```ts
// SOURCE: e2e/workout.spec.ts:1-30 — Playwright; env loaded in playwright.config.ts.
import { test, expect } from '@playwright/test'
// baseURL is http://localhost:3000; use request fixtures for public endpoints.
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/app/manifest.ts` | CREATE | Web App Manifest (name, icons, display, theme/background color, start_url). Served at `/manifest.webmanifest`. |
| `src/lib/pwa-icon.tsx` | CREATE | Shared `ImageResponse` element builder (glyph + brand bg + optional maskable padding) used by all icon routes — DRY. |
| `src/app/icons/icon-192.png/route.tsx` | CREATE | `GET` → 192×192 PNG (`purpose: any`). |
| `src/app/icons/icon-512.png/route.tsx` | CREATE | `GET` → 512×512 PNG with safe padding (`purpose: any maskable`). |
| `src/app/icons/apple-touch-icon.png/route.tsx` | CREATE | `GET` → 180×180 opaque PNG for iOS home screen. |
| `public/sw.js` | CREATE | Minimal service worker: `skipWaiting`/`clients.claim` + network-first `fetch` handler (required for installability). |
| `src/components/pwa/service-worker-register.tsx` | CREATE | `'use client'` component; registers `/sw.js` in `useEffect`, production-only; renders `null`. |
| `src/app/layout.tsx` | UPDATE | Add `viewport` export (`themeColor`), `appleWebApp` + `icons.apple` to `metadata`, mount `<ServiceWorkerRegister />`. |
| `next.config.ts` | UPDATE | Add `headers()` → `/sw.js` gets `Cache-Control: no-cache` + `Service-Worker-Allowed: /`. |
| `src/app/manifest.test.ts` | CREATE | Unit test asserting manifest shape (name/short_name, ≥1 192 + ≥1 512 icon, `display: standalone`, `start_url`). |
| `e2e/pwa.spec.ts` | CREATE | E2E: `/manifest.webmanifest` returns valid JSON with required fields; `/sw.js` and each `/icons/*.png` return 200 with the right content-type; authed `/` includes `<link rel="manifest">`. |

## NOT Building

- **Offline support / precaching / offline fallback page** — online-only POC; the SW exists only for installability.
- **Background sync, push notifications, periodic sync** — out of scope.
- **`next-pwa` / Serwist / Workbox** — no PWA dependency added.
- **Committed binary icon assets / a design icon set** — icons are generated at request time.
- **Custom production Clerk domain / custom apex domain** — `*.vercel.app` + test keys suffice for the POC.
- **CI/CD pipeline, GitHub Actions, preview-deploy gating** — manual `vercel`/dashboard deploy is enough.
- **Changes to `src/proxy.ts`** — the existing matcher already makes the needed paths public.
- **Splash screens / per-device iOS launch images** — not required for "Add to Home Screen."

---

## Step-by-Step Tasks

### Task 1: Shared icon element (`src/lib/pwa-icon.tsx`)
- **ACTION**: Create a helper that returns an `ImageResponse` for a given size, with an optional maskable safe-area padding flag.
- **IMPLEMENT**:
  - `export function renderPwaIcon(size: number, opts?: { maskable?: boolean }): ImageResponse`
  - Render a simple branded glyph (a dumbbell emoji 🏋️ or a bold "W") centered on the brand background color (use a hardcoded hex matching the app's primary, e.g. a dark slate `#0a0a0a` background with a light glyph — keep it a named `const` to avoid a magic value).
  - When `maskable`, inset the glyph ~20% so it survives Android's circle/squircle mask.
  - Pass `{ width: size, height: size }` to `ImageResponse`. `ImageResponse` sets `content-type: image/png` automatically.
- **MIRROR**: NAMING_CONVENTION (camelCase exported fn, named constants — no magic numbers).
- **IMPORTS**: `import { ImageResponse } from 'next/og'`
- **GOTCHA**: This file uses JSX, so it must be `.tsx`. `ImageResponse` supports only a subset of CSS (flexbox; `display: flex` required on any node with multiple children).
- **VALIDATE**: `npm run build` compiles it; routes in Tasks 2–4 import it without type errors.

### Task 2: 192px any-purpose icon route
- **ACTION**: Create `src/app/icons/icon-192.png/route.tsx`.
- **IMPLEMENT**: `export function GET() { return renderPwaIcon(192) }`
- **MIRROR**: Task 1 helper.
- **IMPORTS**: `import { renderPwaIcon } from '@/lib/pwa-icon'`
- **GOTCHA**: The folder name **must** be literally `icon-192.png` (trailing extension) so the served path is `/icons/icon-192.png` and the middleware treats it as a public static file.
- **VALIDATE**: `curl -sI localhost:3000/icons/icon-192.png` → `200` + `content-type: image/png` (no `307` to `/sign-in`).

### Task 3: 512px maskable icon route
- **ACTION**: Create `src/app/icons/icon-512.png/route.tsx`.
- **IMPLEMENT**: `export function GET() { return renderPwaIcon(512, { maskable: true }) }`
- **MIRROR**: Task 2.
- **IMPORTS**: same as Task 2.
- **GOTCHA**: This single 512 serves as both `any` and `maskable` in the manifest (POC simplification) — that's why it carries the maskable padding.
- **VALIDATE**: `curl -sI localhost:3000/icons/icon-512.png` → `200` image/png.

### Task 4: Apple touch icon route
- **ACTION**: Create `src/app/icons/apple-touch-icon.png/route.tsx`.
- **IMPLEMENT**: `export function GET() { return renderPwaIcon(180) }` — 180×180, **opaque** background (iOS adds its own rounding; transparency renders black).
- **MIRROR**: Task 2.
- **IMPORTS**: same.
- **GOTCHA**: iOS ignores the manifest icon array — this icon is wired through `metadata.icons.apple` in Task 7, not the manifest.
- **VALIDATE**: `curl -sI localhost:3000/icons/apple-touch-icon.png` → `200` image/png.

### Task 5: Web App Manifest (`src/app/manifest.ts`)
- **ACTION**: Create the manifest using the App Router convention.
- **IMPLEMENT**:
  ```ts
  import type { MetadataRoute } from 'next'
  export default function manifest(): MetadataRoute.Manifest {
    return {
      name: 'Workout Tracker',
      short_name: 'Workouts',
      description: 'Log your workouts and review your training history.',
      start_url: '/',
      display: 'standalone',
      background_color: '#0a0a0a',
      theme_color: '#0a0a0a',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }
  }
  ```
- **MIRROR**: LAYOUT_METADATA (same colors used for `theme_color` in Task 7).
- **IMPORTS**: `import type { MetadataRoute } from 'next'`
- **GOTCHA**: Served at `/manifest.webmanifest` (not `/manifest.json`); Next injects the `<link>` automatically — do not add one manually. Keep colors consistent with the `viewport.themeColor` from Task 7.
- **VALIDATE**: `curl -s localhost:3000/manifest.webmanifest | jq '.name, .display, (.icons|length)'` → `"Workout Tracker"`, `"standalone"`, `2`.

### Task 6: Service worker (`public/sw.js`)
- **ACTION**: Create a minimal, online-only service worker with a `fetch` handler.
- **IMPLEMENT**:
  ```js
  const CACHE = 'workout-tracker-v1'
  self.addEventListener('install', () => self.skipWaiting())
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
  self.addEventListener('fetch', (event) => {
    const { request } = event
    if (request.method !== 'GET') return
    // Network-first for navigations; fall back to a cached shell if offline.
    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request)
          .then((res) => {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(request, copy))
            return res
          })
          .catch(() => caches.match(request).then((r) => r || caches.match('/'))),
      )
    }
  })
  ```
- **MIRROR**: Official Next.js PWA guide SW shape.
- **IMPORTS**: none (browser globals).
- **GOTCHA**: Must live in `public/` so it serves at root `/sw.js` (root scope). The `fetch` listener is what makes Chrome consider the app installable — an empty SW is not enough. Do not cache POST/Server-Action requests (guarded by `request.method !== 'GET'`).
- **VALIDATE**: `curl -sI localhost:3000/sw.js` → `200` + a JavaScript `content-type`; no auth redirect.

### Task 7: Layout wiring (`src/app/layout.tsx`)
- **ACTION**: Add the `viewport` export, extend `metadata`, and mount the SW-register component.
- **IMPLEMENT**:
  - Add `import type { Viewport } from 'next'` and:
    ```ts
    export const viewport: Viewport = { themeColor: '#0a0a0a' }
    ```
  - Extend `metadata` with:
    ```ts
    appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Workouts' },
    icons: { apple: '/icons/apple-touch-icon.png' },
    ```
  - Import and render `<ServiceWorkerRegister />` inside `<body>` (after `{children}` is fine).
- **MIRROR**: LAYOUT_METADATA — keep the existing `title`/`description`; only extend.
- **IMPORTS**: `import type { Viewport } from 'next'`; `import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register'`
- **GOTCHA**: `themeColor` goes in `viewport`, NOT `metadata` (Next warns/strips it otherwise). Do not add a manual `<link rel="manifest">` — Next injects it from `manifest.ts`.
- **VALIDATE**: `npm run build` clean; authed `/` head contains `<link rel="manifest">` and `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`.

### Task 8: Service worker registration component
- **ACTION**: Create `src/components/pwa/service-worker-register.tsx`.
- **IMPLEMENT**:
  ```tsx
  'use client'
  import { useEffect } from 'react'
  export function ServiceWorkerRegister() {
    useEffect(() => {
      if (process.env.NODE_ENV !== 'production') return
      if (!('serviceWorker' in navigator)) return
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registration failures are non-fatal; the app works without the SW.
      })
    }, [])
    return null
  }
  ```
- **MIRROR**: `src/hooks/use-debounce.ts` for the `useEffect` style; NAMING_CONVENTION (PascalCase component).
- **IMPORTS**: `import { useEffect } from 'react'`
- **GOTCHA**: Production-only so the SW never caches dev HMR assets. The empty catch is acceptable here only because the app is fully functional without the SW (installability is the sole benefit) — do not copy this swallow-pattern into data paths.
- **VALIDATE**: `npm run build`; in a production build (`npm run start`) the SW registers (DevTools → Application → Service Workers shows `sw.js` activated); in `npm run dev` it does not register.

### Task 9: `next.config.ts` headers for `/sw.js`
- **ACTION**: Add an async `headers()` to the Next config.
- **IMPLEMENT**:
  ```ts
  const nextConfig: NextConfig = {
    async headers() {
      return [
        {
          source: '/sw.js',
          headers: [
            { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
            { key: 'Service-Worker-Allowed', value: '/' },
          ],
        },
      ]
    },
  }
  ```
- **MIRROR**: existing `next.config.ts` shape (typed `NextConfig`).
- **IMPORTS**: existing `import type { NextConfig } from 'next'`.
- **GOTCHA**: Without `no-cache`, browsers can serve a stale SW and updates won't propagate. Keep the rest of the config untouched (no drive-by changes).
- **VALIDATE**: `curl -sI localhost:3000/sw.js | grep -i cache-control` → shows `no-cache`.

### Task 10: Manifest unit test (`src/app/manifest.test.ts`)
- **ACTION**: Add a Vitest unit test importing the `manifest()` function.
- **IMPLEMENT**: Assert `name === 'Workout Tracker'`, `short_name` set, `display === 'standalone'`, `start_url === '/'`, icons include a `192x192` and a `512x512` entry, and at least one icon's `purpose` contains `maskable`.
- **MIRROR**: UNIT_TEST_STRUCTURE (`src/lib/format.test.ts`), AAA.
- **IMPORTS**: `import { describe, it, expect } from 'vitest'`; `import manifest from './manifest'`
- **GOTCHA**: `manifest.ts` has no side effects / no env reads, so it imports cleanly in the Node test environment.
- **VALIDATE**: `npm test` — new test passes; existing 68 tests still pass.

### Task 11: PWA e2e (`e2e/pwa.spec.ts`)
- **ACTION**: Add a Playwright spec covering the public PWA endpoints and the authed manifest link.
- **IMPLEMENT**:
  - Using the `request` fixture (no auth needed — these paths are public):
    - `GET /manifest.webmanifest` → 200; body parses as JSON; `name`, `display === 'standalone'`, `icons.length >= 2`.
    - `GET /sw.js` → 200; content-type is JavaScript.
    - `GET /icons/icon-192.png`, `/icons/icon-512.png`, `/icons/apple-touch-icon.png` → 200; `content-type: image/png`.
  - One authed page check (mirror `e2e/workout.spec.ts` Clerk sign-in) asserting `page.locator('link[rel="manifest"]')` is present in the DOM. (Optional if it adds flakiness — the public checks carry most of the signal.)
- **MIRROR**: E2E_TEST_STRUCTURE (`e2e/workout.spec.ts`); env is loaded by `playwright.config.ts`.
- **IMPORTS**: `import { test, expect } from '@playwright/test'`
- **GOTCHA**: The dev server (`npm run dev`) registers **no** SW (production-gated), so do not assert SW *activation* in e2e — only that `/sw.js` is served. Assert installability manually via Lighthouse (see Manual Validation).
- **VALIDATE**: `npm run test:e2e` — new spec green alongside the existing 3 e2e tests.

### Task 12: Deploy to Vercel + env wiring (manual / documented)
- **ACTION**: Deploy the app and set runtime env vars.
- **IMPLEMENT** (document in the report; commands are run by the user since the Vercel CLI is not installed — suggest `! npm i -g vercel` then `! vercel` / `! vercel --prod`, or import the repo in the Vercel dashboard):
  - In Vercel project settings → Environment Variables (Production **and** Preview), set every var from `.env.example`:
    - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
    - `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL`
    - `DATABASE_URL` (transaction pooler, port **6543**)
    - `WGER_API_BASE_URL` (optional; defaults to public wger)
  - **Do not** set `DATABASE_URL_DIRECT` as a runtime var — it's only for local `drizzle-kit`. Schema is already applied to Supabase (Phase 1), so no deploy-time migration.
  - Framework preset auto-detects Next.js; build `next build`, output handled by Vercel. No `vercel.json` needed.
- **MIRROR**: `.env.example` comments are the source of truth.
- **IMPORTS**: n/a.
- **GOTCHA**: `prepare:false` (already in `src/db/index.ts`) is required for the transaction pooler on serverless — do not switch to the direct URL at runtime or you'll exhaust connections. Add the deployed origin to Clerk's allowed origins if Clerk rejects the domain.
- **VALIDATE**: Live URL loads → redirects unauthenticated to `/sign-in`; sign in; start/save a workout; it appears in history. On a phone, the browser offers install; launched icon opens standalone.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| manifest name/short_name | `manifest()` | `name === 'Workout Tracker'`, `short_name` truthy | No |
| manifest display | `manifest()` | `display === 'standalone'`, `start_url === '/'` | No |
| manifest icons | `manifest().icons` | contains `192x192` and `512x512`; one has `maskable` purpose | No |

### E2E Tests (Playwright)
| Test | Request | Expected |
|---|---|---|
| Manifest served | `GET /manifest.webmanifest` | 200, JSON, required fields present |
| SW served | `GET /sw.js` | 200, JS content-type |
| Icons served | `GET /icons/{icon-192,icon-512,apple-touch-icon}.png` | 200, `image/png` |
| Manifest linked (authed) | load `/` signed in | `<link rel="manifest">` in DOM |

### Edge Cases Checklist
- [x] Unauthenticated fetch of manifest/icons/sw — must be **public** (verified: middleware matcher excludes them).
- [x] Non-GET requests in SW — passed through, never cached (guarded).
- [x] SW registration failure — caught, non-fatal (app works without SW).
- [x] Dev vs prod — SW only registers in production.
- [ ] iOS Safari install (manual — apple-touch-icon + `appleWebApp` meta).
- [ ] Android Chrome install (manual — Lighthouse installability).

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
EXPECT: No errors.

### Unit Tests
```bash
npm test
```
EXPECT: All tests pass (existing 68 + new manifest tests).

### Production Build
```bash
npm run build
```
EXPECT: Build succeeds; `app/manifest.ts` and the three `/icons/*.png` routes appear in the route list; no `themeColor`-in-metadata warning.

### Local PWA smoke (production mode)
```bash
npm run build && npm run start &
sleep 3
curl -sI  localhost:3000/manifest.webmanifest | head -1
curl -s   localhost:3000/manifest.webmanifest | jq '.name, .display, (.icons|length)'
curl -sI  localhost:3000/sw.js               | grep -i 'cache-control'
curl -sI  localhost:3000/icons/icon-192.png  | grep -i 'content-type'
curl -sI  localhost:3000/icons/icon-512.png  | grep -i 'content-type'
curl -sI  localhost:3000/icons/apple-touch-icon.png | grep -i 'content-type'
```
EXPECT: manifest 200 + valid JSON (`"Workout Tracker"`, `"standalone"`, `2`); `/sw.js` has `no-cache`; each icon `content-type: image/png`. (None should redirect to `/sign-in`.)

### E2E
```bash
npm run test:e2e
```
EXPECT: New `pwa.spec.ts` green; existing specs still green.

### Browser / Install Validation (manual)
- [ ] `npm run build && npm run start`, open in Chrome → DevTools → Application → Manifest shows name, icons, `standalone`; Service Workers shows `sw.js` activated.
- [ ] Lighthouse → "Installable" passes (manifest + SW with fetch handler + 192/512 icons over localhost/HTTPS).
- [ ] On deployed `*.vercel.app`: phone offers "Add to Home Screen"; launched app runs standalone with the branded icon.

### Database Validation
n/a — no schema change this phase (already pushed in Phase 1).

---

## Acceptance Criteria
- [ ] All tasks completed.
- [ ] `app/manifest.ts` serves a valid manifest at `/manifest.webmanifest` (public).
- [ ] `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/apple-touch-icon.png` return PNGs (public).
- [ ] `public/sw.js` served with `no-cache`; registered in production by the client component.
- [ ] Layout exposes `themeColor` (viewport) + apple-touch-icon + manifest link.
- [ ] All validation commands pass; no type/lint errors.
- [ ] Lighthouse "Installable" passes; install works on a phone from the live URL.
- [ ] Deployed to Vercel with all env vars set; sign-in + a full log→history round-trip works on the live URL.

## Completion Checklist
- [ ] Code follows discovered patterns (naming, env access, layout metadata, test structure).
- [ ] Error handling matches codebase style (SW registration failure non-fatal).
- [ ] No `console.log` / debug statements.
- [ ] Tests follow existing Vitest + Playwright patterns.
- [ ] No hardcoded secrets; brand colors are named constants kept consistent across manifest + viewport.
- [ ] No change to `src/proxy.ts` (public paths already covered).
- [ ] No new dependency added.
- [ ] No unnecessary scope additions (no offline/precaching/push).
- [ ] Self-contained — no codebase searching needed during implementation.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Icon/manifest/SW path accidentally auth-protected → install silently fails | M | High | Keep `.png`/`.webmanifest`/`.js` suffixes so the existing matcher excludes them; e2e asserts each returns 200 uncredentialed. |
| `themeColor` placed in `metadata` instead of `viewport` | M | Low | Documented in Task 7; build warns; verified in build step. |
| Stale service worker pinned by browser cache | L | Med | `Cache-Control: no-cache` on `/sw.js` (Task 9). |
| iOS shows black/incorrect home icon | L | Low | Opaque 180×180 `apple-touch-icon` declared via `metadata.icons.apple`. |
| Supabase pooler connection exhaustion on Vercel | L | Med | Runtime uses transaction pooler + `prepare:false` (already set); `_DIRECT` not used at runtime. |
| Clerk rejects the Vercel origin | L | Med | Add the deployed domain to Clerk's allowed origins; test keys are fine for `*.vercel.app`. |
| `ImageResponse` CSS limitations cause a render error | L | Low | Keep the icon element simple (single flex container + glyph); validated by the icon curl checks. |

## Notes
- The whole app sits behind Clerk, so the install prompt appears on authed pages — but the browser fetches the manifest, icons, and SW **uncredentialed**, which is exactly why they must be (and already are) public via the middleware matcher. This is the single most important correctness property of the phase.
- This phase adds **zero dependencies**: `next/og` (icons) and the manifest/metadata conventions ship with Next 16.
- The Vercel CLI is not installed in this environment; the deploy step (Task 12) is run by the user (e.g. `! npm i -g vercel` then `! vercel --prod`, or via the Vercel dashboard). Everything else is fully implementable and verifiable locally.
- This is the **final** PRD phase; on completion, all six phases are done and the POC matches the PRD's MVP scope.

Sources: [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps), [Manifest file convention](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest), [ImageResponse](https://nextjs.org/docs/app/api-reference/functions/image-response).
