import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the shared post-completion pipeline. Each step is unit-tested
 * in its own suite (lib/auto-plan-sync.test.ts, lib/trophies.test.ts, the goal
 * seam in lib/goals); here we mock them at the module boundary and pin the
 * seam's own contract: the three steps fire in order with the right arguments,
 * and the wrapper resolves ALWAYS — even against a helper whose internal
 * fail-soft regressed — because both adapters (web actions, MCP write tools)
 * call it after their save has already committed.
 */

vi.mock('@/lib/programs/auto-plan-sync', () => ({ autoSyncPlanToPerformance: vi.fn() }))
vi.mock('@/lib/goals/goals', () => ({ checkGoalAchievements: vi.fn() }))
vi.mock('@/lib/goals/trophies', () => ({ checkTrophies: vi.fn(async () => []) }))

import { completeWorkoutSideEffects } from './workout-completion'
import { autoSyncPlanToPerformance } from '@/lib/programs/auto-plan-sync'
import { checkGoalAchievements } from '@/lib/goals/goals'
import { checkTrophies } from '@/lib/goals/trophies'

const mockedAutoSync = vi.mocked(autoSyncPlanToPerformance)
const mockedCheckGoals = vi.mocked(checkGoalAchievements)
const mockedCheckTrophies = vi.mocked(checkTrophies)

const USER = 'user_123'
const ID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('completeWorkoutSideEffects', () => {
  it('runs plan sync, then the goal check, then the trophy check with the finish trigger', async () => {
    // Act
    await completeWorkoutSideEffects(USER, ID)

    // Assert — arguments first…
    expect(mockedAutoSync).toHaveBeenCalledWith(USER, ID)
    expect(mockedCheckGoals).toHaveBeenCalledWith(USER, ['strength', 'consistency'])
    expect(mockedCheckTrophies).toHaveBeenCalledWith(USER, { kind: 'finish', workoutId: ID })
    // …then the load-bearing ordering: sync → goals → trophies (the trophy
    // check must run after the goal check — the retroactive rule's seam).
    const order = [
      mockedAutoSync.mock.invocationCallOrder[0],
      mockedCheckGoals.mock.invocationCallOrder[0],
      mockedCheckTrophies.mock.invocationCallOrder[0],
    ]
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('resolves (never rejects) when a step rejects, logging instead of failing the save', async () => {
    // Arrange — simulate a helper whose internal fail-soft regressed
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Once: clearAllMocks resets calls, not implementations — a sticky
    // rejection here would bleed into the sibling tests.
    mockedAutoSync.mockRejectedValueOnce(new Error('sync exploded'))

    // Act + Assert — the wrapper is the adapter-boundary backstop
    await expect(completeWorkoutSideEffects(USER, ID)).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('resolves when the trophy step rejects after the earlier steps ran', async () => {
    // Arrange
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedCheckTrophies.mockRejectedValueOnce(new Error('trophies exploded'))

    // Act + Assert — earlier steps completed; the rejection still never escapes
    await expect(completeWorkoutSideEffects(USER, ID)).resolves.toBeUndefined()
    expect(mockedAutoSync).toHaveBeenCalledWith(USER, ID)
    expect(mockedCheckGoals).toHaveBeenCalledWith(USER, ['strength', 'consistency'])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
