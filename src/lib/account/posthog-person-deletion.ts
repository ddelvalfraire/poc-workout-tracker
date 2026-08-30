import 'server-only'

/**
 * PostHog person deletion for account deletion (MHMDA propagation). This is
 * the PRIVATE API (personal key + project id), not the public ingest key the
 * analytics seam uses — capture and deletion are different trust levels on
 * purpose. Distinct id is the WorkOS user id (analytics.ts sets it as
 * distinct_id on every event).
 *
 * Flow: look the person up by distinct_id, then
 * DELETE /api/projects/{id}/persons/{personId}?delete_events=true — the
 * flag queues the person's events for deletion too, not just the profile.
 *
 * Unlike analytics capture this THROWS on API failure: the caller records
 * the outcome on the consent_downstream_actions evidence row, and a silent
 * swallow here would forge propagation evidence.
 */

const POSTHOG_PRIVATE_API_HOST = 'https://us.posthog.com'

export type PosthogPersonDeletion = 'deleted' | 'not_found' | 'skipped'

export async function deletePosthogPerson(distinctId: string): Promise<PosthogPersonDeletion> {
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY
  const projectId = process.env.POSTHOG_PROJECT_ID
  // Unconfigured (dev without analytics) = honest no-op, distinct from failure.
  if (!apiKey || !projectId) return 'skipped'

  const base = `${POSTHOG_PRIVATE_API_HOST}/api/projects/${projectId}/persons`
  const headers = { Authorization: `Bearer ${apiKey}` }

  const lookup = await fetch(`${base}?distinct_id=${encodeURIComponent(distinctId)}`, { headers })
  if (!lookup.ok) {
    throw new Error(`posthog person lookup failed (${lookup.status})`)
  }
  const body = (await lookup.json()) as { results?: Array<{ id?: number | string }> }
  const personId = body.results?.[0]?.id
  // No person = the user never had identified analytics (declined consent,
  // or events never ingested). Nothing to propagate.
  if (personId === undefined || personId === null) return 'not_found'

  const res = await fetch(`${base}/${personId}/?delete_events=true`, {
    method: 'DELETE',
    headers,
  })
  if (!res.ok) {
    throw new Error(`posthog person delete failed (${res.status})`)
  }
  return 'deleted'
}
