# Implementation Report: PWA + Deploy (Phase 6)

## Summary
Made the workout tracker installable as a PWA with **zero new dependencies**. Added a Web App Manifest (`app/manifest.ts`), three request-time-generated PNG icons via `next/og` `ImageResponse` route handlers (192 any, 512 maskable, 180 apple-touch), a minimal online-only service worker (`public/sw.js`) with a `fetch` handler for installability, a production-gated client component that registers it, and the layout/`next.config` metadata wiring (`viewport.themeColor`, `appleWebApp`, apple-touch-icon, `/sw.js` `no-cache` headers). All PWA surfaces (manifest, icons, SW) are public uncredentialed — confirmed against the existing Clerk middleware matcher with no `src/proxy.ts` change.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium — matched |
| Files Changed | 11 (8 create, 3 update) | 11 (9 create, 2 update) |
| New dependencies | 0 | 0 |

> Note: the plan listed 8 creates + 3 updates, but `src/proxy.ts` was correctly *not* touched; actual split is 9 created + 2 updated (`layout.tsx`, `next.config.ts`).

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Shared icon element (`src/lib/pwa-icon.tsx`) | ✅ Complete | Bold "W" glyph on `#0a0a0a`; named constants, maskable safe-area scale |
| 2 | 192px any-purpose icon route | ✅ Complete | `/icons/icon-192.png` → 200 image/png |
| 3 | 512px maskable icon route | ✅ Complete | `/icons/icon-512.png` → 200 image/png |
| 4 | Apple touch icon route | ✅ Complete | `/icons/apple-touch-icon.png` → 200 image/png, opaque |
| 5 | Web App Manifest (`src/app/manifest.ts`) | ✅ Complete | Served at `/manifest.webmanifest`, `application/manifest+json` |
| 6 | Service worker (`public/sw.js`) | ✅ Complete | `skipWaiting`/`clients.claim` + network-first navigate `fetch` |
| 7 | Layout wiring (`src/app/layout.tsx`) | ✅ Complete | `viewport.themeColor`, `appleWebApp`, `icons.apple`, mounted register |
| 8 | SW registration component | ✅ Complete | `'use client'`, production-only, renders `null` |
| 9 | `next.config.ts` headers for `/sw.js` | ✅ Complete | `Cache-Control: no-cache…` + `Service-Worker-Allowed: /` |
| 10 | Manifest unit test | ✅ Complete | 3 tests, all green |
| 11 | PWA e2e (`e2e/pwa.spec.ts`) | ✅ Complete | 5 tests, all green |
| 12 | Deploy to Vercel + env wiring | ✅ Complete | Live at https://poc-workout-tracker.vercel.app |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (`tsc --noEmit`) | ✅ Pass | Zero type errors |
| Lint (`eslint`) | ✅ Pass | Zero errors |
| Unit Tests (`vitest run`) | ✅ Pass | 76 passed (3 new manifest tests) |
| Build (`next build`) | ✅ Pass | All 3 icon routes + `/manifest.webmanifest` in route list; no `themeColor` warning |
| Integration (prod smoke) | ✅ Pass | manifest/sw/icons all 200, correct content-types, no `/sign-in` redirect; `/sw.js` carries `no-cache` |
| E2E (`playwright test`) | ✅ Pass | 8 passed (5 new PWA + 3 existing) |

### Production smoke output
```
manifest  → HTTP 200 | application/manifest+json | Workout Tracker | standalone | icons: 2
sw.js     → HTTP 200 | application/javascript | Cache-Control: no-cache, no-store, must-revalidate | Service-Worker-Allowed: /
icon-192.png        → HTTP 200 | image/png
icon-512.png        → HTTP 200 | image/png
apple-touch-icon.png→ HTTP 200 | image/png
```

## Files Changed

| File | Action | Notes |
|---|---|---|
| `src/lib/pwa-icon.tsx` | CREATED | Shared `ImageResponse` icon builder |
| `src/app/icons/icon-192.png/route.tsx` | CREATED | 192 any-purpose icon route |
| `src/app/icons/icon-512.png/route.tsx` | CREATED | 512 maskable icon route |
| `src/app/icons/apple-touch-icon.png/route.tsx` | CREATED | 180 iOS icon route |
| `src/app/manifest.ts` | CREATED | Web App Manifest |
| `public/sw.js` | CREATED | Minimal online-only service worker |
| `src/components/pwa/service-worker-register.tsx` | CREATED | Production-only SW registration |
| `src/app/manifest.test.ts` | CREATED | Manifest unit tests (3) |
| `e2e/pwa.spec.ts` | CREATED | PWA e2e (5) |
| `src/app/layout.tsx` | UPDATED | `viewport`, `appleWebApp`, apple icon, mounted register |
| `next.config.ts` | UPDATED | `headers()` for `/sw.js` |

## Deviations from Plan
- **File split**: 9 created / 2 updated vs the plan's 8/3 — because `src/proxy.ts` was (correctly) left untouched; its matcher already makes `.png`/`.js`/`.webmanifest` public.
- **Icon glyph**: used a bold "W" (the plan's stated alternative) rather than an emoji, to avoid emoji-font rendering variance in `ImageResponse`.
- No other deviations.

## Issues Encountered
- A `[Fact-Forcing Gate]` hook blocked each Write/Edit on first attempt, requiring facts before retry. Provided the facts and retried; no functional impact.
- A pre-existing build log line ("wger exerciseinfo over 2MB can not be cached") appears during e2e — unrelated to this phase (Phase 2 proxy caching), all tests still pass.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/app/manifest.test.ts` | 3 | manifest name/short_name, `standalone`+`start_url`, 192/512 icons incl. maskable |
| `e2e/pwa.spec.ts` | 5 | public `/manifest.webmanifest`, `/sw.js` JS, three `/icons/*.png` PNGs |

## Deploy
Deployed to Vercel production via the CLI (authenticated as `ddelvalfraire`, team `davids-projects-393e40a4`).

- **Production URL**: https://poc-workout-tracker.vercel.app
- **Deployment ID**: `dpl_C7msDqAH2gKCeLZtjhcSsxATwtLE` — `readyState: READY`, `target: production`
- **Env vars set** (Production): `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL`, `DATABASE_URL` (transaction pooler, 6543). `DATABASE_URL_DIRECT` intentionally NOT set at runtime.
- **GitHub auto-connect** failed during `vercel link` (repo connect permission) — deploys are run directly via the CLI for now; connecting the repo in the dashboard later enables push-to-deploy.
- **Preview env vars**: only Production was set (the Preview `env add` hit a CLI prompt-conflict). Add Preview vars later if preview deploys are needed.

### Live verification (curl)
```
/manifest.webmanifest → HTTP 200 | application/manifest+json  (valid JSON, standalone, 2 icons)
/sw.js                → HTTP 200 | application/javascript | cache-control: no-cache, no-store, must-revalidate
/icons/icon-192.png|icon-512.png|apple-touch-icon.png → HTTP 200 | image/png
/                     → HTTP 404 via curl — EXPECTED: Clerk DEV keys require a dev-browser handshake
                        (x-clerk-auth-status: signed-out, reason: protect-rewrite, dev-browser-missing).
                        A real browser completes the handshake and redirects to /sign-in. /sign-in → 200.
```

> To get a clean unauthenticated `/ → /sign-in` redirect for non-browser clients, switch to Clerk **production** keys with a configured domain — out of scope for this POC (plan Decision #8).

## Manual Validation Still Pending
- [ ] In a phone browser at the live URL: sign in → log → history round-trip.
- [ ] "Add to Home Screen" (Android Chrome / iOS Safari); launched icon opens standalone.
- [ ] Lighthouse "Installable" against the HTTPS URL.

## Next Steps
- [ ] Manual phone install + round-trip validation on the live URL.
- [ ] Code review via `/code-review`.
- [ ] Commit via `/prp-commit` and open a PR via `/prp-pr`.
