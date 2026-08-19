import { beforeEach, describe, expect, it, vi } from 'vitest'

// server-only throws outside a React Server environment; the module under
// test imports it purely as a guard, so stub it out here.
vi.mock('server-only', () => ({}))

const captureImmediate = vi.fn()
// Plain function (not arrow) so `new PostHog(...)` works in the module under test.
const posthogCtor = vi.fn(function PostHogMock() {
  return { captureImmediate }
})
vi.mock('posthog-node', () => ({
  PostHog: posthogCtor,
}))

/** Fresh module per test: the singleton client caches across imports. */
async function importAnalytics() {
  vi.resetModules()
  return import('./analytics')
}

describe('captureServerEvent', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    captureImmediate.mockReset().mockResolvedValue(undefined)
    posthogCtor.mockClear()
  })

  it('is a silent no-op when no key is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '')
    const { captureServerEvent } = await importAnalytics()

    await captureServerEvent('user_1', {
      name: 'workout_completed',
      properties: { duration_min: 42, exercise_count: 5, set_count: 18, is_first: false },
    })

    expect(posthogCtor).not.toHaveBeenCalled()
    expect(captureImmediate).not.toHaveBeenCalled()
  })

  it('captures with the Clerk user id as distinct_id and serverless flush options', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test')
    const { captureServerEvent } = await importAnalytics()

    await captureServerEvent('user_1', {
      name: 'workout_completed',
      properties: { duration_min: 42, exercise_count: 5, set_count: 18, is_first: true },
    })

    expect(posthogCtor).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({ flushAt: 1, flushInterval: 0 }),
    )
    expect(captureImmediate).toHaveBeenCalledWith({
      distinctId: 'user_1',
      event: 'workout_completed',
      properties: { duration_min: 42, exercise_count: 5, set_count: 18, is_first: true },
    })
  })

  it('reuses one client across calls', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test')
    const { captureServerEvent } = await importAnalytics()

    await captureServerEvent('user_1', {
      name: 'signup_completed',
      properties: { method: 'email' },
    })
    await captureServerEvent('user_1', {
      name: 'program_started',
      properties: { source: 'template', day_count: 4 },
    })

    expect(posthogCtor).toHaveBeenCalledTimes(1)
    expect(captureImmediate).toHaveBeenCalledTimes(2)
  })

  it('swallows transport failures — analytics never breaks a request', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    captureImmediate.mockRejectedValueOnce(new Error('network down'))
    const { captureServerEvent } = await importAnalytics()

    await expect(
      captureServerEvent('user_1', {
        name: 'workout_abandoned',
        properties: { elapsed_min: 10, set_count_logged: 3 },
      }),
    ).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalledWith(
      '[analytics] capture failed',
      expect.objectContaining({ event: 'workout_abandoned' }),
    )
    consoleError.mockRestore()
  })
})
