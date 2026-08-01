import type { Instrumentation } from 'next'
import { isLangfuseConfigured, setLangfuseSpanProcessor } from '@/lib/coach/telemetry'

/**
 * Server/edge observability wiring — Next's instrumentation hook.
 *
 * Every piece is env-gated and dynamically imported: an unconfigured deploy
 * loads none of the SDKs and register() is a no-op. Runtime-only Sentry init
 * (no withSentryConfig build plugin): the build plugin exists to upload source
 * maps, which needs SENTRY_AUTH_TOKEN and would have to compose with the
 * serwist Turbopack wrapper in next.config.ts — deferred as a follow-up so
 * the sw.js build path stays untouched.
 */

function sentryDsn(): string | undefined {
  return process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || undefined
}

export async function register(): Promise<void> {
  const isNode = process.env.NEXT_RUNTIME === 'nodejs'

  // Langfuse span processor (Node only — the chat route is a Node function).
  // Keys are read from LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY /
  // LANGFUSE_BASEURL by the processor itself; its default span filter exports
  // only gen_ai.* spans, so non-AI traffic never leaves the box.
  const langfuseProcessor =
    isNode && isLangfuseConfigured()
      ? new (await import('@langfuse/otel')).LangfuseSpanProcessor()
      : undefined

  const dsn = sentryDsn()
  if (dsn) {
    const Sentry = await import('@sentry/nextjs')
    Sentry.init({
      dsn,
      environment: process.env.VERCEL_ENV ?? 'development',
      // Low sample: errors are the point; traces are a free-tier budget item.
      tracesSampleRate: 0.1,
      // When both tools are configured, Langfuse rides Sentry's OTel pipeline —
      // registering a second global tracer provider would be ignored.
      ...(langfuseProcessor ? { openTelemetrySpanProcessors: [langfuseProcessor] } : {}),
    })
  } else if (langfuseProcessor) {
    // Langfuse alone: it needs a global tracer provider of its own.
    const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node')
    new NodeTracerProvider({ spanProcessors: [langfuseProcessor] }).register()
  }

  if (langfuseProcessor) {
    // AI SDK v7 telemetry is integration-based: without this registration the
    // `experimental_telemetry` flag on streamText emits nothing at all.
    const { registerTelemetry } = await import('ai')
    const { OpenTelemetry } = await import('@ai-sdk/otel')
    registerTelemetry(new OpenTelemetry())
    setLangfuseSpanProcessor(langfuseProcessor)
  }
}

/**
 * Server-side request errors (App Router RSC/route failures) — forwarded to
 * Sentry per its documented onRequestError pattern; inert without a DSN.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!sentryDsn()) return
  const Sentry = await import('@sentry/nextjs')
  Sentry.captureRequestError(error, request, context)
}
