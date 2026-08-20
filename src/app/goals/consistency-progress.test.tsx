// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderStaticIntl } from '../../../vitest.intl'
import { ConsistencyProgress } from './consistency-progress'

/**
 * The streak summary counted weeks with hand-written English plurals before
 * the localization pass. Singular and plural are asserted separately because
 * a single-branch plural renders fine at one value and wrong at every other.
 */
function render(targetWeeks: number) {
  return renderStaticIntl(
    <ConsistencyProgress
      completedAtTimes={[]}
      scheduledWeekdays={[]}
      allowedMissesPerWeek={0}
      targetWeeks={targetWeeks}
    />,
  )
}

describe('ConsistencyProgress localization', () => {
  it('renders the singular week form', () => {
    expect(render(1)).toContain('1 week')
  })

  it('renders the plural week form', () => {
    expect(render(6)).toContain('6 weeks')
  })

  it('leaves no unresolved key path in the output', () => {
    expect(render(6)).not.toMatch(/ConsistencyProgress\.[a-zA-Z.]+/)
  })
})
