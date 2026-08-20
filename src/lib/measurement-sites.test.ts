import { describe, it, expect } from 'vitest'
import { renderMessageIn } from '../../vitest.intl'
import { MEASUREMENT_SITES, isMeasurementSite, measurementSiteLabel } from './measurement-sites'

describe('measurementSiteLabel', () => {
  // A DESCRIPTOR, not a sentence: title-casing the stored enum only ever
  // produced English, and `body_measurements.site` is a database fact that
  // must never be written in the creating user's language.
  it('names the catalog key for a site rather than title-casing the value', () => {
    expect(measurementSiteLabel('waist')).toEqual({ key: 'site.waist' })
    expect(measurementSiteLabel('shoulders')).toEqual({ key: 'site.shoulders' })
  })

  it('has a resolving key for every site in the enum', () => {
    for (const site of MEASUREMENT_SITES) {
      const label = renderMessageIn('Body', measurementSiteLabel(site))
      expect(label, `Body.site.${site} is missing from the catalog`).not.toMatch(
        /Body\.[a-zA-Z.]+/,
      )
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('reads the words the picker and the history heading render', () => {
    expect(renderMessageIn('Body', measurementSiteLabel('waist'))).toBe('Waist')
    expect(renderMessageIn('Body', measurementSiteLabel('calf'))).toBe('Calf')
  })
})

describe('isMeasurementSite', () => {
  it('narrows the enum values and rejects everything else', () => {
    expect(isMeasurementSite('waist')).toBe(true)
    expect(isMeasurementSite('Waist')).toBe(false)
    expect(isMeasurementSite('forearm')).toBe(false)
    expect(isMeasurementSite(null)).toBe(false)
  })
})
