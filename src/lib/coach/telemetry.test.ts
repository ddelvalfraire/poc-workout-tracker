import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LangfuseSpanProcessor } from '@langfuse/otel'
import {
  coachTelemetry,
  flushCoachTelemetry,
  isLangfuseConfigured,
  setLangfuseSpanProcessor,
} from './telemetry'

// The processor handle lives on globalThis (shared across Next's separate
// instrumentation/route bundles) — reset it between tests the same way.
function clearGlobalProcessor() {
  delete (globalThis as { __langfuseSpanProcessor?: unknown }).__langfuseSpanProcessor
}

beforeEach(() => {
  clearGlobalProcessor()
})

afterEach(() => {
  vi.unstubAllEnvs()
  clearGlobalProcessor()
})

describe('isLangfuseConfigured', () => {
  it('is false when neither key is set', () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', '')
    vi.stubEnv('LANGFUSE_SECRET_KEY', '')
    expect(isLangfuseConfigured()).toBe(false)
  })

  it('is false when only one key is set', () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-test')
    vi.stubEnv('LANGFUSE_SECRET_KEY', '')
    expect(isLangfuseConfigured()).toBe(false)
  })

  it('is true when both keys are set', () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-test')
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-lf-test')
    expect(isLangfuseConfigured()).toBe(true)
  })
})

describe('coachTelemetry', () => {
  it('returns undefined (telemetry fully off) when unconfigured', () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', '')
    vi.stubEnv('LANGFUSE_SECRET_KEY', '')
    expect(coachTelemetry()).toBeUndefined()
  })

  it('returns the enabled, tagged options when configured', () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-test')
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-lf-test')
    expect(coachTelemetry()).toEqual({ isEnabled: true, functionId: 'coach-chat' })
  })
})

describe('flushCoachTelemetry', () => {
  it('resolves quietly when no processor was ever registered', async () => {
    await expect(flushCoachTelemetry()).resolves.toBeUndefined()
  })

  it('force-flushes the registered processor', async () => {
    // Arrange
    const forceFlush = vi.fn().mockResolvedValue(undefined)
    setLangfuseSpanProcessor({ forceFlush } as unknown as LangfuseSpanProcessor)

    // Act
    await flushCoachTelemetry()

    // Assert
    expect(forceFlush).toHaveBeenCalledOnce()
  })

  it('fails soft when the flush rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const forceFlush = vi.fn().mockRejectedValue(new Error('export down'))
    setLangfuseSpanProcessor({ forceFlush } as unknown as LangfuseSpanProcessor)

    await expect(flushCoachTelemetry()).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith('[coach] telemetry flush failed', expect.any(Error))
    errorSpy.mockRestore()
  })
})
