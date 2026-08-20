/**
 * Tape-measurement sites — the app-level enum behind body_measurements.site
 * (text column + $type union, like `source` and `set_type`). Fixed v1 set;
 * adding a site is a code change, not user config.
 */

import type { Message } from './message'

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

/**
 * The catalog key for a site's UI label, in the `Body` namespace.
 *
 * Title-casing the stored enum value only ever produced English, and the
 * value is a database fact that must never be written in the creating user's
 * language. The enum stays here, the words live in `Body.site.*`, and the
 * picker, the history heading and the chart label all read the same one.
 */
export function measurementSiteLabel(site: MeasurementSite): Message<`site.${MeasurementSite}`> {
  return { key: `site.${site}` }
}
