import type { LangfuseSpanProcessor } from '@langfuse/otel'

/**
 * Langfuse gate for the coach's AI SDK telemetry. Everything keys off env
 * presence: both LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY set means the
 * instrumentation hook registered an exporter and the chat route turns the
 * telemetry flag on; either absent means no exporter, no flag, zero overhead —
 * the same unconfigured-null idiom as getRedis()/push.ts.
 *
 * Privacy: the AI SDK's OTel integration records prompts, outputs, and tool
 * IO by default; we send exactly that default and nothing more (no extra
 * metadata, no user identifiers beyond what the spans already carry).
 */

export function isLangfuseConfigured(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY)
}

// Stored on globalThis, NOT module scope: instrumentation.ts and route
// handlers are bundled separately by Next, so each would get its own copy of
// a module-level singleton. globalThis is shared per Node process.
interface LangfuseGlobal {
  __langfuseSpanProcessor?: LangfuseSpanProcessor
}

export function setLangfuseSpanProcessor(processor: LangfuseSpanProcessor): void {
  ;(globalThis as LangfuseGlobal).__langfuseSpanProcessor = processor
}

/**
 * The `experimental_telemetry` value for the coach's streamText call:
 * enabled + tagged when Langfuse is configured, undefined (fully off) when not.
 */
export function coachTelemetry(): { isEnabled: true; functionId: 'coach-chat' } | undefined {
  return isLangfuseConfigured() ? { isEnabled: true, functionId: 'coach-chat' } : undefined
}

/**
 * Force-exports buffered spans — required on Vercel, where the function may
 * freeze before the batch export timer fires. Fails soft: a lost trace must
 * never surface as a request error.
 */
export async function flushCoachTelemetry(): Promise<void> {
  const processor = (globalThis as LangfuseGlobal).__langfuseSpanProcessor
  if (!processor) return
  try {
    await processor.forceFlush()
  } catch (error: unknown) {
    console.error('[coach] telemetry flush failed', error)
  }
}
