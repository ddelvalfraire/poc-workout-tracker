import { z } from 'zod'

/**
 * Validation boundary for web-push subscription payloads — the JSON shape
 * `PushSubscription.toJSON()` produces in the browser. Untrusted like every
 * client body: the endpoint must be an https URL (push services are always
 * https; anything else is junk or SSRF bait for the send loop) and the keys
 * must be present, non-empty base64url-ish strings.
 *
 * Caps are generous versions of real-world sizes (FCM/APNs endpoints run a
 * few hundred chars; p256dh is 87, auth is 22) — they bound storage, they
 * don't fingerprint providers.
 */

const MAX_ENDPOINT = 2048
const MAX_KEY = 512

const base64UrlSchema = z
  .string()
  .min(1)
  .max(MAX_KEY)
  .regex(/^[A-Za-z0-9_=-]+$/, 'not base64url')

const endpointSchema = z
  .url()
  .min(1)
  .max(MAX_ENDPOINT)
  .refine((u) => u.startsWith('https://'), 'endpoint must be https')

export const pushSubscriptionInputSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: base64UrlSchema,
    auth: base64UrlSchema,
  }),
})

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>

/**
 * Parses an unknown request body into a subscription, or null when invalid —
 * the route turns null into a 400 (no error details leak; the only honest
 * client is the browser's own toJSON()).
 */
export function parsePushSubscriptionInput(body: unknown): PushSubscriptionInput | null {
  const result = pushSubscriptionInputSchema.safeParse(body)
  return result.success ? result.data : null
}

const endpointOnlySchema = z.object({ endpoint: endpointSchema })

/** Unsubscribe carries only the endpoint — same https/cap rules. */
export function parsePushEndpoint(body: unknown): string | null {
  const result = endpointOnlySchema.safeParse(body)
  return result.success ? result.data.endpoint : null
}
