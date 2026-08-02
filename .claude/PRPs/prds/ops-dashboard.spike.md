# SPIKE — Ops Dashboard: vendor APIs, usefulness, testing, lock-in

Written 2026-08-01, alongside the /ops v1 build. Direct user asks: "can we
create an internal dashboard that aggregates all this shit through apis?"
and "spike on what features the apis provide what is useful, how we can
test it, what is useful for ops dashboards and how to make sure that it is
not vendor locked in."

## 1. What each API provides vs what earns a card

The filter: a card earns its place only if it answers "is something wrong /
is money burning / is the system alive" at a glance. Vanity metrics don't
ship.

**Sentry (REST, Bearer token — org-scoped read)**
- Provides: issues (filterable is:unresolved, statsPeriod), events per
  issue, releases, stats_v2 time series, session/crash-free rates, alerts
  config, performance transactions.
- Useful for ops: unresolved count last 24h + top issues by frequency with
  permalinks. That's it — time series and perf belong in Sentry's own UI
  (deep link instead of rebuilding).
- Skipped deliberately: crash-free sessions (mobile-app metric), release
  health (we deploy continuously), perf transactions (Sentry UI does it
  better).

**healthchecks.io (Management API v3, X-Api-Key — read-only key exists)**
- Provides: checks list (status up/late/down/paused, last_ping, next
  expected), per-check pings log, flips (status transitions), badges.
- Useful: status + last_ping + downCount per check. The pings log is
  vendor-UI territory — skip.

**Langfuse (public REST, basic auth pk:sk — VERIFIED live this session)**
- Provides: /api/public/metrics/daily (countTraces, totalCost, per-model
  usage[] — the endpoint v1 uses, shape confirmed against
  langfuse.com/docs/analytics/daily-metrics-api), traces list/detail,
  observations, scores, prompts.
- Useful: 7-day traces + cost + tokens (the "is the coach burning money"
  glance). Trace-level debugging stays in Langfuse's UI — deep link.

**Vercel (REST, Bearer — token not yet provided)**
- Provides: deployments (state, target, createdAt), projects, env vars,
  logs (Pro), analytics (Pro).
- Useful: latest 3 production deployments + state (catches the "deploy
  silently failed" case — which actually happened this week with the
  Hobby-cron rejection). Logs/analytics are Pro-gated — never depend on
  them.

**App vitals (our own Postgres — no vendor at all)**
- workouts completed 7d, active users 7d, push subscriptions, active goals,
  pending proposals, latest program_events. The highest-signal card and the
  only one with zero external dependency; indexed counts only.

## 2. Testing strategy (three layers)

1. **Contract tests with mocked fetch** (SHIPPED, 31 tests): every adapter
   is tested for ok / unconfigured (no network touched — asserted) /
   timeout / non-200 / malformed-shape. This is the layer that protects the
   page from vendors.
2. **Live smoke, manual**: each adapter is a pure function reading env —
   runnable against real APIs via a one-liner (node -e importing the
   adapter) when a vendor changes something. Not CI: live calls in CI are
   flake + quota burn for a single-user app.
3. **The page itself is the canary**: every card carries a status dot;
   'unavailable' (amber) IS the alert that a vendor changed an API or a
   token expired. Degrade-per-card means one dead vendor can't blank the
   dashboard.

Shape-drift risk ranking: Langfuse (young API, most likely to move) >
Vercel (versioned, v6 stable) > Sentry (API 0 frozen for years) >
healthchecks (v3, tiny surface).

## 3. Anti-lock-in architecture

- **The seam is the adapter module**: each source lives in src/lib/ops/
  {vendor}.ts returning a typed OpsResult<CardShape>. The PAGE knows card
  shapes, never vendor JSON. Swapping a vendor = writing one new adapter
  that returns the same shape; the page doesn't change.
- **Exit paths, per vendor (all verified to exist):**
  - Sentry → **GlitchTip** (self-hosted, implements Sentry's API + DSN
    protocol — both the app SDK and this adapter port by changing the
    base URL), or Highlight.io (adapter rewrite, small).
  - healthchecks.io → **self-hosted healthchecks** (same OSS project, same
    API), or any pinger (the app side is a bare GET — zero coupling).
  - Langfuse → **self-hosted Langfuse** (same OSS, same API — change
    LANGFUSE_BASEURL and nothing else), the strongest exit story here.
  - Vercel → the card dies with the host; that's correct coupling (it
    monitors the host itself). Migrating hosts replaces this adapter with
    the new host's deploy API.
  - App vitals → no vendor, no exit needed.
- **Instrumentation stays neutral**: the app emits via OTel
  (@ai-sdk/otel → span processors) and standard DSN/env config — the
  observability PR (#125) deliberately avoided Sentry's build plugin and
  Vercel log drains. Data emission and data viewing are decoupled; this
  dashboard only touches the viewing side, which is the cheap side to swap.

## 4. v1 assessment against this spike

The shipped /ops matches: adapter-per-vendor seam, typed card shapes,
degrade-per-card, no new deps (plain fetch), fail-closed access (404, not
403), Langfuse live day one, others env-gated. Known gaps accepted for v1:
no historical charts (deep links cover it), no alert routing from the
dashboard (vendors' email alerts remain the pager), Vercel card dormant
until a token exists.
