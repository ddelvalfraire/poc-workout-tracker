import { describe, expect, test, vi } from 'vitest'
import { renderStaticIntl } from '../../../vitest.intl'

// Every control here calls useRouter in a handler; a static render never
// runs the handler, but the hook still has to resolve.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { AnalyticsConsentToggle } from './analytics-consent-toggle'
import { RestDefaultSetting } from './rest-default-setting'
import { RestTimerToggle } from './rest-timer-toggle'
import { RpeLoggingToggle } from './rpe-logging-toggle'
import { WorkoutRemindersToggle } from './workout-reminders-toggle'

/**
 * The settings switches are icon-free tracks: their aria-label IS their
 * whole name, and it was the last English literal on each of them. A switch
 * whose only label ships untranslated is unusable, not merely untidy.
 */

describe('settings control names resolve through the catalog', () => {
  test('each switch carries its translated accessible name', () => {
    expect(renderStaticIntl(<AnalyticsConsentToggle granted={false} />)).toContain(
      'aria-label="Analytics identity"',
    )
    expect(renderStaticIntl(<RestTimerToggle enabled />)).toContain('aria-label="Rest timer"')
    expect(renderStaticIntl(<RpeLoggingToggle enabled={false} />)).toContain(
      'aria-label="Effort logging (RPE/RIR)"',
    )
    expect(renderStaticIntl(<WorkoutRemindersToggle />)).toContain(
      'aria-label="Workout reminders"',
    )
  })

  test('the default-rest readout pluralises its accessible name at both branches', () => {
    const one = renderStaticIntl(<RestDefaultSetting defaultRestSec={1} />)
    expect(one).toContain('aria-label="Default rest target: 1 second"')

    const many = renderStaticIntl(<RestDefaultSetting defaultRestSec={90} />)
    expect(many).toContain('aria-label="Default rest target: 90 seconds"')

    const off = renderStaticIntl(<RestDefaultSetting defaultRestSec={null} />)
    expect(off).toContain('aria-label="Default rest target: off"')
  })

  test('no key path leaks into the markup', () => {
    const html = [
      renderStaticIntl(<AnalyticsConsentToggle granted />),
      renderStaticIntl(<RestTimerToggle enabled />),
      renderStaticIntl(<RpeLoggingToggle enabled />),
      renderStaticIntl(<WorkoutRemindersToggle />),
      renderStaticIntl(<RestDefaultSetting defaultRestSec={90} />),
    ].join('')
    expect(html).not.toMatch(
      /(AnalyticsConsentToggle|RestTimerToggle|RpeLoggingToggle|WorkoutRemindersToggle|RestDefaultSetting)\.[a-zA-Z.]+/,
    )
  })
})
