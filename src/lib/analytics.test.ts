import { beforeEach, describe, expect, it, vi } from 'vitest'

// server-only throws outside a React Server environment; the module under
// test imports it purely as a guard, so stub it out here.
vi.mock('server-only', () => ({}))

const captureImmediate = vi.fn()
const isFeatureEnabled = vi.fn()
// Plain function (not arrow) so `new PostHog(...)` works in the module under test.
const posthogCtor = vi.fn(function PostHogMock() {
  return { captureImmediate, isFeatureEnabled }
})
vi.mock('posthog-node', () => ({
  PostHog: posthogCtor,
}))

/** Fresh module per test: the singleton client caches across imports. */
async function importAnalytics() {
  vi.resetModules()
  return import('./analytics')
}

describe('durationMin', () => {
  it('rounds to whole minutes', async () => {
    const { durationMin } = await importAnalytics()
    const start = new Date('2026-01-01T10:00:00Z')
    expect(durationMin(start, new Date('2026-01-01T10:42:29Z'))).toBe(42)
    expect(durationMin(start, new Date('2026-01-01T10:42:31Z'))).toBe(43)
  })

  it('is 0 when either side is missing and never negative', async () => {
    const { durationMin } = await importAnalytics()
    const start = new Date('2026-01-01T10:00:00Z')
    expect(durationMin(null, new Date())).toBe(0)
    expect(durationMin(start, undefined)).toBe(0)
    // Backdated completedAt before startedAt clamps rather than going negative.
    expect(durationMin(start, new Date('2026-01-01T09:00:00Z'))).toBe(0)
  })
})

describe('workoutInputCounts', () => {
  it('counts exercises and their sets — counts only, no content', async () => {
    const { workoutInputCounts } = await importAnalytics()
    expect(
      workoutInputCounts({ exercises: [{ sets: [1, 2, 3] }, { sets: [1] }] }),
    ).toEqual({ exercise_count: 2, set_count: 4 })
    expect(workoutInputCounts({ exercises: [] })).toEqual({ exercise_count: 0, set_count: 0 })
  })
})

describe('isServerFeatureEnabled', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
    isFeatureEnabled.mockReset()
    posthogCtor.mockClear()
  })

  it('is false when no key is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '')
    const { isServerFeatureEnabled } = await importAnalytics()

    await expect(isServerFeatureEnabled('coach-access', 'user_1')).resolves.toBe(false)
    expect(posthogCtor).not.toHaveBeenCalled()
  })

  it('is true only for an explicit true (undefined = flag unknown = closed)', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test')
    const { isServerFeatureEnabled } = await importAnalytics()

    isFeatureEnabled.mockResolvedValueOnce(true)
    await expect(isServerFeatureEnabled('coach-access', 'user_1')).resolves.toBe(true)

    isFeatureEnabled.mockResolvedValueOnce(undefined)
    await expect(isServerFeatureEnabled('coach-access', 'user_1')).resolves.toBe(false)

    isFeatureEnabled.mockResolvedValueOnce(false)
    await expect(isServerFeatureEnabled('coach-access', 'user_1')).resolves.toBe(false)
  })

  it('fails closed when the flag request rejects', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { isServerFeatureEnabled } = await importAnalytics()
    isFeatureEnabled.mockRejectedValueOnce(new Error('posthog down'))

    await expect(isServerFeatureEnabled('coach-access', 'user_1')).resolves.toBe(false)
    consoleError.mockRestore()
  })

  it('fails closed when the flag request outlives the timeout', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test')
    vi.useFakeTimers()
    const { isServerFeatureEnabled } = await importAnalytics()
    // Never resolves — only the raced timeout can settle the check.
    isFeatureEnabled.mockReturnValueOnce(new Promise(() => {}))

    const pending = isServerFeatureEnabled('coach-access', 'user_1')
    await vi.advanceTimersByTimeAsync(1600)
    await expect(pending).resolves.toBe(false)
    vi.useRealTimers()
  })
})

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

  it('captures with the WorkOS user id as distinct_id and serverless flush options', async () => {
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
