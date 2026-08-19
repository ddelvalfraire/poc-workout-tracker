import 'server-only'
import { PostHog } from 'posthog-node'

/**
 * Server-side analytics seam — the tracking plan IS this type union.
 *
 * Two rules this module exists to enforce:
 *
 * 1. Health-data allowlist (MHMDA posture): event properties carry counts,
 *    durations, and coarse enums ONLY. Exercise names, weights, bodyweight,
 *    notes, or any workout *content* must never appear here — the content
 *    stays in Postgres. Adding a property means widening a type below, which
 *    makes the decision reviewable in the diff.
 *
 * 2. Fail-open: analytics must never break a request. Capture errors are
 *    logged and swallowed (same stance as the coach rate limiter: it protects
 *    insight, it is not a correctness boundary).
 *
 * Money/product events are captured HERE (server) rather than in the browser
 * because ad blockers eat 25-35% of client-side requests; the client SDK
 * (instrumentation-client.ts) sends only pageviews. Client-only events in the
 * tracking plan (onboarding_completed, pwa_*, paywall_viewed) live with their
 * UI when those surfaces ship.
 *
 * distinct_id is the Clerk user id — an identifier WE own, so history can be
 * joined/merged across analytics projects or vendors later (the batch-export
 * escape hatch). Pre-signup anonymous activity stitches when the consent step
 * lands and identify() is called client-side with the same id.
 *
 * Two accepted imprecisions (documented, not bugs):
 * - MCP tool writes (lib/mcp/write-tools.ts) fire NO events, deliberately:
 *   the MCP surface is owner-only, and owner activity in a product funnel is
 *   noise. Revisit only if MCP ever becomes user-facing.
 * - The transition pre-reads in the actions (is_first, completed-vs-not) can
 *   race a same-instant duplicate submit and double-fire one event. The
 *   window is milliseconds and the funnel impact rounds to zero; the fix
 *   (transition detection inside the write's RETURNING) isn't worth the db
 *   surface it would touch.
 */

export type AnalyticsEvent =
  | { name: 'signup_completed'; properties: { method: 'email' | 'oauth' } }
  | {
      name: 'program_started'
      properties: { source: 'template' | 'custom' | 'coach'; day_count: number }
    }
  | {
      name: 'workout_started'
      properties: { source: 'program_day' | 'adhoc'; is_resumed: boolean }
    }
  | {
      name: 'workout_completed'
      properties: {
        duration_min: number
        exercise_count: number
        set_count: number
        is_first: boolean
      }
    }
  | {
      name: 'workout_abandoned'
      properties: { elapsed_min: number; set_count_logged: number }
    }
  | {
      name: 'trial_started'
      properties: { plan: 'pro' | 'max'; days: number }
    }
  | {
      name: 'subscription_started'
      properties: {
        plan: 'pro' | 'max'
        period: 'monthly' | 'annual' | 'lifetime'
        from_trial: boolean
      }
    }
  | {
      name: 'subscription_cancelled'
      properties: { plan: 'pro' | 'max'; tenure_days: number }
    }

/**
 * Whole minutes between two instants, clamped to >= 0; 0 when either side is
 * missing (a manual log without explicit timestamps has no real duration).
 */
export function durationMin(
  startedAt: Date | null | undefined,
  completedAt: Date | null | undefined,
): number {
  if (!startedAt || !completedAt) return 0
  return Math.max(0, Math.round((completedAt.getTime() - startedAt.getTime()) / 60_000))
}

/**
 * Counts off the validated wire input — structural type so this module never
 * imports the workout-input schema. Counts only, per the health-data rule.
 */
export function workoutInputCounts(input: { exercises: ReadonlyArray<{ sets: ReadonlyArray<unknown> }> }): {
  exercise_count: number
  set_count: number
} {
  return {
    exercise_count: input.exercises.length,
    set_count: input.exercises.reduce((n, e) => n + e.sets.length, 0),
  }
}

let client: PostHog | null | undefined

/** Singleton, or null when unconfigured (dev without a key = silent no-op). */
function getClient(): PostHog | null {
  if (client !== undefined) return client
  // NEXT_PUBLIC_ on purpose in a server-only module: PostHog uses ONE public
  // project key for both browser and server ingestion (see .env.example).
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) {
    client = null
    return client
  }
  client = new PostHog(key, {
    // Server-to-server: no ad blockers in the path, so talk to the ingest
    // host directly rather than through the /_i proxy.
    host: 'https://us.i.posthog.com',
    // Serverless posture: don't batch in a process that may be frozen or
    // killed after the response — hand each event to the transport at once.
    flushAt: 1,
    flushInterval: 0,
  })
  return client
}

/** Flag lookups bound the request; a slow PostHog must not stall a page. */
const FLAG_TIMEOUT_MS = 1500

/**
 * Server-side feature-flag check against PostHog (remote evaluation), riding
 * the same client/key as event capture. FALSE on every failure mode —
 * unconfigured, network error, timeout — so flag-gated features fail CLOSED.
 * Gates that must not depend on PostHog uptime OR-compose this with their own
 * env allowlist (see @/lib/coach/access).
 */
export async function isServerFeatureEnabled(
  flag: string,
  distinctId: string,
): Promise<boolean> {
  const posthog = getClient()
  if (!posthog) return false
  try {
    // Race tradeoff, acknowledged: a timeout win leaves the underlying
    // request running (harmless — nothing consumes its late result, and
    // posthog-node may still log a $feature_flag_called for it).
    // isFeatureEnabled is deprecated in posthog-node v5 (evaluateFlags is the
    // successor) — migrate on the next major bump.
    const result = await Promise.race([
      posthog.isFeatureEnabled(flag, distinctId),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), FLAG_TIMEOUT_MS)),
    ])
    return result === true
  } catch (error) {
    console.error('[analytics] flag check failed', { flag, error })
    return false
  }
}

/**
 * Capture one tracking-plan event for a user. Awaitable but safe to
 * fire-and-forget (`void captureServerEvent(...)`) — failures never throw.
 */
export async function captureServerEvent(
  clerkUserId: string,
  event: AnalyticsEvent,
): Promise<void> {
  const posthog = getClient()
  if (!posthog) return
  try {
    // captureImmediate resolves once the transport accepted the event —
    // required in serverless where a queued send may never flush.
    await posthog.captureImmediate({
      distinctId: clerkUserId,
      event: event.name,
      properties: event.properties,
    })
  } catch (error) {
    console.error('[analytics] capture failed', { event: event.name, error })
  }
}
