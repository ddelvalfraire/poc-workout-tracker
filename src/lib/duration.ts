/**
 * Duration + distance input codecs for cardio (duration / duration_distance)
 * sets — the string↔canonical bridge the drafts' controlled inputs speak.
 *
 * Canonical storage is SECONDS (`duration_sec` int) and METERS (`distance_m`
 * numeric), matching the schema. Inputs speak:
 *   duration — "mm:ss" (or "h:mm:ss"); a bare number reads as MINUTES
 *              (typing "30" for a 30-minute run is the natural cardio entry).
 *   distance — kilometers, decimal ("5" = 5 km, "0.4" = 400 m). One display
 *              unit for ENTRY everywhere (builder + logger), chosen over m/km
 *              switching so a typed number always means the same thing;
 *              read-only surfaces may still render short distances in meters
 *              (lib/format.ts formatLoggedSet).
 *
 * Parsers are lenient-mapper style (blank → null, junk → null) like
 * `toReps`/`toWeight` in workout-draft.ts; the server boundary re-validates.
 */

/** Upper bound for a single set's duration — mirrors rep-progression's maxSec
 *  ceiling (24 h); anything past it is a typo, not a session. */
export const MAX_DURATION_SEC = 86_400

/** Seconds → the input's editable text: 750 → "12:30", 3905 → "1:05:05".
 *  Sub-minute pads to "0:45" so the value always reads as a clock. */
export function formatDurationInput(totalSec: number): string {
  const clamped = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(clamped / 3600)
  const m = Math.floor((clamped % 3600) / 60)
  const s = clamped % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/**
 * Duration input → seconds, or null when blank/invalid. Accepts "mm:ss",
 * "h:mm:ss", and a bare number (MINUTES, decimals allowed: "1.5" = 90 s).
 * Seconds/minutes segments past 59 in colon form are rejected — "1:75" is a
 * typo, not 2:15. Values above MAX_DURATION_SEC are invalid, not clamped.
 */
export function parseDurationInput(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  let totalSec: number
  const colon = trimmed.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/)
  if (colon) {
    const h = colon[1] !== undefined ? parseInt(colon[1], 10) : 0
    const m = parseInt(colon[2], 10)
    const s = parseInt(colon[3], 10)
    // Minutes cap at 59 ONLY when an hours part exists: "75:30" is a valid
    // 75-minute steady-state entry (mm:ss with no hour prefix), while
    // "1:75:00" is a typo. Seconds always cap.
    if (s > 59 || (colon[1] !== undefined && m > 59)) return null
    totalSec = h * 3600 + m * 60 + s
  } else if (/^\d+(\.\d+)?$/.test(trimmed)) {
    totalSec = Math.round(parseFloat(trimmed) * 60)
  } else {
    return null
  }
  return totalSec > 0 && totalSec <= MAX_DURATION_SEC ? totalSec : null
}

/** Meters → the km input's editable text: 2500 → "2.5", 400 → "0.4". Trailing
 *  zeros trimmed via Number(); precision capped at 3 decimals (meter grain). */
export function formatDistanceInput(distanceM: number): string {
  // 5 decimals of km = the column's centimeter precision, so an untouched
  // edit round-trip re-saves the exact stored value (an MCP-authored 1234.56 m
  // must not silently become 1235 m). Number() trims the trailing zeros.
  return String(Number((Math.max(0, distanceM) / 1000).toFixed(5)))
}

/** km input → meters, or null when blank/invalid/zero. Meters are stored to
 *  numeric(9,2); sub-centimeter noise from km decimals is rounded away. */
export function parseDistanceInput(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  const meters = Math.round(parseFloat(trimmed) * 1000 * 100) / 100
  return meters > 0 && meters <= 9_999_999.99 ? meters : null
}
