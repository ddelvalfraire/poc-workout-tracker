'use client'

import { useEffect } from 'react'

/**
 * The identify()/reset() reconciler — renders nothing; exists so PostHog's
 * per-DEVICE identity always converges to the per-USER consent fact the
 * server passed down (root layout reads the projection). This is what fixes
 * "consented on the phone, laptop still anonymous" and, more importantly,
 * the reverse after a withdrawal.
 *
 * Rules it encodes:
 * - identify() runs ONLY when analytics_identity is currently granted —
 *   the one line the whole consent arc exists to gate.
 * - reset() runs only when the device is identified as this user and the
 *   grant is gone: it must never churn anonymous device ids on every load.
 * - The SDK loads lazily (instrumentation-client); attempts back off until
 *   it is ready, and give up quietly — the next navigation retries.
 */

export function decideIdentityAction(
  currentDistinctId: string | undefined,
  userId: string,
  granted: boolean,
): 'identify' | 'reset' | 'none' {
  if (granted) return currentDistinctId === userId ? 'none' : 'identify'
  return currentDistinctId === userId ? 'reset' : 'none'
}

export function ConsentIdentity({ userId, granted }: { userId: string; granted: boolean }) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []

    async function attempt(): Promise<boolean> {
      const { default: posthog } = await import('posthog-js')
      if (!posthog.__loaded) return false
      if (cancelled) return true
      const action = decideIdentityAction(posthog.get_distinct_id(), userId, granted)
      if (action === 'identify') posthog.identify(userId)
      else if (action === 'reset') posthog.reset()
      return true
    }

    // The SDK chunk arrives asynchronously after hydration; try now, then
    // twice more with backoff. Still not loaded = analytics is off or slow;
    // the next page load reconciles.
    void attempt().then((done) => {
      if (done) return
      for (const delay of [1000, 3000]) {
        timers.push(
          setTimeout(() => {
            void attempt()
          }, delay),
        )
      }
    })
    return () => {
      cancelled = true
      for (const t of timers) clearTimeout(t)
    }
  }, [userId, granted])

  return null
}
