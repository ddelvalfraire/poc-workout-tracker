// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderStaticIntl } from '../../../vitest.intl'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { GoalCreate } from './goal-create'

/**
 * The trigger is all a static render reaches — the option lists live behind
 * the sheet's open state. What it does prove is that the component resolves
 * its copy through the catalog at render, which is the change that mattered:
 * these labels used to be module-scope constants built at import, before any
 * request existed, so they could never have been translated at all.
 */
describe('GoalCreate localization', () => {
  it('renders its trigger copy from the catalog', () => {
    expect(renderStaticIntl(<GoalCreate unit="kg" />)).toContain('New goal')
  })

  it('leaves no unresolved key path in the output', () => {
    // A missing message renders as its own key path, so this catches a typo
    // that would otherwise ship "GoalCreate.newGoalAction" to a user.
    expect(renderStaticIntl(<GoalCreate unit="kg" />)).not.toMatch(/GoalCreate\.[a-zA-Z.]+/)
  })
})
