import { z } from 'zod'

/**
 * RevenueCat wire shapes — the ONLY place they exist. Deliberately minimal:
 * only the fields the route and processor actually read are named; everything
 * else rides along in the raw payload stored by the inbox. Loose by design —
 * RC adds event types and fields without notice, and an unknown type must
 * flow through as data (to be marked `ignored`), never fail validation.
 */

/**
 * The webhook envelope: `{ api_version, event: {...} }`. Field presence
 * varies by event type, so everything beyond identity is optional.
 */
export const rcEventSchema = z.object({
  /** RC's event id — retries reuse it; the inbox dedupe key. */
  id: z.string().min(1),
  /** e.g. INITIAL_PURCHASE, RENEWAL, TRANSFER — validated as a plain string
   *  so unknown future types classify as log-only instead of erroring. */
  type: z.string().min(1),
  /** SANDBOX | PRODUCTION — one shared stream, filtered per deployment. */
  environment: z.string().min(1),
  /** Absent on some event types (e.g. TRANSFER carries the arrays instead). */
  app_user_id: z.string().optional(),
  /** Every id RC knows for this customer, ours included after any merge. */
  aliases: z.array(z.string()).optional(),
  /** TRANSFER only: the users losing / gaining the subscription. */
  transferred_from: z.array(z.string()).optional(),
  transferred_to: z.array(z.string()).optional(),
})

export const rcWebhookBodySchema = z.object({
  api_version: z.string().optional(),
  event: rcEventSchema.loose(),
})

export type RcEvent = z.infer<typeof rcEventSchema>
export type RcWebhookBody = z.infer<typeof rcWebhookBodySchema>
