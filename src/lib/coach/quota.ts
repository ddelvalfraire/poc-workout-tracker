import { consumeUsage, getUsage, type ConsumeResult } from '@/db/usage-counters'

/**
 * The free coach-message taste for users WITHOUT the coach entitlement.
 * Entitled (Max) users bypass this entirely in /api/chat — the meter is only
 * consulted for the unentitled, so it is the paywall's "try before you buy".
 *
 * Lifetime, not periodic: a monthly free taste would hand paid inference to
 * non-converters every month. One taste, ever. See metering decisions.
 */
export const FREE_COACH_MESSAGE_QUOTA = 3

const METER = 'coach_message'
const PERIOD = 'lifetime'

/** Atomically spend one free coach message. `allowed: false` = the wall. */
export function consumeFreeCoachMessage(userId: string): Promise<ConsumeResult> {
  return consumeUsage(userId, METER, PERIOD, FREE_COACH_MESSAGE_QUOTA)
}

/** Free coach messages already used (0..QUOTA) — for UI/analytics only. */
export function freeCoachMessagesUsed(userId: string): Promise<number> {
  return getUsage(userId, METER, PERIOD)
}
