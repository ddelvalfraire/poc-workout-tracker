/**
 * The durations a manual grant may run for.
 *
 * Its own module rather than a const in the actions file: a `'use server'`
 * module may only export async functions, so a value exported from there
 * fails the build — and the form needs these values in the browser to render
 * the picker.
 *
 * Fixed choices rather than a free-text date. An operator granting Max is
 * giving away money, and a mistyped year is the expensive typo; a closed set
 * cannot produce one, and "no expiry" stays a deliberate, named choice rather
 * than an empty field.
 */

export const GRANT_DURATIONS = ['7d', '30d', '90d', '1y', 'forever'] as const

export type GrantDuration = (typeof GRANT_DURATIONS)[number]

const DURATION_DAYS: Record<Exclude<GrantDuration, 'forever'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
}

export function isGrantDuration(value: string): value is GrantDuration {
  return (GRANT_DURATIONS as readonly string[]).includes(value)
}

/** `null` for a perpetual grant — the shape `applyGrant` expects for endsAt. */
export function endsAtFor(duration: GrantDuration, from: Date): Date | null {
  if (duration === 'forever') return null
  return new Date(from.getTime() + DURATION_DAYS[duration] * 86_400_000)
}
