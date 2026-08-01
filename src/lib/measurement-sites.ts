/**
 * Tape-measurement sites — the app-level enum behind body_measurements.site
 * (text column + $type union, like `source` and `set_type`). Fixed v1 set;
 * adding a site is a code change, not user config.
 */

export type MeasurementSite =
  | 'neck'
  | 'shoulders'
  | 'chest'
  | 'arm'
  | 'waist'
  | 'hips'
  | 'thigh'
  | 'calf'

// Top-down body order — the site picker renders in this order.
export const MEASUREMENT_SITES = [
  'neck',
  'shoulders',
  'chest',
  'arm',
  'waist',
  'hips',
  'thigh',
  'calf',
] as const satisfies readonly MeasurementSite[]

/** Narrows untrusted input (server-action payloads, DB text) to a MeasurementSite. */
export function isMeasurementSite(value: unknown): value is MeasurementSite {
  return (MEASUREMENT_SITES as readonly unknown[]).includes(value)
}

/** UI label for a site ("waist" → "Waist"). */
export function measurementSiteLabel(site: MeasurementSite): string {
  return site.charAt(0).toUpperCase() + site.slice(1)
}
