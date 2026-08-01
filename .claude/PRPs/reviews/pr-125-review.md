# PR Review: #125 — feat: env-gated observability

**Reviewed**: 2026-07-31
**Author**: ddelvalfraire
**Branch**: feat/observability → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The no-op guarantee is proven, not asserted: an env-absent build was run and
the Sentry client SDK is absent from the build manifest (lazy chunk, ~9KB
stub); serwist emission verified intact because Sentry is runtime-only (no
withSentryConfig fighting Turbopack — the right composition call, with
source maps as an explicit follow-up). The ai@7 telemetry finding was
verified against installed types rather than assumed (v7 dropped OTel-native
telemetry; @ai-sdk/otel bridge + @langfuse/otel processor is the current
chain), Sentry/Langfuse coexist via openTelemetrySpanProcessors instead of
competing providers, and the coach flush rides after() for Vercel's
post-response freeze. Heartbeat pings success-only so degraded runs alert.
Lockfile discipline held (npm synced, no pnpm-lock — the #122 lesson).

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- ai pinned 7.0.47 exactly via the otel bridge — future ai bumps must move
  both; noted in the commit body.
- Default Langfuse IO capture includes prompt/tool payloads (privacy-noted
  in-code) — coach chats contain training data, not photos; acceptable,
  revisit if multi-user.
- Configured Sentry client chunk is ~150KB gz post-hydration — lazy,
  outside the app budget path; monitor if INP ever degrades.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 1842 tests (12 new) |
| Build | Pass env-absent, /serwist/sw.js intact |
| Migration | None |

## Files Reviewed
- src/instrumentation.ts, instrumentation-client.ts — Sentry + provider wiring
- src/lib/coach/telemetry.ts(+test) — gate + flush
- src/app/api/chat/route.ts — gated experimental_telemetry + after()
- src/app/api/cron/reminders/route.ts(+test) — heartbeat
- src/app/global-error.tsx, .env.example, package.json/package-lock.json
