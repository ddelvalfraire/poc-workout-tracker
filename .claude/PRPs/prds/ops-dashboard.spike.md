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

---

## v2 REDESIGN (2026-08-01) — desktop-first, data-dense

User verdict on v1: "not at all useful… just 4 cards is useless… not enough
data, doesnt fit a usecase I still have to go to all three websites." v1
stopped at the overview layer; v2 applies the full pattern — RED-method
framing + Shneiderman (overview first, zoom/filter, details on demand).

### Use cases v2 must serve WITHOUT leaving the page
1. "Is prod healthy right now?" — 2-second status strip.
2. "What broke, how often, who's affected?" — errors TABLE with counts,
   users affected, first/last seen, level — not a count and a link.
3. "What is the coach doing and costing?" — daily cost/trace chart + a
   recent-traces table (time, latency, tokens, cost, model).
4. "Did delivery work?" — deploy table (state, commit, age, duration) +
   cron checks with last ping and recent status flips.
5. "Is the product being used?" — workouts/day + active-users charts (14d),
   totals, recent program-events and workouts feeds.

### Layout (desktop-first)
- Full-width (max-w-screen-2xl), 12-col CSS grid; sections stack on mobile
  but the design target is >=1280px.
- Row 1: STATUS STRIP — five compact pills: prod deploy state · cron
  status/last ping · unresolved errors 24h · coach cost 7d · active users
  7d. Red/amber/green dots; each pill anchors to its panel below.
- Row 2: ERRORS (7 cols) — unresolved issues table (level dot, title,
  culprit, count, userCount, firstSeen/lastSeen relative), 24h/7d toggle via
  searchParam; DELIVERY (5 cols) — deploys table + checks with flips.
- Row 3: COACH (7 cols) — 14d stacked bar (traces + cost line) + recent
  traces table; PRODUCT (5 cols) — workouts/day sparkbars 14d, totals,
  events feed (10), recent workouts (5).
- Auto-refresh: client toggle, 60s router.refresh interval, off by default.
- Everything keeps v1's degrade-per-panel + named-env-var contract.

### Per-source data depth (additions to the adapters)
- Sentry: issues already return count/userCount/level/culprit/firstSeen —
  render them all; add statsPeriod searchParam (24h|7d). Optional later:
  stats_v2 series.
- Langfuse: daily metrics (exists) + traces list endpoint for the recent
  table — use the CURRENT documented endpoint (the v3 list is deprecated;
  verify v2 observations/traces path live before building).
- Vercel: deployments already carry meta (sha, commit message, duration
  via ready-createdAt) — render the table, highlight ERROR states.
- healthchecks: add flips/ endpoint per check for the recent-transitions
  line.
- App vitals: add day-bucketed series (workouts/day, active users/day 14d,
  indexed date_trunc queries), longer events feed, recent workouts.

### Non-goals v2
Global time-range selector (fixed windows per panel), alert routing, log
search, multi-user RBAC (allowlist stands), realtime websockets.
