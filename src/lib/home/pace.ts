/**
 * Pace presentation — pure, because "4:52" is a formatting decision with
 * enough edge cases to deserve a test rather than a template literal in a
 * component.
 */

/** Metres in a statute mile — the same constant the distance display uses. */
export const M_PER_MILE = 1609.344

/**
 * Converts a per-kilometre pace to per-mile. A mile is longer, so the pace
 * NUMBER grows: 4:52/km is 7:50/mi. Getting this backwards (or skipping it)
 * shows a kilometre pace under a mile label, which is a lie that looks
 * plausible — the number is in the right range for both.
 */
export function secPerMile(secPerKm: number): number {
  return secPerKm * (M_PER_MILE / 1000)
}

/**
 * Seconds per unit distance as `m:ss`, always two digits of seconds. Rounds to
 * the nearest second BEFORE splitting, so 299.6 reads 5:00 rather than 4:60.
 * Hours fold into the minutes field on purpose: an 80-minute kilometre is a
 * walk, not an athletic pace, and "80:00" is clearer there than "1:20:00",
 * which would read as a time of day.
 *
 * Distance-unit agnostic — pass whichever pace you mean, and label it to
 * match.
 */
export function formatPace(secPer: number): string {
  const total = Math.round(secPer)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
